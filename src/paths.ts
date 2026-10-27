import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates the application directory: the folder holding package.json (dev) or
 * the executable (packaged). Never process.cwd(), per spec section 4.
 */
function findAppRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(process.execPath);
}

export const APP_ROOT = findAppRoot(dirname(fileURLToPath(import.meta.url)));

/** INPUT/ sits next to the program (spec section 2.4). */
export const INPUT_DIR = join(APP_ROOT, "INPUT");

/** OUTPUT/ sits next to the program (spec section 2.5). */
export const OUTPUT_DIR = join(APP_ROOT, "OUTPUT");

export function ensureInputDir(): string {
  mkdirSync(INPUT_DIR, { recursive: true });
  return INPUT_DIR;
}

export function ensureOutputDir(): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  return OUTPUT_DIR;
}
