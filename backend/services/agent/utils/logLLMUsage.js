import { createLogger } from "../../../shared/logger/logger.js";

const logger = createLogger("agent:llm-usage");

// Illustrative pricing per 1M tokens (USD). Update to match current provider rates.
const MODEL_PRICING = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "deepseek/deepseek-chat": { input: 0.14, output: 0.28 }
};

const extractUsage = (response) => {
  const usage = response?.usage_metadata;

  if (usage) {
    return {
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      totalTokens: usage.total_tokens ?? null
    };
  }

  const legacyUsage = response?.response_metadata?.tokenUsage;

  if (legacyUsage) {
    return {
      inputTokens: legacyUsage.promptTokens ?? null,
      outputTokens: legacyUsage.completionTokens ?? null,
      totalTokens: legacyUsage.totalTokens ?? null
    };
  }

  return { inputTokens: null, outputTokens: null, totalTokens: null };
};

const estimateCostUsd = (modelName, inputTokens, outputTokens) => {
  const pricing = MODEL_PRICING[modelName];

  if (!pricing || inputTokens == null || outputTokens == null) {
    return null;
  }

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
};

// Wraps llm.invoke() so every LLM call in the agent graph emits a structured
// log line with latency, token usage, and an approximate USD cost — without
// every agent file needing to duplicate that bookkeeping.
export const invokeWithUsage = async (llm, input, context = {}) => {
  const startedAt = Date.now();

  const response = await llm.invoke(input);

  const durationMs = Date.now() - startedAt;
  const modelName = llm.model ?? llm.modelName ?? "unknown";
  const { inputTokens, outputTokens, totalTokens } = extractUsage(response);
  const estimatedCostUsd = estimateCostUsd(modelName, inputTokens, outputTokens);

  logger.info(
    {
      agent: context.agent,
      userId: context.userId,
      conversationId: context.conversationId,
      model: modelName,
      durationMs,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd
    },
    "LLM call completed"
  );

  return response;
};
