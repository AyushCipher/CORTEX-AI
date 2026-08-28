import { describe, it, expect, vi, beforeEach } from "vitest";

const deductCreditsMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/deductCredits.js", () => ({
  deductCredits: (...args) => deductCreditsMock(...args)
}));

const checkAgentLimitMock = vi.fn().mockResolvedValue({ remaining: 4, limit: 5 });
vi.mock("../config/agentRateLimit.js", () => ({
  checkAgentLimit: (...args) => checkAgentLimitMock(...args)
}));

const searchToolMock = { invoke: vi.fn() };
vi.mock("../utils/tavily.js", () => ({ searchTool: searchToolMock }));

vi.mock("../utils/memory.js", () => ({
  getMemory: vi.fn().mockResolvedValue([]),
  addMessage: vi.fn().mockResolvedValue(undefined)
}));

const modelMock = { invoke: vi.fn() };
vi.mock("../utils/model.js", () => ({ getModel: vi.fn(() => modelMock) }));

// supervisor.graph.js registers the pdf_rag node too, which pulls in
// GoogleGenerativeAIEmbeddings at module-load time — irrelevant to the
// search/chat path this test covers, and it would otherwise require a real
// GOOGLE_API_KEY just to import the graph.
vi.mock("../utils/embedding.js", () => ({ embeddings: {} }));

// This exercises the real compiled StateGraph from supervisor.graph.js — not
// a reimplementation — so it reflects the actual edge wiring in production.
const { graph } = await import("./supervisor.graph.js");

describe("supervisor graph — credit deduction per request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deducts credits exactly once for a plain chat request", async () => {
    modelMock.invoke.mockResolvedValue({ content: "Hi there." });

    await graph.invoke({
      prompt: "hello",
      conversationId: "conv-2",
      userId: "user-2",
      agent: "chat"
    });

    expect(deductCreditsMock).toHaveBeenCalledTimes(1);
    expect(deductCreditsMock).toHaveBeenCalledWith("user-2", "chat");
  });

  it("FIXED: deducts credits exactly once for a search request (chat skips its own guard when formatting search results)", async () => {
    // workflow.addEdge("search", "chat") in supervisor.graph.js means a
    // "search" request runs the search agent AND THEN the chat agent before
    // reaching __end__. Previously both nodes unconditionally called
    // checkAgentLimit/deductCredits, so a single search query was charged
    // for search (5 credits) *and* chat (1 credit) — see
    // docs/known-limitations.md for the original bug report. chatAgent now
    // skips its own guard when state.searchResults is present (i.e. it's
    // running as search's downstream formatting step, not a standalone chat
    // request). If this regresses back to double-billing, this test should
    // fail — update it only if the intended behavior genuinely changes.
    searchToolMock.invoke.mockResolvedValue({
      results: [{ title: "hit", content: "c", url: "u" }],
      images: []
    });
    modelMock.invoke.mockResolvedValue({ content: "Here is your answer." });

    await graph.invoke({
      prompt: "latest node version",
      conversationId: "conv-1",
      userId: "user-1",
      agent: "search"
    });

    expect(deductCreditsMock).toHaveBeenCalledTimes(1);
    expect(deductCreditsMock).toHaveBeenCalledWith("user-1", "search");
    expect(checkAgentLimitMock).toHaveBeenCalledTimes(1);
    expect(checkAgentLimitMock).toHaveBeenCalledWith("user-1", "search");
  });
});
