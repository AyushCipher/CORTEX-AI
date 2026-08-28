// Minimal Qdrant REST client used only by the eval script.
//
// @qdrant/js-client-rest (the SDK production code uses via @langchain/qdrant)
// reliably gets its requests reset by Qdrant Cloud's edge from this sandbox,
// while plain axios calls to the exact same REST endpoints do not. This
// bypasses that one SDK; it does not change production code or behavior —
// vectorStore.js / pdfRag.agent.js still use @langchain/qdrant unmodified.
import axios from "axios";

const client = (url, apiKey) =>
  axios.create({
    baseURL: url,
    headers: { "api-key": apiKey, "content-type": "application/json" }
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This sandbox's egress to Qdrant Cloud intermittently drops requests
// (connection resets, occasional DNS lookup failures) that clear up within
// a few seconds; a real outage would keep failing across all these
// attempts. This is not needed against a normal network path.
const withRetry = async (fn, attempts = 8) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(
        err.code
      );
      if (!retryable || attempt === attempts) throw err;
      await sleep(Math.min(500 * attempt, 4000));
    }
  }
};

export const createCollection = async (url, apiKey, name, size) => {
  const http = client(url, apiKey);
  await withRetry(() =>
    http.put(`/collections/${name}`, {
      vectors: { size, distance: "Cosine" }
    })
  );
};

export const upsertPoints = async (url, apiKey, name, points) => {
  const http = client(url, apiKey);
  await withRetry(() => http.put(`/collections/${name}/points?wait=true`, { points }));
};

export const searchPoints = async (url, apiKey, name, vector, limit) => {
  const http = client(url, apiKey);
  const res = await withRetry(() =>
    http.post(`/collections/${name}/points/search`, {
      vector,
      limit,
      with_payload: true
    })
  );
  return res.data.result;
};

export const deleteCollection = async (url, apiKey, name) => {
  const http = client(url, apiKey);
  await withRetry(() => http.delete(`/collections/${name}`));
};
