import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => Buffer.from("fake pdf bytes")),
    unlinkSync: vi.fn()
  }
}));

const getTextMock = vi.fn().mockResolvedValue({ text: "Employees get 18 paid leave days per year." });
vi.mock("pdf-parse", () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: getTextMock
  }))
}));

const similaritySearchMock = vi.fn();
const createVectorStoreMock = vi.fn().mockResolvedValue({
  similaritySearch: similaritySearchMock
});
const getExistingVectorStoreMock = vi.fn().mockResolvedValue({
  similaritySearch: similaritySearchMock
});
vi.mock("../utils/vectorStore.js", () => ({
  createVectorStore: (...args) => createVectorStoreMock(...args),
  getExistingVectorStore: (...args) => getExistingVectorStoreMock(...args)
}));

const modelMock = { invoke: vi.fn() };
vi.mock("../utils/model.js", () => ({
  getModel: vi.fn(() => modelMock)
}));

const deleteCollectionMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@langchain/qdrant", () => ({
  QdrantVectorStore: { deleteCollection: (...args) => deleteCollectionMock(...args) }
}));

const checkAgentLimitMock = vi.fn().mockResolvedValue({ remaining: 4, limit: 5 });
vi.mock("../config/agentRateLimit.js", () => ({
  checkAgentLimit: (...args) => checkAgentLimitMock(...args)
}));

const deductCreditsMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/deductCredits.js", () => ({
  deductCredits: (...args) => deductCreditsMock(...args)
}));

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK")
};
vi.mock("../../../shared/redis/redis.js", () => ({
  default: redisMock
}));

const { pdfRagAgent, chunkPdfText, buildContext, buildPdfRagMessages, PDF_RAG_TOP_K, computePdfHash } =
  await import("./pdfRag.agent.js");
const fs = (await import("fs")).default;

const baseState = () => ({
  userId: "user-1",
  conversationId: "conv-1",
  prompt: "How many paid leave days do I get?",
  file: { path: "/tmp/upload-123.pdf" }
});

