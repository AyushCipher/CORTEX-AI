import { describe, it, expect, vi, beforeEach } from "vitest";

const redisMock = {
  incr: vi.fn(),
  expire: vi.fn(),
  ttl: vi.fn()
};

vi.mock("../../../shared/redis/redis.js", () => ({
  default: redisMock
}));

const { checkAgentLimit } = await import("./agentRateLimit.js");

describe("checkAgentLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the request and sets a TTL on the first call in the window", async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.ttl.mockResolvedValue(60);

    const result = await checkAgentLimit("user-1", "chat");

    expect(redisMock.expire).toHaveBeenCalledWith("rate:chat:user-1", 60);
    expect(result).toEqual({ remaining: 19, limit: 20 });
  });

  it("does not re-arm the TTL on subsequent calls within the window", async () => {
    redisMock.incr.mockResolvedValue(2);
    redisMock.ttl.mockResolvedValue(45);

    await checkAgentLimit("user-1", "chat");

    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it("throws a 429 error once the per-agent limit is exceeded", async () => {
    redisMock.incr.mockResolvedValue(6);
    redisMock.ttl.mockResolvedValue(30);

    await expect(checkAgentLimit("user-1", "image")).rejects.toMatchObject({
      status: 429,
      data: expect.objectContaining({
        success: false,
        agent: "image",
        limit: 3
      })
    });
  });

  it("falls back to the chat limit for an unknown agent name", async () => {
    redisMock.incr.mockResolvedValue(1);
    redisMock.ttl.mockResolvedValue(60);

    const result = await checkAgentLimit("user-1", "unknown-agent");

    expect(result.limit).toBe(20);
  });
});
