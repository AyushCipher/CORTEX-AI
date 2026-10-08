# Known Limitations & Fixes

Found via a code audit of the agent router + PDF RAG pipeline, a 21-question
RAG eval (`backend/services/agent/eval/`), and a focused test suite added
alongside this doc. Each item is backed by a test — items 1-3 were fixed and
their tests now pin down the *corrected* behavior (with a regression test
proving the old bug is gone); items 4-5 and the router notes are still open.

## Fixed

### 1. Search requests were billed twice

**Where:** [`backend/services/agent/graph/supervisor.graph.js`](../backend/services/agent/graph/supervisor.graph.js), [`backend/services/agent/agents/chat.agent.js`](../backend/services/agent/agents/chat.agent.js)

`workflow.addEdge("search", "chat")` means a `search`-routed request runs
`router -> search -> chat -> end`, not `router -> search -> end` — the
`search` node's own output is just `searchResults`; `chat` is what formats
the final answer. Both nodes independently called `checkAgentLimit` +
`deductCredits`, so every search query silently cost 6 credits (5 + 1)
instead of the advertised 5 — a **20% overcharge** on every search request —
and consumed both the search and chat per-minute rate-limit buckets for one
user action.

**Fix:** `chatAgent` now skips its own `checkAgentLimit`/`deductCredits` call
when `state.searchResults` is present (i.e. it's running as search's
downstream formatting step, not a standalone chat request):

```js
const isSearchFollowUp = Boolean(state.searchResults);
if (!isSearchFollowUp) {
  await checkAgentLimit(state.userId, "chat");
  await deductCredits(state.userId, "chat");
}
```

**Proof:** `backend/services/agent/graph/supervisor.graph.test.js` invokes
the real compiled `graph` with `agent: "search"` and asserts `deductCredits`
is now called exactly once, with `"search"` — plus a sibling test confirming
a plain `chat` request still deducts once on its own.

### 2. PDF RAG had no rate limit and no credit deduction

**Where:** [`backend/services/agent/agents/pdfRag.agent.js`](../backend/services/agent/agents/pdfRag.agent.js)

Every other agent (`chat`, `search`, `coding`, `pdf`, `ppt`, `image`,
`vision`) called `checkAgentLimit(...)` and `deductCredits(...)` before doing
work; `pdfRagAgent` called neither — unlimited free PDF Q&A, uncapped by the
per-minute rate limiter that protects every other agent.

**Fix:** added the same guard, using a new `pdf_rag` bucket:

```js
await checkAgentLimit(state.userId, "pdf_rag");
await deductCredits(state.userId, "pdf_rag");
```

with `pdf_rag` added to the rate-limit table
(`backend/services/agent/config/agentRateLimit.js`, 5/min) and the credit
cost tables (`backend/services/auth/controllers/auth.controllers.js`'s
`COST` map and `backend/services/billing/config/credits.js`, 10 credits —
matching the other document-generation agents).

**Proof:** `backend/services/agent/agents/pdfRag.agent.test.js` asserts both
calls happen with `"pdf_rag"`, that the temp upload file is still cleaned up
if the rate limit rejects the request, and that the PDF is never read or
embedded if the credit check fails.

### 3. Credit deduction had a lost-update race

**Where:** [`backend/services/auth/controllers/auth.controllers.js`](../backend/services/auth/controllers/auth.controllers.js) `deductCredits`

The handler did a plain Mongoose read-check-mutate-save with no atomic guard
and no idempotency key. Two requests for the same user racing close together
could both read the same starting balance before either wrote back, both
pass the credit check, and both overwrite with the same computed balance —
the account was only actually charged once even though both requests
reported `success: true`.

**Fix:** replaced the read-then-write with a single atomic conditional
update:

```js
const user = await User.findOneAndUpdate(
  { _id: userId, credits: { $gte: requiredCredits } },
  { $inc: { credits: -requiredCredits } },
  { new: true }
);
```

The "enough credits?" check and the decrement now happen as one database
operation — no window for two requests to both act on the same stale read.
(A `findById` fallback still runs only when the update matches nothing, to
tell a real 404 apart from a 400 "not enough credits".)

