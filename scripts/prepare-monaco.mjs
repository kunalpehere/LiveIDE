import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = path.join(path.dirname(require.resolve("monaco-editor/package.json")), "min", "vs");
const destination = path.resolve("public", "monaco", "vs");
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
console.log("Prepared local Monaco scripts and workers");
