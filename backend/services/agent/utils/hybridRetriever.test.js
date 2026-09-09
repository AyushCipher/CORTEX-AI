import { describe, it, expect, vi } from "vitest";
import { BM25Index, bm25Search, tokenize } from "./bm25.js";
import { hybridSearch } from "./hybridRetriever.js";

describe("BM25 Sparse Retrieval", () => {
  const sampleDocs = [
    { pageContent: "Aurora Robotics employee leave policy grants 18 paid leave days annually." },
    { pageContent: "Solar panel efficiency ratings range from 20% to 22% for monocrystalline modules." },
    { pageContent: "Cortex AI pricing tiers include Free, Pro, and Enterprise subscription plans." },
    { pageContent: "Remote work policy allows employees up to 3 days per week with manager approval." }
  ];

  it("tokenizes and filters stop words correctly", () => {
    const tokens = tokenize("What is the remote work policy in 2026?");
    expect(tokens).toContain("remote");
    expect(tokens).toContain("work");
    expect(tokens).toContain("policy");
    expect(tokens).toContain("2026");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("is");
  });

  it("retrieves the most relevant document based on keyword matching", () => {
    const results = bm25Search(sampleDocs, "paid leave days employee", 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pageContent).toContain("18 paid leave days");
  });

  it("returns empty array when query has no matching tokens", () => {
    const results = bm25Search(sampleDocs, "quantum computing entanglement", 2);
    expect(results).toHaveLength(0);
  });
});

describe("Hybrid Retriever (Dense + BM25 + RRF)", () => {
  const docs = [
    { pageContent: "Policy doc #1: Health insurance covers dental and vision." },
    { pageContent: "Policy doc #2: 401k match is 5% after one year of tenure." },
    { pageContent: "Policy doc #3: Parental leave is 26 weeks for primary caregivers." },
    { pageContent: "Policy doc #4: Expense reimbursement must be submitted within 30 days." },
    { pageContent: "Policy doc #5: Travel allowance is $100 per diem." }
  ];

  it("fuses dense vector search and sparse BM25 search using Reciprocal Rank Fusion", async () => {
    const mockVectorStore = {
      similaritySearch: vi.fn().mockResolvedValue([
        docs[2], // Parental leave
        docs[0]  // Health insurance
      ])
    };

    const results = await hybridSearch({
      vectorStore: mockVectorStore,
      docs,
      query: "parental leave caregiver weeks",
      topK: 2
    });

    expect(mockVectorStore.similaritySearch).toHaveBeenCalled();
    expect(results.length).toBe(2);
    // Doc #3 appears in both Dense and BM25, so it should rank #1 with highest RRF score
    expect(results[0].pageContent).toContain("Parental leave");
  });

  it("falls back gracefully to BM25 when vector store throws", async () => {
    const mockVectorStore = {
      similaritySearch: vi.fn().mockRejectedValue(new Error("Vector DB timeout"))
    };

    const results = await hybridSearch({
      vectorStore: mockVectorStore,
      docs,
      query: "expense reimbursement 30 days",
      topK: 1
    });

    expect(results.length).toBe(1);
    expect(results[0].pageContent).toContain("Expense reimbursement");
  });

  it("returns all docs directly if doc count is less than or equal to topK", async () => {
    const shortDocs = [{ pageContent: "Single small doc" }];
    const results = await hybridSearch({
      vectorStore: null,
      docs: shortDocs,
      query: "any query",
      topK: 5
    });

    expect(results).toEqual(shortDocs);
  });
});
