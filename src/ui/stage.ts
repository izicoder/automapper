import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

/** Windows device names that cannot be used as a file or folder name. */
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

const ILLEGAL = new RegExp('[<>:"|?*\\u0000-\\u001f]', "g");

/**
 * Turns a path relative to the drop into safe path segments. Dropped files
 * keep their folder structure, but nothing may escape the staging folder:
 * `..`, drive letters and NTFS stream names are rejected outright.
 */
export function sanitizeDropPath(relative: string): string[] {
  const normalised = relative.replace(/\\/g, "/");

  if (normalised.startsWith("/") || /^[a-zA-Z]:/.test(normalised)) {
    throw new Error(`refusing absolute path "${relative}"`);
  }

  const segments = normalised
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .map((part) => {
      if (part === "..") throw new Error(`refusing path with "..": "${relative}"`);

      const cleaned = part.replace(ILLEGAL, "").replace(/[. ]+$/, "").trim();
      if (cleaned.length === 0) throw new Error(`unusable path segment in "${relative}"`);

      return RESERVED.has(cleaned.toLowerCase()) ? `_${cleaned}` : cleaned.slice(0, 120);
    });

  if (segments.length === 0) throw new Error(`empty path "${relative}"`);
  if (segments.join("/").length > 200) throw new Error(`path too long: "${relative}"`);

  return segments;
}

/**
 * Temporary home for dropped files. Dropped items are converted from here
 * exactly like INPUT/ entries and are never copied into INPUT/ (spec 7).
 * The folder lives in the OS temp directory and is removed on shutdown.
 */
export class DropStage {
  private constructor(readonly dir: string) {}

  static create(): DropStage {
    return new DropStage(mkdtempSync(join(tmpdir(), "automapper-drop-")));
  }

  /** Wraps an existing folder, used when the server is told where to stage. */
  static at(dir: string): DropStage {
    mkdirSync(dir, { recursive: true });
    return new DropStage(dir);
  }

  /** Absolute target for a dropped path, with a ` (2)` suffix if it exists. */
  target(relative: string): string {
    const segments = sanitizeDropPath(relative);
    const base = join(this.dir, ...segments);
    if (!isInside(base, this.dir)) throw new Error(`refusing path outside the drop: "${relative}"`);

    if (!existsSync(base)) {
      mkdirSync(dirname(base), { recursive: true });
      return base;
    }

    // Two files with the same name in one drop must both survive.
    const extension = /\.[^.]+$/.exec(base)?.[0] ?? "";
    const stem = extension.length > 0 ? base.slice(0, -extension.length) : base;
    for (let index = 2; ; index += 1) {
      const candidate = `${stem} (${index})${extension}`;
      if (!existsSync(candidate)) {
        mkdirSync(dirname(candidate), { recursive: true });
        return candidate;
      }
    }
  }

  /** Writes one dropped file and returns where it landed. */
  async save(relative: string, body: Readable): Promise<string> {
    const target = this.target(relative);
    await pipeline(body, createWriteStream(target));
    return target;
  }

  /** Drops everything staged so far; the folder is reused. */
  clear(): void {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

function isInside(path: string, root: string): boolean {
  const withSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(withSep);
}
