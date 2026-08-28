import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

process.env.CHAT_SERVICE = "http://chat-service.test";

vi.mock("../../../shared/redis/redis.js", () => ({
  default: { get: vi.fn(), set: vi.fn() }
}));

vi.mock("../utils/memory.js", () => ({
  addMessage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("axios", () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true } })
  }
}));

async function* fakeGraphStream() {
  yield { prompt: "hi", agent: "chat" };
  yield {
    prompt: "hi",
    agent: "chat",
    response: "Hello there",
    images: [],
    artifacts: []
  };
}

vi.mock("../graph/supervisor.graph.js", () => ({
  graph: {
    stream: vi.fn().mockResolvedValue(fakeGraphStream())
  }
}));

const { chatStream } = await import("./agent.controller.js");
const { graph } = await import("../graph/supervisor.graph.js");
const { addMessage } = await import("../utils/memory.js");
const axios = (await import("axios")).default;

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.post("/chat/stream", chatStream);
  return app;
};

describe("POST /chat/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    graph.stream.mockResolvedValue(fakeGraphStream());
  });

  it("emits agent, token, and done SSE events and persists both messages", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/chat/stream")
      .send({ prompt: "hi", conversationId: "conv-1", agent: "auto" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const body = res.text;

    expect(body).toContain("event: agent");
    expect(body).toContain('"agent":"chat"');
    expect(body).toContain("event: token");
    expect(body).toContain("event: done");
    expect(body).toContain('"answer":"Hello there"');

    expect(addMessage).toHaveBeenCalledWith("conv-1", "user", "hi");
    expect(addMessage).toHaveBeenCalledWith("conv-1", "assistant", "Hello there");

    expect(axios.post).toHaveBeenCalledWith(
      "http://chat-service.test/save-message",
      expect.objectContaining({ role: "user", content: "hi" })
    );
    expect(axios.post).toHaveBeenCalledWith(
      "http://chat-service.test/save-message",
      expect.objectContaining({ role: "assistant", content: "Hello there" })
    );
  });

  it("emits an error event instead of crashing when the graph throws", async () => {
    graph.stream.mockRejectedValue(new Error("model unavailable"));

    const app = buildApp();

    const res = await request(app)
      .post("/chat/stream")
      .send({ prompt: "hi", conversationId: "conv-2", agent: "auto" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("event: error");
    expect(res.text).toContain("model unavailable");
  });
});
