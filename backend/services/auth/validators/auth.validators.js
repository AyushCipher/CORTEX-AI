import { z } from "zod";

export const loginSchema = z.object({
  token: z.string().min(1, "token is required")
});

export const updatePlanSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  plan: z.string().min(1, "plan is required"),
  credits: z.coerce.number().int().nonnegative()
});

export const deductCreditsSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  agent: z.enum(["chat", "search", "coding", "pdf", "ppt", "image"])
});
