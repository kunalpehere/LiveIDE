import { z } from "zod";
import { validateProjectResources } from "@/lib/resource-limits";
import { templateFolderSchema } from "../libs/path-to-json";

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

export function parseTemplateData<T>(data: T): T {
  const { root } = validateProjectResources(data);
  templateFolderSchema.parse(root);
  return data;
}
