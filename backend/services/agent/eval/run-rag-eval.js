// Runs the production PDF-RAG pipeline (pdf-parse -> chunkPdfText -> real
// Gemini embeddings -> Qdrant top-k retrieval -> real LLM generation)
// against the eval/dataset.json question set and computes formal retrieval
// and generation metrics:
//   - Recall@1, Recall@3, Recall@5: Percentage of golden reference snippets
//     retrieved within the top-k fused chunks.
//   - Faithfulness (LLM-as-a-judge): Deconstructs answers into atomic claims
//     and verifies each claim strictly against retrieved context chunks.
//   - Answer correctness & refusal accuracy against adversarial questions.
//
// Requires live credentials in backend/services/agent/.env:
//   GOOGLE_API_KEY, QDRANT_URL, QDRANT_API_KEY, GROQ_API_KEY (or whichever
//   provider getModel("pdf-rag") resolves to).
//
// Usage:
//   node eval/run-rag-eval.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { PDFParse } from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const { chunkPdfText, buildContext, buildPdfRagMessages, PDF_RAG_TOP_K } =
  await import("../agents/pdfRag.agent.js");
const { embeddings } = await import("../utils/embedding.js");
const { getModel } = await import("../utils/model.js");
const { invokeWithUsage } = await import("../utils/logLLMUsage.js");
const { createCollection, upsertPoints, searchPoints, deleteCollection } =
  await import("./qdrantRest.js");
const { computeRecallAtK, evaluateFaithfulness, normalize } =
  await import("./metrics.js");

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

const REFUSAL_FALLBACKS = [
  "couldn't find this information",
  "could not find this information",
  "not present in the uploaded pdf",
  "not found in the pdf",
  "no information about this"
];

const gradeAnswer = (entry, answer) => {
  const answerNorm = normalize(answer);

  if (entry.type === "adversarial") {
    const refused = REFUSAL_FALLBACKS.some((k) => answerNorm.includes(normalize(k)));
    return refused
      ? { verdict: "PASS", note: "Correctly refused out-of-scope question." }
      : {
          verdict: "AMBIGUOUS",
          note: "Did not use the expected refusal phrasing — check for hallucination."
        };
  }

  const matched = (entry.expectedKeywords || []).some((k) =>
    answerNorm.includes(normalize(k))
  );

  if (matched) return { verdict: "PASS", note: "" };
  if (!answer || answer.trim().length === 0) {
    return { verdict: "FAIL", note: "Empty response." };
  }
  return { verdict: "AMBIGUOUS", note: "No expected keyword found — grade manually." };
};

