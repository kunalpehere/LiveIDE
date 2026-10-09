import { z } from "zod";

const historyMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000, "Chat context message exceeds 4,000 characters. Send a shorter excerpt."),
});

export const chatRequestSchema = z.union([
  z.object({
    action: z.literal("enhance"),
    prompt: z.string().trim().min(1).max(2_000),
    context: z.object({
      fileName: z.string().max(255).optional(),
      language: z.string().max(64).optional(),
      codeContent: z.string().max(8_000).optional(),
    }).optional(),
  }),
  z.object({
    action: z.literal("chat").default("chat"),
    playgroundId: z.string().min(1).max(128).optional(),
    message: z.string().trim().min(1).max(12_000, "Chat question exceeds 12,000 characters. Shorten it or ask in smaller sections."),
    history: z.array(historyMessage).max(10, "Chat context exceeds 10 messages. Send fewer recent messages.").default([]),
    stream: z.boolean().default(false),
    mode: z.enum(["chat", "review", "fix", "optimize", "optimization"]).optional(),
  }),
]);

export const suggestionRequestSchema = z.object({
  fileContent: z.string().max(20_000),
  cursorLine: z.number().int().min(0),
  cursorColumn: z.number().int().min(0),
  suggestionType: z.string().trim().min(1).max(64),
  fileName: z.string().max(255).optional(),
});

export const historyQuerySchema = z.object({
  playgroundId: z.string().min(1).max(128),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