describe("pdfRagAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTextMock.mockResolvedValue({ text: "Employees get 18 paid leave days per year." });
    createVectorStoreMock.mockResolvedValue({ similaritySearch: similaritySearchMock });
    getExistingVectorStoreMock.mockResolvedValue({ similaritySearch: similaritySearchMock });
    deleteCollectionMock.mockResolvedValue(undefined);
    checkAgentLimitMock.mockResolvedValue({ remaining: 4, limit: 5 });
    deductCreditsMock.mockResolvedValue(undefined);
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue("OK");
  });

  it("builds the answer context only from the retrieved top-k chunks, not the whole document", async () => {
    similaritySearchMock.mockResolvedValue([
      { pageContent: "Employees get 18 paid leave days per year." },
      { pageContent: "Remote work is capped at 3 days per week." }
    ]);
    modelMock.invoke.mockResolvedValue({ content: "You get 18 paid leave days per year." });

    await pdfRagAgent(baseState());

    expect(similaritySearchMock).toHaveBeenCalledWith(
      "How many paid leave days do I get?",
      PDF_RAG_TOP_K
    );
    const [messages] = modelMock.invoke.mock.calls[0];
    const humanMessage = messages[1];
    expect(humanMessage.content).toContain("18 paid leave days");
    expect(humanMessage.content).toContain("Remote work is capped");
  });

  it("instructs the model to answer only from the PDF and gives it the exact refusal line", async () => {
    similaritySearchMock.mockResolvedValue([]);
    modelMock.invoke.mockResolvedValue({ content: "..." });

    await pdfRagAgent(baseState());

    const [messages] = modelMock.invoke.mock.calls[0];
    const systemMessage = messages[0];
    expect(systemMessage.content).toContain("Answer ONLY from the uploaded PDF");
    expect(systemMessage.content).toContain(
      "I couldn't find this information in the uploaded PDF."
    );
  });

  it("returns the model's answer as state.response", async () => {
    similaritySearchMock.mockResolvedValue([{ pageContent: "18 paid leave days." }]);
    modelMock.invoke.mockResolvedValue({ content: "You get 18 paid leave days." });

    const result = await pdfRagAgent(baseState());

    expect(result.response).toBe("You get 18 paid leave days.");
  });

  it("deletes the temp upload file after a successful run", async () => {
    similaritySearchMock.mockResolvedValue([]);
    modelMock.invoke.mockResolvedValue({ content: "answer" });

    await pdfRagAgent(baseState());

    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/upload-123.pdf");
  });

  it("FIXED: computes SHA-256 hash and caches collection in Redis with 24h TTL on cache miss", async () => {
    similaritySearchMock.mockResolvedValue([]);
    modelMock.invoke.mockResolvedValue({ content: "answer" });

    await pdfRagAgent(baseState());

    expect(redisMock.get).toHaveBeenCalledWith(expect.stringMatching(/^pdf:cache:[a-f0-9]{64}$/));
    expect(createVectorStoreMock).toHaveBeenCalledTimes(1);
    const collectionNameArg = createVectorStoreMock.mock.calls[0][0];
    expect(collectionNameArg).toMatch(/^pdf-[a-f0-9]{32}$/);

    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^pdf:cache:[a-f0-9]{64}$/),
      expect.any(String),
      "EX",
      86400
    );
  });

  it("FIXED: reuses cached Qdrant collection on cache hit and skips PDF parsing + embedding", async () => {
    const cachedDocs = [{ pageContent: "Cached content from previous message." }];
    redisMock.get.mockResolvedValue(
      JSON.stringify({
        collectionName: "pdf-cached123",
        docs: cachedDocs
      })
    );
    similaritySearchMock.mockResolvedValue(cachedDocs);
    modelMock.invoke.mockResolvedValue({ content: "answer from cache" });

    const result = await pdfRagAgent(baseState());

    expect(getExistingVectorStoreMock).toHaveBeenCalledWith("pdf-cached123");
    expect(createVectorStoreMock).not.toHaveBeenCalled();
    expect(getTextMock).not.toHaveBeenCalled();
    expect(result.response).toBe("answer from cache");
    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/upload-123.pdf");
  });

  it("still deletes the temp file when generation throws", async () => {
    similaritySearchMock.mockResolvedValue([{ pageContent: "context" }]);
    modelMock.invoke.mockRejectedValue(new Error("model unavailable"));

    await expect(pdfRagAgent(baseState())).rejects.toThrow("model unavailable");

    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/upload-123.pdf");
  });

  it("does not crash the request if cleanup itself fails", async () => {
    similaritySearchMock.mockResolvedValue([]);
    modelMock.invoke.mockResolvedValue({ content: "answer" });
    fs.unlinkSync.mockImplementation(() => {
      throw new Error("EBUSY: file locked");
    });

    const result = await pdfRagAgent(baseState());

    expect(result.response).toBe("answer");
  });

  it("FIXED: checks the pdf_rag rate limit and deducts pdf_rag credits before doing any work", async () => {
    similaritySearchMock.mockResolvedValue([]);
    modelMock.invoke.mockResolvedValue({ content: "answer" });

    await pdfRagAgent(baseState());

    expect(checkAgentLimitMock).toHaveBeenCalledWith("user-1", "pdf_rag");
    expect(deductCreditsMock).toHaveBeenCalledWith("user-1", "pdf_rag");
  });

  it("still cleans up the temp upload file when the rate limit is exceeded before any PDF work starts", async () => {
    checkAgentLimitMock.mockRejectedValue(
      Object.assign(new Error("Rate limit exceeded for pdf_rag."), { status: 429 })
    );

    await expect(pdfRagAgent(baseState())).rejects.toThrow("Rate limit exceeded");

    expect(fs.unlinkSync).toHaveBeenCalledWith("/tmp/upload-123.pdf");
    expect(createVectorStoreMock).not.toHaveBeenCalled();
  });

  it("does not read or embed the PDF when the user has insufficient credits", async () => {
    deductCreditsMock.mockRejectedValue(
      Object.assign(new Error("Insufficient Credits"), { status: 400 })
    );

    await expect(pdfRagAgent(baseState())).rejects.toThrow("Insufficient Credits");

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(createVectorStoreMock).not.toHaveBeenCalled();
  });
});

describe("chunkPdfText", () => {
  it("chunks with the production chunkSize/overlap (1000/200)", async () => {
    const longText = "A".repeat(2500);
    const docs = await chunkPdfText(longText);

    expect(docs.length).toBeGreaterThan(1);
    expect(docs[0].pageContent.length).toBeLessThanOrEqual(1000);
  });

  it("returns a single chunk for short text", async () => {
    const docs = await chunkPdfText("A short PDF with one sentence.");
    expect(docs).toHaveLength(1);
  });
});

describe("buildContext", () => {
  it("joins retrieved chunks with a blank line between them", () => {
    const context = buildContext([{ pageContent: "first" }, { pageContent: "second" }]);
    expect(context).toBe("first\n\nsecond");
  });

  it("returns an empty string when nothing was retrieved", () => {
    expect(buildContext([])).toBe("");
  });
});

describe("buildPdfRagMessages", () => {
  it("embeds both the retrieved context and the question in the human message", () => {
    const [, human] = buildPdfRagMessages("some context", "what is the policy?");
    expect(human.content).toContain("some context");
    expect(human.content).toContain("what is the policy?");
  });
});
