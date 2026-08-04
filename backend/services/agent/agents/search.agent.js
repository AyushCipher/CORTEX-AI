import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { searchTool } from "../utils/tavily.js";
import { getModel } from "../utils/model.js";
import { invokeWithUsage } from "../utils/logLLMUsage.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const MAX_SEARCH_ATTEMPTS = 3;

const hasUsableResults = (results) =>
  Array.isArray(results?.results) && results.results.length > 0;

const reformulateQuery = async (originalPrompt, previousQuery, attempt, context) => {
  const llm = getModel("search");

  const result = await invokeWithUsage(
    llm,
    [
      new SystemMessage(
        "You rewrite web search queries that returned no useful results. " +
          "Return ONLY the rewritten query text, nothing else."
      ),
      new HumanMessage(
        `Original user request: ${originalPrompt}\n` +
          `Search query that returned nothing useful (attempt ${attempt}): ${previousQuery}\n` +
          "Rewrite the query so it is more likely to return relevant results " +
          "(broaden overly specific terms, try synonyms, or drop noise words)."
      )
    ],
    { agent: "search-reformulate", ...context }
  );

  return result.content.trim();
};

export const searchAgent = async (state) => {
  await checkAgentLimit(state.userId, "search");
  await deductCredits(state.userId, "search");

  let query = state.prompt;
  let results = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
    try {
      results = await searchTool.invoke({ query });

      if (hasUsableResults(results)) {
        return {
          ...state,
          searchResults: results
        };
      }

      console.log(
        `Search attempt ${attempt}/${MAX_SEARCH_ATTEMPTS} for "${query}" returned no usable results.`
      );

      if (attempt < MAX_SEARCH_ATTEMPTS) {
        query = await reformulateQuery(state.prompt, query, attempt, {
          userId: state.userId,
          conversationId: state.conversationId
        });
      }
    } catch (error) {
      lastError = error;
      console.error(
        `Search attempt ${attempt}/${MAX_SEARCH_ATTEMPTS} for "${query}" failed:`,
        error
      );
    }
  }

  if (lastError) {
    console.error(
      "All search attempts failed; falling back to empty results.",
      lastError
    );
  }

  return {
    ...state,
    searchResults: results ?? { results: [], images: [] }
  };
};