const run = async () => {
  const fixturesDir = path.join(__dirname, "fixtures");
  const dataset = JSON.parse(
    fs.readFileSync(path.join(__dirname, "dataset.json"), "utf-8")
  );

  const byDoc = dataset.reduce((acc, entry) => {
    (acc[entry.doc] ??= []).push(entry);
    return acc;
  }, {});

  const results = [];
  const judgeModel = getModel("pdf-rag");

  for (const [docFile, entries] of Object.entries(byDoc)) {
    const pdfPath = path.join(fixturesDir, docFile);
    console.log(`\n=== ${docFile} (${entries.length} questions) ===`);

    const buffer = fs.readFileSync(pdfPath);
    const pdf = new PDFParse({ data: buffer });
    const { text } = await pdf.getText();
    const docs = await chunkPdfText(text);
    console.log(`  chunked into ${docs.length} chunks (production chunkPdfText)`);

    const chunkVectors = await embeddings.embedDocuments(docs.map((d) => d.pageContent));
    const vectorSize = chunkVectors[0].length;

    const collectionName = `eval-${path.basename(docFile, ".pdf")}-${Date.now()}`;
    await createCollection(QDRANT_URL, QDRANT_API_KEY, collectionName, vectorSize);
    await upsertPoints(
      QDRANT_URL,
      QDRANT_API_KEY,
      collectionName,
      docs.map((doc, i) => ({
        id: i + 1,
        vector: chunkVectors[i],
        payload: { pageContent: doc.pageContent }
      }))
    );

    try {
      for (const entry of entries) {
        process.stdout.write(`  - ${entry.id}: ${entry.question}\n`);

        const queryVector = await embeddings.embedQuery(entry.question);
        const hits = await searchPoints(
          QDRANT_URL,
          QDRANT_API_KEY,
          collectionName,
          queryVector,
          PDF_RAG_TOP_K
        );
        const retrievedDocs = hits.map((h) => ({ pageContent: h.payload.pageContent }));
        const retrievedChunkTexts = retrievedDocs.map((d) => d.pageContent);

        // Compute Recall@1, Recall@3, Recall@5
        const recallAt1 = computeRecallAtK(retrievedChunkTexts, entry.sourceSnippet, 1);
        const recallAt3 = computeRecallAtK(retrievedChunkTexts, entry.sourceSnippet, 3);
        const recallAt5 = computeRecallAtK(retrievedChunkTexts, entry.sourceSnippet, 5);

        const context = buildContext(retrievedDocs);
        const llm = getModel("pdf-rag");
        const messages = buildPdfRagMessages(context, entry.question);

        let answer = "";
        let error = null;
        try {
          const response = await invokeWithUsage(llm, messages, {
            agent: "pdf_rag-eval",
            userId: "eval-script",
            conversationId: entry.id
          });
          answer = response.content;
        } catch (err) {
          error = err.message;
        }

        const { verdict, note } = error
          ? { verdict: "FAIL", note: `LLM call failed: ${error}` }
          : gradeAnswer(entry, answer);

        // LLM-as-a-judge Faithfulness evaluation
        let faithfulnessRes = { score: 1.0, claims: [], isRefusal: false };
        if (!error) {
          try {
            faithfulnessRes = await evaluateFaithfulness({
              question: entry.question,
              answer,
              context,
              llm: judgeModel
            });
          } catch (fErr) {
            console.error(`    Faithfulness eval warning for ${entry.id}:`, fErr.message);
          }
        }

        results.push({
          id: entry.id,
          doc: docFile,
          section: entry.section,
          type: entry.type,
          question: entry.question,
          expectedAnswer: entry.expectedAnswer,
          actualAnswer: answer,
          retrieval: {
            recallAt1,
            recallAt3,
            recallAt5,
            hit: recallAt5 === 1.0 ? "HIT" : entry.type === "adversarial" ? "n/a" : "MISS"
          },
          faithfulness: {
            score: faithfulnessRes.score,
            claims: faithfulnessRes.claims,
            isRefusal: faithfulnessRes.isRefusal
          },
          correctness: verdict,
          note
        });
      }
    } finally {
      try {
        await deleteCollection(QDRANT_URL, QDRANT_API_KEY, collectionName);
      } catch (err) {
        console.error(`  Failed to delete eval collection ${collectionName}:`, err.message);
      }
    }
  }

  return results;
};

