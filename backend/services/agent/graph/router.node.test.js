import { describe, it, expect, vi, beforeEach } from "vitest";

const modelMock = { invoke: vi.fn() };
vi.mock("../utils/model.js", () => ({
  getModel: vi.fn(() => modelMock)
}));

const { routerNode } = await import("./router.node.js");
const { resolveAgentEdge } = await import("./supervisor.graph.js");
const { getModel } = await import("../utils/model.js");

describe("routerNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trusts an explicit non-auto agent and never calls the LLM", async () => {
    const state = { agent: "coding", prompt: "build me a todo app" };
    const result = await routerNode(state);

    expect(result.agent).toBe("coding");
    expect(getModel).not.toHaveBeenCalled();
  });

  it("routes an image upload straight to vision without calling the LLM", async () => {
    const state = {
      agent: "auto",
      prompt: "what is in this picture?",
      file: { mimetype: "image/png" }
    };
    const result = await routerNode(state);

    expect(result.agent).toBe("vision");
    expect(getModel).not.toHaveBeenCalled();
  });

  it("routes a PDF upload straight to pdf_rag without calling the LLM", async () => {
    const state = {
      agent: "auto",
      prompt: "summarize section 2",
      file: { mimetype: "application/pdf" }
    };
    const result = await routerNode(state);

    expect(result.agent).toBe("pdf_rag");
    expect(getModel).not.toHaveBeenCalled();
  });

  it("ignores an explicit agent of 'auto' and falls through to file/LLM routing", async () => {
    const state = {
      agent: "auto",
      prompt: "x",
      file: { mimetype: "image/jpeg" }
    };
    const result = await routerNode(state);

    expect(result.agent).toBe("vision");
  });

  it.each([
    ["chat", "chat"],
    ["search", "search"],
    ["coding", "coding"],
    ["pdf", "pdf"],
    ["ppt", "ppt"],
    ["image", "image"]
  ])("classifies a text-only prompt as %s when the LLM returns %s", async (llmOutput, expected) => {
    modelMock.invoke.mockResolvedValue({ content: llmOutput });

    const result = await routerNode({ agent: "auto", prompt: "some prompt" });

    expect(result.agent).toBe(expected);
  });

  it("lowercases and trims the LLM's classification", async () => {
    modelMock.invoke.mockResolvedValue({ content: "  Coding\n" });

    const result = await routerNode({ agent: "auto", prompt: "build a react app" });

    expect(result.agent).toBe("coding");
  });

  it("passes the raw LLM classification through even when it is off-vocabulary", async () => {
    // routerNode itself does no validation — the switch in
    // supervisor.graph.js's resolveAgentEdge is what falls back to chat for
    // unrecognized values (see resolveAgentEdge tests below). This test
    // documents that split of responsibility.
    modelMock.invoke.mockResolvedValue({ content: "translate" });

    const result = await routerNode({ agent: "auto", prompt: "translate this to French" });

    expect(result.agent).toBe("translate");
  });

  it("has no text-only path to vision or pdf_rag — they are unreachable without a file", async () => {
    // vision/pdf_rag are missing from the router's LLM prompt vocabulary by
    // design (file-mimetype short-circuit is the only entry point), but that
    // also means a text prompt can never legitimately reach them.
    modelMock.invoke.mockResolvedValue({ content: "vision" });

    const result = await routerNode({ agent: "auto", prompt: "describe an image of a cat" });

    // The LLM was never instructed this is a valid label, but nothing stops
    // it from guessing "vision" anyway — routerNode passes it through as-is.
    expect(result.agent).toBe("vision");
  });
});

describe("resolveAgentEdge (graph dispatch)", () => {
  it.each([
    ["search", "search"],
    ["coding", "coding"],
    ["pdf", "pdf"],
    ["ppt", "ppt"],
    ["image", "image"],
    ["vision", "vision"],
    ["pdf_rag", "pdf_rag"],
    ["chat", "chat"]
  ])("dispatches agent=%s to the %s node", (agent, expectedNode) => {
    expect(resolveAgentEdge({ agent })).toBe(expectedNode);
  });

  it("falls back to chat for any unrecognized agent value", () => {
    expect(resolveAgentEdge({ agent: "translate" })).toBe("chat");
    expect(resolveAgentEdge({ agent: "" })).toBe("chat");
    expect(resolveAgentEdge({ agent: undefined })).toBe("chat");
  });
});
