/**
 * Information Retrieval and Generation Evaluation Metrics for RAG Pipelines.
 *
 * Implements:
 * 1. Recall@k: Computes whether the golden reference snippet (or keyword representation)
 *    is captured in the top-k retrieved chunks.
 * 2. Faithfulness (LLM-as-a-judge Claim Verification):
 *    Extracts atomic factual claims from the model's answer, and verifies each claim
 *    strictly against the retrieved context chunks.
 *    faithfulness = (grounded claims count) / (total claims count).
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export const normalize = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Checks if a snippet or text is contained within a candidate chunk text.
 * Uses normalized fuzzy token / substring matching.
 */
export const isSnippetCaptured = (candidateText, snippet) => {
  if (!candidateText || !snippet) return false;
  const normCandidate = normalize(candidateText);
  const normSnippet = normalize(snippet);
  if (!normSnippet) return false;

  // Exact normalized substring match
  if (normCandidate.includes(normSnippet)) return true;

  // Token-level containment (handles minor whitespace/punctuation or partial extraction differences)
  const snippetTokens = normSnippet.split(" ").filter((t) => t.length > 2);
  if (snippetTokens.length === 0) return false;

  const matchedTokens = snippetTokens.filter((token) => normCandidate.includes(token));
  return matchedTokens.length / snippetTokens.length >= 0.85;
};

/**
 * Compute Recall@k for a single query.
 * For a factual entry with a reference snippet, returns 1.0 if the snippet is found
 * in any of the top-k chunks, else 0.0.
 * For adversarial entries (no reference snippet), returns null.
 *
 * @param {Array<string>} rankedChunks - Retrieved chunks ordered by rank (1 to N)
 * @param {string|null} referenceSnippet - Golden ground-truth snippet
 * @param {number} k - Cutoff rank (e.g. 1, 3, 5)
 * @returns {number|null} 1.0, 0.0, or null
 */
export const computeRecallAtK = (rankedChunks, referenceSnippet, k) => {
  if (!referenceSnippet) return null;
  const topKChunks = rankedChunks.slice(0, k);
  const found = topKChunks.some((chunk) => isSnippetCaptured(chunk, referenceSnippet));
  return found ? 1.0 : 0.0;
};

/**
 * Evaluates the faithfulness of an answer against retrieved context using LLM-as-a-Judge.
 * Deconstructs the response into atomic claims and verifies if each claim is supported by context.
 *
 * @param {Object} params
 * @param {string} params.question - User question
 * @param {string} params.answer - Model's generated answer
 * @param {string} params.context - Concatenated retrieved context
 * @param {Object} params.llm - LangChain chat model instance
 * @returns {Promise<{ score: number, claims: Array<{ claim: string, grounded: boolean, reason: string }>, isRefusal: boolean }>}
 */
export const evaluateFaithfulness = async ({ question, answer, context, llm }) => {
  const normAnswer = normalize(answer);

  const REFUSAL_FALLBACKS = [
    "couldn't find this information",
    "could not find this information",
    "not present in the uploaded pdf",
    "not found in the pdf",
    "no information about this"
  ];

  const isRefusal = REFUSAL_FALLBACKS.some((r) => normAnswer.includes(normalize(r)));
  if (isRefusal) {
    return {
      score: 1.0,
      claims: [
        {
          claim: "Document does not contain the requested information",
          grounded: true,
          reason: "Standard honest refusal without hallucinating"
        }
      ],
      isRefusal: true
    };
  }

  if (!answer || answer.trim().length === 0) {
    return {
      score: 0.0,
      claims: [],
      isRefusal: false
    };
  }

  const systemPrompt = `You are an impartial, strict evaluation judge measuring the FAITHFULNESS of a RAG-generated answer against retrieved source context.

Your task:
1. Break down the generated answer into discrete, atomic factual statements/claims.
2. For each atomic claim, verify whether it is STRICTLY directly inferred from or supported by the provided CONTEXT.
3. If an answer claim makes assumptions or introduces facts NOT in the context, mark grounded as false.
4. Output STRICT JSON in the following format:
{
  "claims": [
    {
      "claim": "The exact factual claim extracted from the answer",
      "grounded": true or false,
      "reason": "Brief explanation citing context or lack thereof"
    }
  ]
}
Do NOT include markdown formatting or backticks outside the JSON. Return valid JSON only.`;

  const humanPrompt = `CONTEXT:
${context}

QUESTION:
${question}

ANSWER TO EVALUATE:
${answer}`;

  try {
    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(humanPrompt)
    ]);

    const raw = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    // Strip code fences if returned
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
    if (claims.length === 0) {
      return { score: 1.0, claims: [], isRefusal: false };
    }

    const groundedCount = claims.filter((c) => Boolean(c.grounded)).length;
    const score = Number((groundedCount / claims.length).toFixed(4));

    return {
      score,
      claims,
      isRefusal: false
    };
  } catch (err) {
    // Fallback heuristic if LLM judge call fails or JSON parse fails
    return heuristicFaithfulnessFallback(answer, context);
  }
};

/**
 * Lightweight heuristic fallback for faithfulness if LLM-as-a-judge is unavailable.
 */
export const heuristicFaithfulnessFallback = (answer, context) => {
  const normContext = normalize(context);
  const sentences = (answer || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && !s.startsWith("#"));

  if (sentences.length === 0) {
    return { score: 1.0, claims: [], isRefusal: false };
  }

  const claims = sentences.map((sentence) => {
    const tokens = normalize(sentence).split(" ").filter((t) => t.length > 3);
    const supportedTokens = tokens.filter((t) => normContext.includes(t));
    const grounded = tokens.length === 0 || supportedTokens.length / tokens.length >= 0.6;
    return {
      claim: sentence,
      grounded,
      reason: grounded ? "Key entities grounded in retrieved context" : "Contains ungrounded tokens"
    };
  });

  const groundedCount = claims.filter((c) => c.grounded).length;
  return {
    score: Number((groundedCount / claims.length).toFixed(4)),
    claims,
    isRefusal: false
  };
};