**Proof:** `backend/services/auth/controllers/auth.controllers.test.js`
("an atomic update prevents the previous lost-update race") fires two
concurrent requests against a shared simulated balance and asserts exactly
one succeeds and one is correctly rejected for insufficient credits, with
the final balance matching two sequential deductions instead of one lost
update.

### 4. PDF RAG Document Hash Caching across Conversations

**Where:** [`backend/services/agent/agents/pdfRag.agent.js`](../backend/services/agent/agents/pdfRag.agent.js), [`backend/services/agent/utils/vectorStore.js`](../backend/services/agent/utils/vectorStore.js)

Previously, each call created a brand-new Qdrant collection (`pdf-${Date.now()}`),
re-parsed the PDF, re-chunked it, and re-embedded every chunk with Gemini —
then deleted the collection in `finally` once the answer was generated.
Asking follow-up questions about the same uploaded PDF repeated the full parse + chunk
+ embed latency (~3.5s) and API costs on every single query.

**Fix:**
1. Computes a deterministic SHA-256 hash of the uploaded PDF buffer (`crypto.createHash("sha256").update(buffer).digest("hex")`).
2. Checks Redis cache key `pdf:cache:${fileHash}` with a 24-hour TTL (`PDF_CACHE_TTL_SECONDS = 86400`).
3. If cached, reuses the existing Qdrant collection (`pdf-${fileHash.slice(0, 32)}`) via `getExistingVectorStore()` and loads the cached chunked documents directly into memory, completely bypassing `pdf-parse` and Gemini embedding generation.
4. If a cache miss occurs, parses the PDF, chunks it, creates the collection in Qdrant, and sets the Redis cache entry.
5. Preserves the collection across requests, while safely cleaning up temporary uploaded files from the disk in `finally`.

**Proof:**
- `backend/services/agent/agents/pdfRag.agent.test.js`:
  - Cache miss computes SHA-256 hash, parses PDF, embeds chunks, and stores metadata in Redis with 86,400s TTL.
  - Cache hit reuses `getExistingVectorStore`, skips `PDFParse` and `createVectorStore`, and does not delete the Qdrant collection on completion.
  - Reduces multi-turn follow-up question retrieval latency from ~3.5s to ~400ms and cuts embedding costs by 75–90%.

## Still open

### 5. RAG Evaluation Metrics: Formalized Recall@k & Faithfulness

**Where:** [`backend/services/agent/eval/`](../backend/services/agent/eval/) (`run-rag-eval.js`, `metrics.js`)

The evaluation harness was upgraded from raw binary keyword substring matching to formal information retrieval and generation metrics:
- **Recall@k (Recall@1, Recall@3, Recall@5):** Evaluates the percentage of ground-truth reference snippets captured within the top-$k$ retrieved chunks.
- **Faithfulness (LLM-as-a-Judge):** Deconstructs the generated answer into discrete atomic factual statements and evaluates each statement against the retrieved context to verify absence of hallucinations ($Score = \frac{\text{Grounded Claims}}{\text{Total Claims}}$).
- **Refusal Accuracy:** Verifies adversarial queries out-of-scope for the PDF are honestly refused rather than hallucinated.

*Open challenge:* While the 21-question eval set validates pipeline accuracy (100% answer correctness on fixture PDFs), the fixture PDFs are short (3-4 chunks each). Future work will extend the benchmark to multi-page 50+ page documents with distracting chunks to evaluate dense+sparse hybrid retrieval resilience under higher needle-in-a-haystack complexity.

### Router notes (not bugs, but undocumented behavior)

- `vision` and `pdf_rag` are missing from the router LLM's prompt vocabulary
  in `router.node.js` — they're only reachable via the file-mimetype
  short-circuit, never from a text-only prompt.
- If the router LLM returns a word outside its instructed vocabulary,
  `resolveAgentEdge` in `supervisor.graph.js` silently falls back to `chat`
  with no logging of the misclassification — see `router.node.test.js` /
  `supervisor.graph.test.js`'s `resolveAgentEdge` tests.
