import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { strToU8, zipSync } from "fflate";

import type { Song } from "../ir/types.js";
import { writeBeatmap, type WriteOptions } from "../osu/writer.js";

export interface PackageOptions extends WriteOptions {
  /** Where the .osz is written. */
  outputPath: string;
}

export interface PackageResult {
  outputPath: string;
  versions: string[];
}

/**
 * Builds one .osz: all difficulties of the song plus its assets (spec
 * section 5). Audio and images are copied untouched, never re-encoded
 * (spec section 6).
 */
export function packageSong(song: Song, options: PackageOptions): PackageResult {
  const files: Record<string, Uint8Array> = {};
  const versions: string[] = [];

  files[options.audioFileName] = readFileSync(join(song.directory, song.assets.audio));

  for (const asset of [song.assets.background, song.assets.banner, song.assets.cdTitle]) {
    if (asset !== undefined) files[asset] = readFileSync(join(song.directory, asset));
  }

  for (const chart of song.charts) {
    const written = writeBeatmap(song, chart, options);
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