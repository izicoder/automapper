import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * tsc emits JavaScript only, so the UI page is copied into dist/ after the
 * build. Without this, `node dist/src/ui/server.js` has no page to serve.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "src", "ui", "page");
const to = join(root, "dist", "src", "ui", "page");

mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
