import fs from "fs/promises";

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getModel } from "../utils/model.js";

import { checkAgentLimit } from "../config/agentRateLimit.js";

import { deductCredits } from "../utils/deductCredits.js";

import { invokeWithUsage } from "../utils/logLLMUsage.js";

export const visionAgent = async (state) => {
  try {
    await checkAgentLimit(state.userId, "image");

    await deductCredits(state.userId, "image");

    const llm = getModel("vision");

    const imageBuffer = await fs.readFile(state.file.path);

    const base64Image = imageBuffer.toString("base64");

    const messages = [
      new SystemMessage(`

You are CortexAI Vision Agent.

Rules:

- Analyze only the uploaded image.
- Answer the user's question accurately.
- If text exists in the image, extract it.
- If charts or tables exist, explain them.
- If something is unclear, say so.
- Use Markdown when helpful.
- Do not hallucinate.

`),

      new HumanMessage({
        content: [
          {
            type: "text",

            text: state.prompt || "Describe this image."
          },

          {
            type: "image_url",

            image_url: {
              url: `data:${state.file.mimetype};base64,${base64Image}`
            }
          }
        ]
      })
    ];

    const response = await invokeWithUsage(llm, messages, {
      agent: "vision",
      userId: state.userId,
      conversationId: state.conversationId
    });

    return {
      ...state,

      response: response.content
    };
  } finally {
    if (state.file) {
      try {
        await fs.unlink(state.file.path);
      } catch (err) {
        console.error(`Failed to delete temp image file ${state.file.path}:`, err);
      }
    }
  }
};
