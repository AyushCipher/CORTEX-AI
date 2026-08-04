import { z } from "zod";

export const updateConversationSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  title: z.string().min(1, "title is required")
});

export const saveMessageSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "content is required"),
  images: z.array(z.string()).optional(),
  artifacts: z.array(z.any()).optional()
});

export const getMessagesParamsSchema = z.object({
  id: z.string().min(1, "conversation id is required")
});
