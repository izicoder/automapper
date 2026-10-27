import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isSea, getAsset, getAssetKeys } from "node:sea";

/**
 * True when the program runs as the packaged single executable (Node's
 * single executable application, SEA). The release zip ships that .exe and
 * nothing else, so assets are read from inside it instead of from disk.
 */
export const IN_SEA = isSea();

/** Files bundled into the executable by `scripts/build-sea.mjs`. */
const ASSETS = new Set([
  "page/index.html",
  "page/app.js",
  "page/style.css",
  "worker.cjs",
]);

/** One file that ships inside the executable, or undefined outside a build. */
export function readBundled(name: string): Buffer | undefined {
  if (!IN_SEA || !ASSETS.has(name)) return undefined;
  try {
    return Buffer.from(getAsset(name));
  } catch {
    return undefined;
  }
}

/** Same as `readBundled`, for text assets such as the worker script. */
export function readBundledText(name: string): string | undefined {
  return readBundled(name)?.toString("utf8");
}

/** Names of the bundled files; used by the build smoke test. */
export function bundledNames(): string[] {
  return IN_SEA ? getAssetKeys() : [];
}

/**
 * True when the current module is the one the process was started with.
 * In the packaged executable the entry module is inside the binary, so this
 * is always false: `src/sea-main.ts` decides what to run instead.
 */
export function isMainModule(moduleUrl: string | undefined): boolean {
  if (IN_SEA) return false;
  const script = process.argv[1];
  if (script === undefined || moduleUrl === undefined) return false;
  return moduleUrl.endsWith(script.replace(/\\/g, "/"));
}

/** Reads a file from `dir`, mainly so tests can reuse the page lookup. */
export function readFrom(dir: string, name: string): Buffer | undefined {
  try {
    return readFileSync(join(dir, name));
  } catch {
    return undefined;
  }
}
