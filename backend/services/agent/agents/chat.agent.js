import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getMemory } from "../utils/memory.js";
import { getModel } from "../utils/model.js";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { invokeWithUsage } from "../utils/logLLMUsage.js";

const formatSearchResults = (searchResults) => {
  const items = searchResults?.results;

  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }

  return items
    .map((item, i) => `${i + 1}. ${item.title}\n${item.content}\nSource: ${item.url}`)
    .join("\n\n");
};

export const chatAgent = async (state) => {
  await checkAgentLimit(state.userId, "chat");

  await deductCredits(
    state.userId,

    "chat"
  );

  const llm = getModel("chat");

  const history = await getMemory(state.conversationId);

  const searchContext = state.searchResults
    ? `
Web Search Results:

${formatSearchResults(state.searchResults)}

Answer the user using only the above search results.
`
    : "";

  const messages = [
    new SystemMessage(
      `
You are CortexAI, an intelligent AI assistant.

${searchContext}



If searchContext exists:

- Use search results to answer.
- Do not mention internal tools.

Rules:

- For simple questions, greetings, and short queries, respond naturally in plain text.
- For technical, educational, coding, or detailed topics, use clean Markdown.

Formatting:

- Use # for titles and ## for sections.
- Leave a blank line after headings.
- Use bullet points for lists.
- Use numbered lists for steps.
- Use fenced code blocks with language tags for code.
- Keep paragraphs short and readable.
- Never write headings and content on the same line.
- Never generate large walls of text.




`
    )
  ];

  history.forEach((msg) => {
    if (msg.role === "user") {
      messages.push(new HumanMessage(msg.content));
    }

    if (msg.role === "assistant") {
      messages.push(new AIMessage(msg.content));
    }
  });

  messages.push(new HumanMessage(state.prompt));

  const response = await invokeWithUsage(llm, messages, {
    agent: "chat",
    userId: state.userId,
    conversationId: state.conversationId
  });

  const images = state.searchResults?.images || [];

  return {
    ...state,

    response: response.content,
    images: images
  };
};
