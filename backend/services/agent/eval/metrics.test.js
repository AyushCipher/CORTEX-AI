import { describe, it, expect, vi } from "vitest";
import {
  normalize,
  isSnippetCaptured,
  computeRecallAtK,
  evaluateFaithfulness,
  heuristicFaithfulnessFallback
} from "./metrics.js";

describe("eval/metrics", () => {
  describe("normalize & isSnippetCaptured", () => {
    it("normalizes text by trimming, lowering case, and stripping special punctuation", () => {
      expect(normalize("Hello, World! 100%")).toBe("hello world 100");
    });

    it("identifies exact and fuzzy snippet capture", () => {
      const chunk = "The search agent costs 5 credits per request under the standard tier.";
      const snippet = "search agent costs 5 credits per request";
      expect(isSnippetCaptured(chunk, snippet)).toBe(true);
    });

    it("returns false when snippet is absent", () => {
      const chunk = "Monocrystalline panels typically operate at 20-22% efficiency.";
      const snippet = "search agent costs 5 credits";
      expect(isSnippetCaptured(chunk, snippet)).toBe(false);
    });
  });

  describe("computeRecallAtK", () => {
    const rankedChunks = [
      "Introduction to Cortex AI architecture",
      "The search agent costs 5 credits per request",
      "Rate limits apply to all agents equally",
      "Support SLA is 2 business days"
    ];

    it("returns 0.0 when snippet is outside top-1", () => {
      const recallAt1 = computeRecallAtK(rankedChunks, "costs 5 credits", 1);
      expect(recallAt1).toBe(0.0);
    });

    it("returns 1.0 when snippet is inside top-2 or top-3", () => {
      const recallAt2 = computeRecallAtK(rankedChunks, "costs 5 credits", 2);
      const recallAt3 = computeRecallAtK(rankedChunks, "costs 5 credits", 3);
      expect(recallAt2).toBe(1.0);
      expect(recallAt3).toBe(1.0);
    });

    it("returns null for adversarial queries without reference snippet", () => {
      expect(computeRecallAtK(rankedChunks, null, 3)).toBeNull();
    });
  });

  describe("evaluateFaithfulness", () => {
    it("recognizes standard out-of-scope refusals with faithfulness score 1.0", async () => {
      const res = await evaluateFaithfulness({
        question: "What is the stock ticker?",
        answer: "I couldn't find this information in the uploaded PDF.",
        context: "The company builds robotics equipment.",
        llm: null
      });

      expect(res.score).toBe(1.0);
      expect(res.isRefusal).toBe(true);
    });

    it("evaluates atomic claims via LLM-as-a-judge", async () => {
      const mockLlm = {
        invoke: vi.fn().mockResolvedValue({
          content: JSON.stringify({
            claims: [
              { claim: "The search agent costs 5 credits", grounded: true, reason: "In context" },
              { claim: "It runs on GPU servers", grounded: false, reason: "Not mentioned in context" }
            ]
          })
        })
      };

      const res = await evaluateFaithfulness({
        question: "How many credits does search cost?",
        answer: "The search agent costs 5 credits and it runs on GPU servers.",
        context: "The search agent costs 5 credits per request.",
        llm: mockLlm
      });

      expect(res.score).toBe(0.5);
      expect(res.claims).toHaveLength(2);
      expect(res.claims[0].grounded).toBe(true);
      expect(res.claims[1].grounded).toBe(false);
    });

    it("falls back to heuristic when LLM call throws", async () => {
      const failingLlm = {
        invoke: vi.fn().mockRejectedValue(new Error("API rate limit"))
      };

      const context = "Solar panels achieve 20-22% efficiency under standard test conditions.";
      const answer = "Solar panels achieve 20-22% efficiency.";

      const res = await evaluateFaithfulness({
        question: "What efficiency do panels achieve?",
        answer,
        context,
        llm: failingLlm
      });

      expect(res.score).toBeGreaterThanOrEqual(0.8);
      expect(res.claims.length).toBeGreaterThan(0);
    });
  });

  describe("heuristicFaithfulnessFallback", () => {
    it("handles empty answers gracefully", () => {
      const res = heuristicFaithfulnessFallback("", "Some context");
      expect(res.score).toBe(1.0);
    });
  });
});
