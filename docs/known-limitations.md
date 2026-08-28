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

## Still open

### 4. PDF RAG re-embeds the entire document on every question

**Where:** [`backend/services/agent/agents/pdfRag.agent.js`](../backend/services/agent/agents/pdfRag.agent.js)

Each call creates a brand-new Qdrant collection (`pdf-${Date.now()}`),
re-parses the PDF, re-chunks it, and re-embeds every chunk with Gemini —
then deletes the collection in `finally` once the answer is generated.
There is no persistent index for a document across a conversation: asking a
second question about the same uploaded PDF repeats the full parse + chunk
+ embed cost from scratch.

**Likely fix:** key the Qdrant collection off `conversationId` (or a content
hash of the PDF) and reuse it for follow-up questions in the same
conversation, with a TTL-based or explicit cleanup instead of
delete-after-every-request.

### 5. The RAG eval doesn't yet stress-test retrieval at scale

**Where:** `backend/services/agent/eval/`

The eval run (`node eval/run-rag-eval.js`) against the real pipeline scored
**21/21 (100%) answer correctness** and **18/18 (100%) retrieval hit rate**
— see `eval/results/report.md`. That's a genuine result against the real
embedding model, real Qdrant retrieval, and real generation, but the three
fixture PDFs are short (3-4 chunks each after production chunking), so every
chunk fits inside the top-5 retrieval window regardless of query. A 100%
hit rate here mainly proves the pipeline is wired correctly end-to-end — it
does not demonstrate that retrieval holds up on a real multi-page document
where the correct chunk has to be found among dozens of competing ones.

### Router notes (not bugs, but undocumented behavior)

- `vision` and `pdf_rag` are missing from the router LLM's prompt vocabulary
  in `router.node.js` — they're only reachable via the file-mimetype
  short-circuit, never from a text-only prompt.
- If the router LLM returns a word outside its instructed vocabulary,
  `resolveAgentEdge` in `supervisor.graph.js` silently falls back to `chat`
  with no logging of the misclassification — see `router.node.test.js` /
  `supervisor.graph.test.js`'s `resolveAgentEdge` tests.
