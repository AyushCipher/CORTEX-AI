import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerMock = { info: vi.fn() };

vi.mock("../../../shared/logger/logger.js", () => ({
  createLogger: vi.fn(() => loggerMock)
}));

const { invokeWithUsage } = await import("./logLLMUsage.js");

describe("invokeWithUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the model's response unchanged", async () => {
    const response = {
      content: "hi",
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
    };
    const llm = {
      model: "llama-3.3-70b-versatile",
      invoke: vi.fn().mockResolvedValue(response)
    };

    const result = await invokeWithUsage(llm, ["messages"], {
      agent: "chat",
      userId: "u1"
    });

    expect(result).toBe(response);
    expect(llm.invoke).toHaveBeenCalledWith(["messages"]);
  });

  it("logs token usage and an estimated cost for a known model", async () => {
    const response = {
      content: "hi",
      usage_metadata: {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        total_tokens: 2_000_000
      }
    };
    const llm = {
      model: "llama-3.3-70b-versatile",
      invoke: vi.fn().mockResolvedValue(response)
    };

    await invokeWithUsage(llm, ["messages"], {
      agent: "chat",
      userId: "u1",
      conversationId: "c1"
    });

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "chat",
        userId: "u1",
        conversationId: "c1",
        model: "llama-3.3-70b-versatile",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000,
        estimatedCostUsd: 0.59 + 0.79
      }),
      "LLM call completed"
    );
  });

  it("falls back to the legacy tokenUsage shape when usage_metadata is absent", async () => {
    const response = {
      content: "hi",
      response_metadata: {
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
      }
    };
    const llm = {
      model: "gemini-2.5-flash",
      invoke: vi.fn().mockResolvedValue(response)
    };

    await invokeWithUsage(llm, ["messages"], { agent: "vision" });

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150
      }),
      "LLM call completed"
    );
  });

  it("logs null cost when the model has no pricing entry or usage is missing", async () => {
    const response = { content: "hi" };
    const llm = {
      model: "some-unpriced-model",
      invoke: vi.fn().mockResolvedValue(response)
    };

    await invokeWithUsage(llm, ["messages"], { agent: "coding" });

    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        estimatedCostUsd: null
      }),
      "LLM call completed"
    );
  });
});
