import { TavilySearch } from "@langchain/tavily";

export const searchTool = new TavilySearch({
  apiKey: process.env.TAVILY_API_KEY || "dummy-tavily-key",
  maxResults: 5,
  topic: "general",
  includeImages: true
});
