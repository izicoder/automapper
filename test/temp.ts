import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Scratch folder for tests, under the system temporary directory.
 * Callers remove it themselves.
 */
export function tempDir(prefix = "automapper-"): string {
  const base = join(tmpdir(), "automapper-tests");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}
