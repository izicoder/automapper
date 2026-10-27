import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/**
 * Scratch folder for tests, under the temporary directory the environment
 * approves for external access. Callers remove it themselves.
 */
export function tempDir(prefix = "automapper-"): string {
  const base = join(
    process.env["TEMP"] ?? "C:/Users/obolo/AppData/Local/Temp",
    "opencode",
  );
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}
