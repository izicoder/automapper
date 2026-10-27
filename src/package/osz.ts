import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";

import type { Chart, Song } from "../ir/types.js";
import { writeBeatmap, type WriteOptions } from "../osu/writer.js";

export interface PackageOptions extends Omit<WriteOptions, "versionHash"> {
  /** Where the .osz is written. */
  outputPath: string;
  /** Content hash of one difficulty (spec section 7). */
  hashForChart: (chart: Chart) => string;
}

export interface PackageResult {
  outputPath: string;
  versions: string[];
}

/**
 * Builds one .osz: every difficulty of the song plus its assets (spec
 * section 5). Audio and images are copied untouched, never re-encoded
 * (spec section 6).
 */
export function packageSong(
  song: Song,
  charts: readonly Chart[],
  options: PackageOptions,
): PackageResult {
  const files: Record<string, Uint8Array> = {};
  const versions: string[] = [];

  files[options.audioFileName] = readFileSync(join(song.directory, song.assets.audio));

  for (const asset of [song.assets.background, song.assets.banner, song.assets.cdTitle]) {
    if (asset !== undefined) files[asset] = readFileSync(join(song.directory, asset));
  }

  for (const chart of charts) {
    const written = writeBeatmap(song, chart, {
      versionHash: options.hashForChart(chart),
      creator: options.creator,
      audioFileName: options.audioFileName,
      minHoldBeats: options.minHoldBeats,
      rollAsTaps: options.rollAsTaps,
      rollTapBeats: options.rollTapBeats,
      stopEmulation: options.stopEmulation,
    });
    versions.push(written.version);
    files[`${written.version}.osu`] = strToU8(written.content);
  }

  mkdirSync(dirname(options.outputPath), { recursive: true });
  // Fixed mtime keeps re-runs byte identical (spec section 7, idempotence).
  // ZIP cannot store dates before 1980, so that is the earliest fixed stamp.
  const stamp = new Date(Date.UTC(1980, 0, 1));
  writeFileSync(options.outputPath, zipSync(files, { level: 6, mtime: stamp }));

  return { outputPath: options.outputPath, versions };
}
