import fs from "fs";
import crypto from "crypto";
import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createVectorStore, getExistingVectorStore } from "../utils/vectorStore.js";
import { hybridSearch } from "../utils/hybridRetriever.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../utils/model.js";
import { invokeWithUsage } from "../utils/logLLMUsage.js";
import { QdrantVectorStore } from "@langchain/qdrant";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import redis from "../../../shared/redis/redis.js";

export const PDF_RAG_CHUNK_SIZE = 1000;
export const PDF_RAG_CHUNK_OVERLAP = 200;
export const PDF_RAG_TOP_K = 5;
export const PDF_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export const computePdfHash = (buffer) => {
  return crypto.createHash("sha256").update(buffer).digest("hex");
};

export const PDF_RAG_SYSTEM_PROMPT = `

You are CortexAI PDF Assistant.

Rules:

- Answer ONLY from the uploaded PDF.

- Never make up information.

- If the answer is not present in the PDF, reply:

"I couldn't find this information in the uploaded PDF."

- Use Markdown formatting.

`;

// Mirrors the production splitter config so eval/tests exercise the same
// chunking behavior users actually get.
export const chunkPdfText = async (text) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: PDF_RAG_CHUNK_SIZE,
    chunkOverlap: PDF_RAG_CHUNK_OVERLAP
  });

  return splitter.createDocuments([text]);
};

export const buildContext = (docs) => docs.map((doc) => doc.pageContent).join("\n\n");

export const buildPdfRagMessages = (context, prompt) => [
  new SystemMessage(PDF_RAG_SYSTEM_PROMPT),

  new HumanMessage(`

Context:

${context}

Question:

${prompt}

`)
];

export const pdfRagAgent = async (state) => {
  let collectionName;

  try {
    await checkAgentLimit(state.userId, "pdf_rag");
    await deductCredits(state.userId, "pdf_rag");

    const buffer = fs.readFileSync(state.file.path);
    const fileHash = computePdfHash(buffer);
    collectionName = `pdf-${fileHash.slice(0, 32)}`;
    const cacheKey = `pdf:cache:${fileHash}`;

    let docs = null;
    let vectorStore = null;

    // 1. Check Redis for cached collection & chunk metadata across conversations
    try {
      if (redis && typeof redis.get === "function") {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.collectionName && Array.isArray(parsed.docs) && parsed.docs.length > 0) {
            vectorStore = await getExistingVectorStore(parsed.collectionName);
            docs = parsed.docs;
            collectionName = parsed.collectionName;
          }
        }
      }
    } catch (err) {
      console.warn("PDF cache lookup in Redis failed, falling back to indexing:", err?.message || err);
      vectorStore = null;
      docs = null;
    }

    // 2. Cache miss: Parse, chunk, embed into Qdrant, and cache in Redis
    if (!vectorStore || !docs) {
      const pdf = new PDFParse({
        data: buffer
      });

      const result = await pdf.getText();
      const text = result.text;
      docs = await chunkPdfText(text);

      vectorStore = await createVectorStore(collectionName, docs);

      // Store in Redis with 24-hour TTL (86400s)
      try {
        if (redis && typeof redis.set === "function") {
          await redis.set(
            cacheKey,
            JSON.stringify({ collectionName, docs }),
            "EX",
            PDF_CACHE_TTL_SECONDS
          );
        }
      } catch (err) {
        console.warn("Failed to set PDF cache in Redis:", err?.message || err);
      }
    }

    const relevantDocs = await hybridSearch({
      vectorStore,
      docs,
      query: state.prompt,
      topK: PDF_RAG_TOP_K,
      denseK: PDF_RAG_TOP_K,
      bm25K: PDF_RAG_TOP_K
    });

    const context = buildContext(relevantDocs);
    const llm = getModel("pdf-rag");

    const messages = buildPdfRagMessages(context, state.prompt);

    const response = await invokeWithUsage(llm, messages, {
      agent: "pdf_rag",
      userId: state.userId,
      conversationId: state.conversationId
    });

    return {
      ...state,
      docs,
      response: response.content
    };
  } finally {
    try {
      fs.unlinkSync(state.file.path);
    } catch (err) {
      console.error(`Failed to delete temp PDF file ${state.file.path}:`, err);
    }
  }
};
