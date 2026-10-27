import { createHash } from "node:crypto";

import type { Chart, Song } from "../ir/types.js";
import { CONVERTER_VERSION } from "../version.js";

/** Hash of everything that decides a chart's output (spec section 7). */
export function chartSettingsHash(
  song: Song,
  chart: Chart,
  settings: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(
      [
        chart.sourceText,
        CONVERTER_VERSION,
        chart.keyCount,
        song.assets.audio,
        JSON.stringify(settings),
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 6);
}

/** Hash of everything that decides a whole .osz (spec section 7). */
export function settingsHashOf(
  input: { title: string; artist: string; chartTexts: readonly string[] },
  settings: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(
      [
        input.title,
        input.artist,
        CONVERTER_VERSION,
        input.chartTexts.join("\u0000"),
        JSON.stringify(settings),
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 6);
}

/** Hash of everything that decides a whole .osz (spec section 7). */
export function setSettingsHash(
  song: Song,
  settings: Record<string, unknown>,
): string {
  return settingsHashOf(
    {
      title: song.metadata.title,
      artist: song.metadata.artist,
      chartTexts: song.charts.map((chart) => chart.sourceText),
    },
    settings,
  );
}

/** Characters Windows rejects in file names, plus control characters. */
const ILLEGAL = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001f]', "g");

/** Builds an .osz file name: "Artist - Title [a1b2c3].osz" (spec section 7). */
export function fileNameFor(artist: string, title: string, setHash: string): string {
  const base = `${artist} - ${title}`
    .replace(ILLEGAL, "")
    .trim()
    // No dangling separator when artist or title is empty.
    .replace(/[\s-]+$/, "")
    .replace(/^[\s-]+/, "");
  return `${base.length > 0 ? base : "untitled"} [${setHash}].osz`;
}

/** Builds an .osz file name: "Artist - Title [a1b2c3].osz" (spec section 7). */
export function setFileName(song: Song, setHash: string): string {
  return fileNameFor(song.metadata.artist, song.metadata.title, setHash);
}
