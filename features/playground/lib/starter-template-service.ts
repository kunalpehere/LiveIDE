import "server-only";

import path from "node:path";

import { scanTemplateDirectory, type TemplateFolder } from "../libs/path-to-json";
import { templatePaths, type TemplateKey } from "@/lib/template";

const templateCache = new Map<TemplateKey, Promise<Readonly<TemplateFolder>>>();

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value as Readonly<T>;
}

export function getStarterTemplate(template: TemplateKey): Promise<Readonly<TemplateFolder>> {
  const cached = templateCache.get(template);
  if (cached) return cached;

  const directory = path.join(process.cwd(), "starter-templates", templatePaths[template]);
  const pending = scanTemplateDirectory(directory)
    .then(deepFreeze)
    .catch(error => {
      templateCache.delete(template);
      throw error;
    });

  templateCache.set(template, pending);
  return pending;
}

export function clearStarterTemplateCache() {
  templateCache.clear();
}
