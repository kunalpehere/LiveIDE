import { z } from "zod";

export const playgroundIdSchema = z.string().trim().min(1).max(128);

export const createPlaygroundSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  description: z.string().trim().max(500).optional(),
  template: z.enum(["REACT", "NEXTJS", "EXPRESS", "VUE", "HONO", "ANGULAR"]),
});

export const editPlaygroundSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  description: z.string().trim().max(500),
});

const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;

export function parseTemplateData<T>(data: T): T {
  let serialized: string;

  try {
    serialized = JSON.stringify(data);
  } catch {
    throw new Error("Playground content must be valid JSON");
  }

  if (!serialized || serialized.length > MAX_TEMPLATE_BYTES) {
    throw new Error("Playground content exceeds the 2 MB save limit");
  }

  return data;
}
