// Serve mediapipe's WebAssembly runtime from our own site so it always matches
// the installed @mediapipe/tasks-vision version (no CDN to keep in sync).
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(webRoot, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = join(webRoot, "public", "mediapipe-wasm");

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
}
