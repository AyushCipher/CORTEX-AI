import { describe, it, expect } from "vitest";
import { summarize, toMarkdown } from "./run-rag-eval.js";

describe("eval/run-rag-eval reporting", () => {
  const sampleResults = [
    {
      id: "q-1",
      doc: "doc-1.pdf",
      section: "Sec 1",
      type: "factual",
      question: "How many credits?",
      expectedAnswer: "5 credits",
      actualAnswer: "It costs 5 credits.",
      retrieval: {
        recallAt1: 1.0,
        recallAt3: 1.0,
        recallAt5: 1.0,
        hit: "HIT"
      },
      faithfulness: {
        score: 1.0,
        claims: [{ claim: "It costs 5 credits", grounded: true }],
        isRefusal: false
      },
      correctness: "PASS",
      note: ""
    },
    {
      id: "q-2",
      doc: "doc-1.pdf",
      section: "Sec 2",
      type: "factual",
      question: "What is the rate limit?",
      expectedAnswer: "5 req/min",
      actualAnswer: "The limit is 5 req/min.",
      retrieval: {
        recallAt1: 0.0,
        recallAt3: 1.0,
        recallAt5: 1.0,
        hit: "HIT"
      },
      faithfulness: {
        score: 0.9,
        claims: [{ claim: "The limit is 5 req/min", grounded: true }],
        isRefusal: false
      },
      correctness: "PASS",
      note: ""
    },
    {
      id: "q-3",
      doc: "doc-1.pdf",
      section: "n/a",
      type: "adversarial",
      question: "What is the stock ticker?",
      expectedAnswer: "I couldn't find this information",
      actualAnswer: "I couldn't find this information in the uploaded PDF.",
      retrieval: {
        recallAt1: null,
        recallAt3: null,
        recallAt5: null,
        hit: "n/a"
      },
      faithfulness: {
        score: 1.0,
        claims: [],
        isRefusal: true
      },
      correctness: "PASS",
      note: "Correctly refused"
    }
  ];

  it("summarizes Recall@1, Recall@3, Recall@5 and Faithfulness accurately", () => {
    const summary = summarize(sampleResults);

    expect(summary.total).toBe(3);
    expect(summary.factualCount).toBe(2);
    expect(summary.adversarialCount).toBe(1);

    // Mean Recall@1: (1.0 + 0.0) / 2 = 0.5 (50.0%)
    expect(summary.metrics.meanRecallAt1).toBe(0.5);
    expect(summary.retrievalRecall.recallAt1).toBe("50.0%");

    // Mean Recall@3 & Recall@5: (1.0 + 1.0) / 2 = 1.0 (100.0%)
    expect(summary.metrics.meanRecallAt3).toBe(1.0);
    expect(summary.retrievalRecall.recallAt3).toBe("100.0%");
    expect(summary.metrics.meanRecallAt5).toBe(1.0);
    expect(summary.retrievalRecall.recallAt5).toBe("100.0%");

    // Mean Faithfulness: (1.0 + 0.9 + 1.0) / 3 = 0.9667
    expect(summary.metrics.meanFaithfulness).toBeCloseTo(0.9667, 3);
    expect(summary.correctness.pass).toBe("3/3 (100%)");
  });

  it("generates markdown with Recall@k and Faithfulness columns", () => {
    const summary = summarize(sampleResults);
    const md = toMarkdown(sampleResults, summary);

    expect(md).toContain("PDF RAG Eval Report: Recall@k & Faithfulness");
    expect(md).toContain("**Mean Recall@1:** 50.0%");
    expect(md).toContain("**Mean Recall@3:** 100.0%");
    expect(md).toContain("**Mean Faithfulness (LLM-as-a-Judge):** 96.7%");
    expect(md).toContain("| R@1 | R@3 | R@5 | Faithfulness | Correctness |");
    expect(md).toContain("| q-1 |");
  });
});