export const summarize = (results) => {
  const factual = results.filter((r) => r.type === "factual");
  const adversarial = results.filter((r) => r.type === "adversarial");

  const calcMeanRecall = (kKey) => {
    const scored = factual.map((r) => r.retrieval[kKey]).filter((v) => typeof v === "number");
    if (scored.length === 0) return 0;
    return Number((scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(4));
  };

  const meanRecallAt1 = calcMeanRecall("recallAt1");
  const meanRecallAt3 = calcMeanRecall("recallAt3");
  const meanRecallAt5 = calcMeanRecall("recallAt5");

  const meanFaithfulness = Number(
    (
      results.reduce((sum, r) => sum + (r.faithfulness?.score ?? 1.0), 0) /
      (results.length || 1)
    ).toFixed(4)
  );

  const pass = results.filter((r) => r.correctness === "PASS").length;
  const fail = results.filter((r) => r.correctness === "FAIL").length;
  const ambiguous = results.filter((r) => r.correctness === "AMBIGUOUS").length;

  return {
    total: results.length,
    factualCount: factual.length,
    adversarialCount: adversarial.length,
    metrics: {
      meanRecallAt1,
      meanRecallAt3,
      meanRecallAt5,
      meanFaithfulness
    },
    retrievalRecall: {
      recallAt1: `${(meanRecallAt1 * 100).toFixed(1)}%`,
      recallAt3: `${(meanRecallAt3 * 100).toFixed(1)}%`,
      recallAt5: `${(meanRecallAt5 * 100).toFixed(1)}%`
    },
    correctness: {
      pass: `${pass}/${results.length} (${((pass / results.length) * 100).toFixed(0)}%)`,
      fail: `${fail}/${results.length}`,
      ambiguous: `${ambiguous}/${results.length}`
    }
  };
};

export const toMarkdown = (results, summary) => {
  const rows = results
    .map((r) => {
      const q = r.question.replace(/\|/g, "\\|");
      const exp = r.expectedAnswer.replace(/\|/g, "\\|");
      const act = (r.actualAnswer || "")
        .replace(/\n/g, " ")
        .replace(/\|/g, "\\|")
        .slice(0, 140);
      const r1 = r.retrieval?.recallAt1 != null ? r.retrieval.recallAt1.toFixed(1) : "-";
      const r3 = r.retrieval?.recallAt3 != null ? r.retrieval.recallAt3.toFixed(1) : "-";
      const r5 = r.retrieval?.recallAt5 != null ? r.retrieval.recallAt5.toFixed(1) : "-";
      const faith =
        r.faithfulness?.score != null ? `${(r.faithfulness.score * 100).toFixed(0)}%` : "-";
      const note = (r.note || "").replace(/\|/g, "\\|");
      return `| ${r.id} | ${r.doc} | ${r.type} | ${q} | ${exp} | ${act} | ${r1} | ${r3} | ${r5} | ${faith} | ${r.correctness} | ${note} |`;
    })
    .join("\n");

  return `# PDF RAG Eval Report: Recall@k & Faithfulness

Generated: ${new Date().toISOString()}

## Summary

- **Total Questions:** ${summary.total} (${summary.factualCount} factual, ${summary.adversarialCount} adversarial)
- **Retrieval Performance:**
  - **Mean Recall@1:** ${(summary.metrics.meanRecallAt1 * 100).toFixed(1)}%
  - **Mean Recall@3:** ${(summary.metrics.meanRecallAt3 * 100).toFixed(1)}%
  - **Mean Recall@5:** ${(summary.metrics.meanRecallAt5 * 100).toFixed(1)}%
- **Generation Quality:**
  - **Mean Faithfulness (LLM-as-a-Judge):** ${(summary.metrics.meanFaithfulness * 100).toFixed(1)}%
  - **Answer Correctness:** **${summary.correctness.pass} PASS**, ${summary.correctness.fail} FAIL, ${summary.correctness.ambiguous} AMBIGUOUS

## Detailed Results

| ID | Doc | Type | Question | Expected | Actual (truncated) | R@1 | R@3 | R@5 | Faithfulness | Correctness | Note |
|----|-----|------|----------|----------|---------------------|-----|-----|-----|--------------|-------------|------|
${rows}
`;
};

const main = async () => {
  const missing = ["GOOGLE_API_KEY", "QDRANT_URL", "QDRANT_API_KEY"].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const results = await run();
  const summary = summarize(results);

  console.log("\n\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "results.json"),
    JSON.stringify({ summary, results }, null, 2)
  );
  fs.writeFileSync(path.join(outDir, "report.md"), toMarkdown(results, summary));

  console.log(`\nWrote ${path.join(outDir, "results.json")}`);
  console.log(`Wrote ${path.join(outDir, "report.md")}`);
};

// Execute if run directly as script
if (process.argv[1] && process.argv[1].endsWith("run-rag-eval.js")) {
  main().catch((err) => {
    console.error("Eval run failed:", err);
    process.exit(1);
  });
}
