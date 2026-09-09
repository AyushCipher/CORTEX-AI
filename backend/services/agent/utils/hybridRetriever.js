import { bm25Search } from "./bm25.js";

/**
 * Performs Hybrid Retrieval:
 * 1. Dense retrieval using Qdrant vector store embeddings
 * 2. Sparse retrieval using Okapi BM25 keyword matching
 * 3. Fusion & Reranking using Reciprocal Rank Fusion (RRF)
 *
 * @param {Object} params
 * @param {Object} params.vectorStore - QdrantVectorStore instance
 * @param {Array} params.docs - All chunked Document objects
 * @param {string} params.query - Search query prompt
 * @param {number} [params.topK=5] - Final number of documents to return
 * @param {number} [params.denseK=10] - Number of candidates from dense search
 * @param {number} [params.bm25K=10] - Number of candidates from BM25 search
 * @param {number} [params.rrfK=60] - RRF smoothing parameter
 * @returns {Promise<Array>} Reranked top-K document chunks
 */
export const hybridSearch = async ({
  vectorStore,
  docs = [],
  query = "",
  topK = 5,
  denseK = 10,
  bm25K = 10,
  rrfK = 60
} = {}) => {
  if (!docs || docs.length === 0) return [];

  // 1. Run dense search (vector store similarity search)
  let denseResults = [];
  try {
    if (vectorStore && typeof vectorStore.similaritySearch === "function") {
      denseResults = await vectorStore.similaritySearch(query, denseK);
    }
  } catch (err) {
    console.error("Dense vector search failed, falling back to BM25:", err);
  }

  // 2. Run sparse search (BM25 keyword search)
  let bm25Results = [];
  try {
    bm25Results = bm25Search(docs, query, bm25K);
  } catch (err) {
    console.error("BM25 sparse search failed:", err);
  }

  // 3. Reciprocal Rank Fusion (RRF)
  const rrfMap = new Map();

  const getDocKey = (doc) => {
    return doc.pageContent || (typeof doc === "string" ? doc : JSON.stringify(doc));
  };

  // Add dense ranks
  denseResults.forEach((doc, rank) => {
    const key = getDocKey(doc);
    const score = 1 / (rrfK + (rank + 1));
    const entry = rrfMap.get(key) || { doc, score: 0, denseRank: rank + 1, bm25Rank: null };
    entry.score += score;
    entry.denseRank = rank + 1;
    rrfMap.set(key, entry);
  });

  // Add BM25 ranks
  bm25Results.forEach((doc, rank) => {
    const key = getDocKey(doc);
    const score = 1 / (rrfK + (rank + 1));
    const entry = rrfMap.get(key) || { doc, score: 0, denseRank: null, bm25Rank: rank + 1 };
    entry.score += score;
    entry.bm25Rank = rank + 1;
    rrfMap.set(key, entry);
  });

  // Sort by RRF score descending
  const fusedList = Array.from(rrfMap.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc);

  if (fusedList.length === 0) {
    return docs.slice(0, topK);
  }

  return fusedList.slice(0, topK);
};
