import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";
dotenv.config();
import { ChatOpenRouter } from "@langchain/openrouter";

const openRouter = new ChatOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY || "dummy-openrouter-key",
  model: "deepseek/deepseek-chat",
  temperature: 0,
  maxTokens: 2500
  // other params...
});

export const gemini = new ChatGoogleGenerativeAI({
  model: "gemini-3.5-flash",
  apiKey: process.env.GOOGLE_API_KEY || "dummy-google-key"
});

const groq = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY || "dummy-groq-key",
  model: "openai/gpt-oss-120b",
  temperature: 0,
  maxTokens: 4000,  
  maxRetries: 2
  // other params...
});

export const getModel = (agent) => {
  switch (agent) {
    case "coding":
      return openRouter;

    case "image":
      return groq;

    case "search":
      return groq;

    case "chat":
      return groq;

    case "vision":
      return gemini;
      
    default:
      return groq;
  }
};
