import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/user.model.js", () => ({
  default: { findById: vi.fn(), findOneAndUpdate: vi.fn() }
}));

const redisMock = { get: vi.fn(), set: vi.fn() };
vi.mock("../../../shared/redis/redis.js", () => ({ default: redisMock }));

const User = (await import("../models/user.model.js")).default;
const { deductCredits } = await import("./auth.controllers.js");

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("deductCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.get.mockResolvedValue(null);
  });

  it.each([
    ["chat", 1],
    ["search", 5],
    ["coding", 10],
    ["pdf", 10],
    ["ppt", 10],
    ["image", 10],
    ["pdf_rag", 10]
  ])("deducts %s credits for the %s agent via an atomic conditional update", async (agent, cost) => {
    User.findOneAndUpdate.mockResolvedValue({ _id: "user-1", credits: 100 - cost });
    const res = buildRes();

    await deductCredits({ body: { userId: "user-1", agent } }, res);

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "user-1", credits: { $gte: cost } },
      { $inc: { credits: -cost } },
      { new: true }
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, credits: 100 - cost })
    );
  });

  it("defaults to a 1-credit cost for an unrecognized agent name", async () => {
    User.findOneAndUpdate.mockResolvedValue({ _id: "user-1", credits: 99 });
    const res = buildRes();

    await deductCredits({ body: { userId: "user-1", agent: "some-future-agent" } }, res);

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "user-1", credits: { $gte: 1 } },
      { $inc: { credits: -1 } },
      { new: true }
    );
  });

  it("rejects with 400 when the conditional update matches no document because credits are insufficient", async () => {
    User.findOneAndUpdate.mockResolvedValue(null);
    User.findById.mockResolvedValue({ _id: "user-1", credits: 3 });
    const res = buildRes();

    await deductCredits({ body: { userId: "user-1", agent: "coding" } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("succeeds when credits exactly equal the cost (boundary, $gte not $gt)", async () => {
    User.findOneAndUpdate.mockResolvedValue({ _id: "user-1", credits: 0 });
    const res = buildRes();

    await deductCredits({ body: { userId: "user-1", agent: "coding" } }, res);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, credits: 0 }));
  });

  it("returns 404 when the update matches nothing because the user does not exist", async () => {
    User.findOneAndUpdate.mockResolvedValue(null);
    User.findById.mockResolvedValue(null);
    const res = buildRes();

    await deductCredits({ body: { userId: "missing-user", agent: "chat" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("refreshes the cached session with the new credit balance when a session exists", async () => {
    User.findOneAndUpdate.mockResolvedValue({ _id: "user-1", credits: 49 });
    redisMock.get.mockResolvedValue("session-abc");
    const res = buildRes();

    await deductCredits({ body: { userId: "user-1", agent: "chat" } }, res);

    expect(redisMock.set).toHaveBeenCalledWith(
      "session:session-abc",
      expect.stringContaining('"credits":49'),
      "EX",
      60 * 60 * 24 * 7
    );
  });

  it("does not touch redis session cache when no session is cached for the user", async () => {
    User.findOneAndUpdate.mockResolvedValue({ _id: "user-1", credits: 49 });
    redisMock.get.mockResolvedValue(null);
    const res = buildRes();

    await deductCredits({ body: { userId: "user-1", agent: "chat" } }, res);

    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it("FIXED: an atomic update prevents the previous lost-update race — only one of two concurrent requests succeeds", async () => {
    // Previously (plain findById -> mutate -> save), two concurrent requests
    // that both read the same starting balance before either wrote back
    // would both "succeed" off a stale read, silently losing one deduction
    // — see docs/known-limitations.md for the original bug report and the
    // auth.controllers.test.js history for how that was reproduced.
    //
    // findOneAndUpdate's filter+$inc happen as one atomic database
    // operation, so this mock models that: each call synchronously checks
    // the current shared balance and mutates it before returning, exactly
    // as a real conditional update would appear to any caller — there is no
    // window where two callers can both observe the same pre-mutation
    // balance.
    let dbCredits = 15;
    User.findOneAndUpdate.mockImplementation((filter, update) => {
      const cost = -update.$inc.credits;
      if (dbCredits >= cost) {
        dbCredits -= cost;
        return Promise.resolve({ _id: "user-1", credits: dbCredits });
      }
      return Promise.resolve(null);
    });
    User.findById.mockResolvedValue({ _id: "user-1" });

    const res1 = buildRes();
    const res2 = buildRes();

    await Promise.all([
      deductCredits({ body: { userId: "user-1", agent: "coding" } }, res1),
      deductCredits({ body: { userId: "user-1", agent: "coding" } }, res2)
    ]);

    const succeeded = [res1, res2].filter((r) =>
      r.json.mock.calls.some(([body]) => body.success === true)
    );
    const rejected = [res1, res2].filter((r) =>
      r.json.mock.calls.some(([body]) => body.success === false)
    );

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 15 - 10 = 5, then the second request correctly fails the 5 >= 10
    // check instead of also deducting.
    expect(dbCredits).toBe(5);
  });
});
