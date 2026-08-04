import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config/agentRateLimit.js", () => ({
  checkAgentLimit: vi.fn().mockResolvedValue({ remaining: 4, limit: 5 })
}));

vi.mock("../utils/deductCredits.js", () => ({
  deductCredits: vi.fn().mockResolvedValue(undefined)
}));

const searchToolMock = { invoke: vi.fn() };
vi.mock("../utils/tavily.js", () => ({
  searchTool: searchToolMock
}));

const modelMock = { invoke: vi.fn() };
vi.mock("../utils/model.js", () => ({
  getModel: vi.fn(() => modelMock)
}));

const { searchAgent } = await import("./search.agent.js");

describe("searchAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately when the first search attempt has usable results", async () => {
    searchToolMock.invoke.mockResolvedValue({
      results: [{ title: "hit" }],
      images: []
    });

    const state = { userId: "u1", prompt: "latest node version" };
    const result = await searchAgent(state);

    expect(searchToolMock.invoke).toHaveBeenCalledTimes(1);
    expect(modelMock.invoke).not.toHaveBeenCalled();
    expect(result.searchResults.results).toHaveLength(1);
  });

  it("reformulates the query and retries when results are empty", async () => {
    searchToolMock.invoke
      .mockResolvedValueOnce({ results: [], images: [] })
      .mockResolvedValueOnce({ results: [{ title: "hit on retry" }], images: [] });

    modelMock.invoke.mockResolvedValue({ content: "a broader search query" });

    const state = { userId: "u1", prompt: "very niche obscure term" };
    const result = await searchAgent(state);

    expect(searchToolMock.invoke).toHaveBeenCalledTimes(2);
    expect(modelMock.invoke).toHaveBeenCalledTimes(1);
    expect(searchToolMock.invoke).toHaveBeenNthCalledWith(2, {
      query: "a broader search query"
    });
    expect(result.searchResults.results).toHaveLength(1);
  });

  it("survives a search tool exception and keeps trying", async () => {
    searchToolMock.invoke
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce({ results: [{ title: "recovered" }], images: [] });

    modelMock.invoke.mockResolvedValue({ content: "retry query" });

    const state = { userId: "u1", prompt: "something" };
    const result = await searchAgent(state);

    expect(searchToolMock.invoke).toHaveBeenCalledTimes(2);
    expect(result.searchResults.results).toHaveLength(1);
  });

  it("falls back to an empty result set after exhausting all attempts", async () => {
    searchToolMock.invoke.mockResolvedValue({ results: [], images: [] });
    modelMock.invoke.mockResolvedValue({ content: "still nothing query" });

    const state = { userId: "u1", prompt: "truly unfindable" };
    const result = await searchAgent(state);

    expect(searchToolMock.invoke).toHaveBeenCalledTimes(3);
    expect(modelMock.invoke).toHaveBeenCalledTimes(2);
    expect(result.searchResults).toEqual({ results: [], images: [] });
  });
});
