import fs from "fs";
import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createVectorStore } from "../utils/vectorStore.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../utils/model.js";
import { invokeWithUsage } from "../utils/logLLMUsage.js";
import { QdrantVectorStore } from "@langchain/qdrant";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";

export const PDF_RAG_CHUNK_SIZE = 1000;
export const PDF_RAG_CHUNK_OVERLAP = 200;
export const PDF_RAG_TOP_K = 5;

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

    const pdf = new PDFParse({
      data: buffer    // converts buffer data into PDF
    });

    const result = await pdf.getText();

    const text = result.text;

    const docs = await chunkPdfText(text);

    collectionName = `pdf-${Date.now()}`;

    const vectorStore = await createVectorStore(
      collectionName,

      docs
    );

    const relevantDocs = await vectorStore.similaritySearch(
      state.prompt,

      PDF_RAG_TOP_K
    );

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

    if (collectionName) {
      try {
        await QdrantVectorStore.deleteCollection(collectionName);
      } catch (err) {
        console.error(`Failed to delete Qdrant collection ${collectionName}:`, err);
      }
    }
  }
};
