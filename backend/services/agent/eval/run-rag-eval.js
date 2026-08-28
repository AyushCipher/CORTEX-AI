// Runs the production PDF-RAG pipeline (pdf-parse -> chunkPdfText -> real
// Gemini embeddings -> Qdrant top-k retrieval -> real LLM generation)
// against the eval/dataset.json question set and prints a retrieval-hit-rate
// + answer-correctness report.
//
// Requires live credentials in backend/services/agent/.env:
//   GOOGLE_API_KEY, QDRANT_URL, QDRANT_API_KEY, GROQ_API_KEY (or whichever
//   provider getModel("pdf-rag") resolves to).
//
// Usage:
//   node eval/run-rag-eval.js
//
// Two intentional deviations from the exact production code path, both
// scoped to this script only (see eval/qdrantRest.js and comments below):
//
// 1. Storage/search against Qdrant goes through a small raw REST client
//    (eval/qdrantRest.js) instead of @langchain/qdrant's QdrantVectorStore.
//    In this sandbox, @qdrant/js-client-rest's requests get reset by Qdrant
//    Cloud's edge (reproducible, isolated to that one SDK — plain axios
//    calls to the same endpoints, including calls interleaved with real
//    Gemini embedding calls, do not fail). Chunking, the embedding model,
//    top-k, and the generation prompt/model are all unchanged production
//    code (chunkPdfText / buildContext / buildPdfRagMessages / getModel /
//    invokeWithUsage from agents/pdfRag.agent.js).
// 2. One Qdrant collection is created per source PDF and reused across all
//    of that PDF's questions (deleted afterward), unlike production which
//    creates and tears down a fresh collection on every single request.
//    That per-request re-embedding is itself a documented limitation — see
//    docs/known-limitations.md — this just avoids re-paying that embedding
//    cost N times for identical chunks during the eval run.
//
// Caveat on the results: the three fixture PDFs are short (3-4 chunks each),
// so every chunk fits inside the top-5 retrieval window and retrieval hit
// rate is close to guaranteed by construction. A 100% hit rate here mainly
// demonstrates the pipeline is wired correctly end-to-end, not that
// retrieval holds up on longer documents — see docs/known-limitations.md.

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

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

const REFUSAL_FALLBACKS = [
  "couldn't find this information",
  "could not find this information",
  "not present in the uploaded pdf",
  "not found in the pdf",
  "no information about this"
];

const normalize = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

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

const gradeRetrieval = (entry, retrievedTexts) => {
  if (entry.type === "adversarial" || !entry.sourceSnippet) {
    return "n/a";
  }
  const haystack = normalize(retrievedTexts.join(" \n "));
  return haystack.includes(normalize(entry.sourceSnippet)) ? "HIT" : "MISS";
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
        const retrievalVerdict = gradeRetrieval(
          entry,
          retrievedDocs.map((d) => d.pageContent)
        );

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

        results.push({
          id: entry.id,
          doc: docFile,
          section: entry.section,
          type: entry.type,
          question: entry.question,
          expectedAnswer: entry.expectedAnswer,
          actualAnswer: answer,
          retrieval: retrievalVerdict,
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

const summarize = (results) => {
  const factual = results.filter((r) => r.type === "factual");
  const adversarial = results.filter((r) => r.type === "adversarial");

  const hits = factual.filter((r) => r.retrieval === "HIT").length;
  const pass = results.filter((r) => r.correctness === "PASS").length;
  const fail = results.filter((r) => r.correctness === "FAIL").length;
  const ambiguous = results.filter((r) => r.correctness === "AMBIGUOUS").length;

  return {
    total: results.length,
    factualCount: factual.length,
    adversarialCount: adversarial.length,
    retrievalHitRate: factual.length
      ? `${hits}/${factual.length} (${((hits / factual.length) * 100).toFixed(0)}%)`
      : "n/a",
    correctness: {
      pass: `${pass}/${results.length} (${((pass / results.length) * 100).toFixed(0)}%)`,
      fail: `${fail}/${results.length}`,
      ambiguous: `${ambiguous}/${results.length}`
    }
  };
};

const toMarkdown = (results, summary) => {
  const rows = results
    .map((r) => {
      const q = r.question.replace(/\|/g, "\\|");
      const exp = r.expectedAnswer.replace(/\|/g, "\\|");
      const act = (r.actualAnswer || "")
        .replace(/\n/g, " ")
        .replace(/\|/g, "\\|")
        .slice(0, 160);
      const note = (r.note || "").replace(/\|/g, "\\|");
      return `| ${r.id} | ${r.doc} | ${r.type} | ${q} | ${exp} | ${act} | ${r.retrieval} | ${r.correctness} | ${note} |`;
    })
    .join("\n");

  return `# PDF RAG Eval Report

Generated: ${new Date().toISOString()}

## Summary

- Total questions: ${summary.total} (${summary.factualCount} factual, ${summary.adversarialCount} adversarial)
- Retrieval hit rate (factual questions only, top-${PDF_RAG_TOP_K}): **${summary.retrievalHitRate}**
- Answer correctness: **${summary.correctness.pass} PASS**, ${summary.correctness.fail} FAIL, ${summary.correctness.ambiguous} AMBIGUOUS (needs manual grading)

## Results

| ID | Doc | Type | Question | Expected | Actual (truncated) | Retrieval | Correctness | Note |
|----|-----|------|----------|----------|---------------------|-----------|--------------|------|
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

main().catch((err) => {
  console.error("Eval run failed:", err);
  process.exit(1);
});
