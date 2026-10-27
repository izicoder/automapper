import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

/** Kept inside OUTPUT/ so it disappears together with the converted files. */
export const ARCHIVE_STATE_FILE = ".archive-state.json";

export interface ArchiveStamp {
  size: number;
  mtimeMs: number;
  /** Fingerprint of the conversion settings; changed settings reprocess. */
  settings: string;
}

export type ArchiveState = Record<string, ArchiveStamp>;

export function archiveStamp(path: string): { size: number; mtimeMs: number } {
  const stat = statSync(path);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

/** Short hash of the settings plus the converter version (spec section 7). */
export function settingsFingerprint(
  settings: Record<string, unknown>,
  converterVersion: string,
): string {
  return createHash("sha256")
    .update(`${JSON.stringify(settings)}\u0000${converterVersion}`)
    .digest("hex")
    .slice(0, 12);
}

export function isArchiveProcessed(
  state: ArchiveState,
  path: string,
  stamp: ArchiveStamp,
): boolean {
  const recorded = state[path];
  return (
    recorded !== undefined &&
    recorded.size === stamp.size &&
    recorded.mtimeMs === stamp.mtimeMs &&
    recorded.settings === stamp.settings
  );
}

export function readArchiveState(path: string): ArchiveState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ArchiveState;
  } catch {
    return {};
  }
}

export function writeArchiveState(path: string, state: ArchiveState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

export interface ExtractResult {
  /** Entries that pointed outside the target folder and were not written. */
  skipped: string[];
}

/**
 * Unpacks a .zip into `targetDir`. Entries that try to escape the folder
 * (`..`, drive letters, NTFS streams) are skipped, never written.
 */
export function extractZip(archivePath: string, targetDir: string): ExtractResult {
  const files = unzipSync(readFileSync(archivePath));
  const skipped: string[] = [];

  for (const [rawName, data] of Object.entries(files)) {
    const name = rawName.replace(/\\/g, "/");
    if (name.endsWith("/")) continue;

    const parts = name.split("/").filter((part) => part.length > 0 && part !== ".");
    if (parts.length === 0 || parts.some((part) => part === ".." || part.includes(":"))) {
      skipped.push(rawName);
      continue;
    }

    const target = join(targetDir, ...parts);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }

  return { skipped };
}
