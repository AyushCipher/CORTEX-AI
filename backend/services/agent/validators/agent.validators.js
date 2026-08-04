import { z } from "zod";

export const chatSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  conversationId: z.string().min(1, "conversationId is required"),
  agent: z
    .enum([
      "auto",
      "chat",
      "search",
      "coding",
      "pdf",
      "ppt",
      "image",
      "vision",
      "pdf_rag"
    ])
    .optional()
});
