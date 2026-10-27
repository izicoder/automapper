import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { unzipSync } from "fflate";

import { loadStepManiaFiles, type SongFile } from "../parsers/stepmania.js";
import type { Chart } from "../ir/types.js";

/** One chart of an archive song, without its notes (spec 7: list only). */
export interface ArchiveChart {
  name: string;
  stepType: string;
  keyCount: number;
  notes: number;
  /** Part of the content hash, kept so the expected .osz name is exact. */
  sourceText: string;
}

export interface ArchiveSong {
  /**
   * What to select inside the archive with forward slashes: the song folder
   * ("Pack/Song"), or the chart file for a song at the archive root.
   */
  inner: string;
  pack?: string;
  label: string;
  title?: string;
  artist?: string;
  audio?: string;
  charts: ArchiveChart[];
  error?: string;
  warnings: string[];
}

export interface ArchiveContents {
  songs: ArchiveSong[];
  /** Entries that cannot become a song (deep nesting, no chart). */
  ignored: string[];
  /** Set when the zip itself cannot be read. */
  error?: string;
}

interface Cached extends ArchiveContents {
  size: number;
  mtimeMs: number;
}

const CACHE_LIMIT = 64;
const cache = new Map<string, Cached>();

/**
 * Reads the songs of a .zip without unpacking it: only the chart entries are
 * inflated, audio is left alone. Results are cached per archive stamp, so a
 * rescan does not read the same gigabyte again (spec 7).
 */
export function peekArchive(
  path: string,
  options: { assumeKeys?: number } = {},
): ArchiveContents {
  let stamp: { size: number; mtimeMs: number };
  try {
    const stat = statSync(path);
    stamp = { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    return { songs: [], ignored: [], error: (error as Error).message };
  }

  const cached = cache.get(path);
  if (cached !== undefined && cached.size === stamp.size && cached.mtimeMs === stamp.mtimeMs) {
    return cached;
  }

  const contents = readArchive(path, options.assumeKeys);
  cache.delete(path);
  cache.set(path, { ...contents, ...stamp });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
  return contents;
}

/** Drops everything the cache holds; used when a scan is forced. */
export function clearArchiveCache(): void {
  cache.clear();
}

function readArchive(path: string, assumeKeys: number | undefined): ArchiveContents {
  const names: string[] = [];
  let charts: Record<string, Uint8Array>;

  try {
    charts = unzipSync(readFileSync(path), {
      filter: (file) => {
        names.push(file.name);
        return isChart(file.name);
      },
    });
  } catch (error) {
    return { songs: [], ignored: [], error: `cannot read archive: ${(error as Error).message}` };
  }

  const entries = names
    .map((name) => name.replace(/\\/g, "/"))
    .filter((name) => !name.endsWith("/"));

  const songs: ArchiveSong[] = [];
  const ignored: string[] = [];

  for (const group of groupChartEntries(Object.keys(charts).map((name) => name.replace(/\\/g, "/")))) {
    // A chart at the archive root is a one-file song, so it shares the root
    // with its audio, exactly like a loose chart in INPUT/.
    const sources =
      group.chartEntry === undefined
        ? entriesUnder(entries, group.prefix)
        : entries.filter((entry) => !entry.includes("/"));
    const files: SongFile[] = sources.map((entry) => ({
      name: basename(entry),
      ...(charts[entry] === undefined ? {} : { bytes: charts[entry] }),
    }));

    const outcome = loadStepManiaFiles(group.prefix === "" ? group.label : group.prefix, files, {
      ...(assumeKeys === undefined ? {} : { assumeKeys }),
      ...(group.chartEntry === undefined ? {} : { chartFile: basename(group.chartEntry) }),
    });

    if (outcome.song === null) {
      songs.push({
        inner: group.chartEntry ?? group.prefix,
        label: group.label,
        charts: [],
        warnings: outcome.warnings,
        error: outcome.reason ?? "cannot be converted",
      });
      continue;
    }

    songs.push({
      inner: group.chartEntry ?? group.prefix,
      ...(group.pack === undefined ? {} : { pack: group.pack }),
      label: group.label,
      title: outcome.song.metadata.title,
      artist: outcome.song.metadata.artist,
      audio: outcome.song.assets.audio,
      charts: outcome.song.charts.map(toArchiveChart),
      warnings: outcome.warnings,
    });
  }

  // Anything deeper than two folders is invisible to the folder scanner too.
  for (const entry of entries) {
    if (!isChart(entry)) continue;
    const depth = entry.split("/").length;
    if (depth > 3) ignored.push(entry);
  }

  return { songs, ignored };
}

interface ChartGroup {
  /** Folder holding the song inside the archive ("", "Song", "Pack/Song"). */
  prefix: string;
  pack?: string;
  label: string;
  /** Only set for a chart file at the archive root. */
  chartEntry?: string;
}

/**
 * Mirrors the folder rules of `discover()` (spec section 5): a chart one level
 * deep is a song, two levels is a song in a pack, a chart at the root is a
 * one-file song. Deeper nesting is ignored, exactly like on disk.
 */
function groupChartEntries(chartEntries: readonly string[]): ChartGroup[] {
  const groups = new Map<string, ChartGroup>();

  for (const entry of chartEntries) {
    const parts = entry.split("/").filter((part) => part.length > 0);

    if (parts.length === 1) {
      const file = parts[0]!;
      groups.set(`\u0000${file}`, {
        prefix: "",
        label: file,
        chartEntry: entry,
      });
      continue;
    }
    if (parts.length === 2) {
      const folder = parts[0]!;
      if (!groups.has(folder)) groups.set(folder, { prefix: folder, label: folder });
      continue;
    }
    if (parts.length === 3) {
      const pack = parts[0]!;
      const folder = parts[1]!;
      const key = `${pack}/${folder}`;
      if (!groups.has(key)) {
        groups.set(key, { prefix: key, pack, label: folder });
      }
    }
  }

  return [...groups.values()];
}

function entriesUnder(entries: readonly string[], prefix: string): string[] {
  const start = `${prefix}/`;
  return entries.filter((entry) => entry.startsWith(start));
}

function isChart(name: string): boolean {
  const extension = extname(name).toLowerCase();
  return extension === ".sm" || extension === ".ssc";
}

function toArchiveChart(chart: Chart): ArchiveChart {
  return {
    name: chart.meta.name,
    stepType: chart.meta.stepType,
    keyCount: chart.keyCount,
    notes: chart.notes.length,
    sourceText: chart.sourceText,
  };
}
