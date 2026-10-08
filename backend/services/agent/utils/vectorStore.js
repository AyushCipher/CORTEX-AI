import { QdrantVectorStore } from "@langchain/qdrant";
import { embeddings } from "./embedding.js";

export const createVectorStore = async (collectionName, docs) => {
  return await QdrantVectorStore.fromDocuments(
    docs,
    embeddings,
    {
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName
    }
  );
};

export const getExistingVectorStore = async (collectionName) => {
  return await QdrantVectorStore.fromExistingCollection(
    embeddings,
    {
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName
    }
  );
};

export const deleteVectorCollection = async (collectionName) => {
  try {
    return await QdrantVectorStore.deleteCollection(collectionName);
  } catch (err) {
    console.warn(`Failed to delete Qdrant collection ${collectionName}:`, err?.message || err);
  }
};

