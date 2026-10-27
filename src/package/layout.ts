import { readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export interface SongEntry {
  directory: string;
  label: string;
}

export interface PackEntry {
  directory: string;
  label: string;
  songs: SongEntry[];
}

export interface Discovery {
  songs: SongEntry[];
  packs: PackEntry[];
  /** Loose chart files dropped straight into INPUT/ (spec section 5). */
  loose: string[];
  /** Zip archives waiting to be unpacked. */
  archives: string[];
  /** Archives this build cannot open (.7z, .rar, ...). */
  unsupportedArchives: string[];
  /** Anything that could not be recognised, for a log line. */
  skipped: string[];
}

const CHART = new Set([".sm", ".ssc"]);
const ARCHIVE = new Set([".zip"]);
const UNSUPPORTED_ARCHIVE = new Set([".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"]);

/**
 * Walks INPUT/ (spec section 5): a folder with a chart file is a song, a
 * folder with song folders is a pack, depth is two layers, loose chart files
 * become one-file songs, zip archives are unpacked later. INPUT/ is only ever
 * read.
 */
export function discover(inputDir: string): Discovery {
  const discovery: Discovery = {
    songs: [],
    packs: [],
    loose: [],
    archives: [],
    unsupportedArchives: [],
    skipped: [],
  };

  let entries;
  try {
    entries = readdirSync(inputDir, { withFileTypes: true });
  } catch {
    return discovery;
  }

  for (const entry of entries) {
    const path = join(inputDir, entry.name);

    if (!entry.isDirectory()) {
      const extension = extname(entry.name).toLowerCase();
      if (CHART.has(extension)) {
        discovery.loose.push(path);
      } else if (ARCHIVE.has(extension)) {
        discovery.archives.push(path);
      } else if (UNSUPPORTED_ARCHIVE.has(extension)) {
        discovery.unsupportedArchives.push(path);
      } else {
        discovery.skipped.push(path);
      }
      continue;
    }

    const children = readdirSync(path, { withFileTypes: true });
    const hasChart = children.some(
      (child) => child.isFile() && CHART.has(extname(child.name).toLowerCase()),
    );

    if (hasChart) {
      discovery.songs.push({ directory: path, label: entry.name });
      continue;
    }

    const songFolders = children.filter((child) => child.isDirectory());
    if (songFolders.length > 0) {
      discovery.packs.push({
        directory: path,
        label: entry.name,
        songs: songFolders.map((folder) => ({
          directory: join(path, folder.name),
          label: folder.name,
        })),
      });
      continue;
    }

    discovery.skipped.push(path);
  }

  return discovery;
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function labelOf(path: string): string {
  return basename(path);
}