import { readdirSync } from "node:fs";
import { extname, join } from "node:path";

import { addBeats, parseBeat, ZERO_BEAT, type Beat } from "../ir/beat.js";
import type { Chart, Note, Song, SongAssets, SongMetadata, TempoMap } from "../ir/types.js";
import { TimingMap } from "../ir/timing.js";
import { DIFFICULTY_LABELS, keyCountForStepType } from "./chart-types.js";
import { decodeChartFile } from "./encoding.js";
import { parseMsd, tagValue, type MsdTag } from "./msd.js";
import { parseNoteData } from "./steps.js";

export const CHART_EXTENSIONS = new Set([".sm", ".ssc"]);
export const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".wav", ".flac", ".m4a", ".aac"]);
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]);

/** Orders chart files so .ssc is read before .sm. */
function extensionRank(file: string): number {
  return extname(file).toLowerCase() === ".ssc" ? 0 : 1;
}

export interface LoadOutcome {
  /** Null when the folder cannot become a song at all (no chart, no audio). */
  song: Song | null;
  warnings: string[];
  /** Set when `song` is null: the reason the song was skipped. */
  reason?: string;
}

/** One `#NOTES` block (.ssc: one chart section) before it becomes IR. */
interface RawChart {
  stepType: string;
  difficulty: string;
  meter: number;
  credit: string;
  radar: Record<string, number>;
  noteData: string;
  /** Tags that decide this chart's timing (.ssc carries them per chart). */
  tags: MsdTag[];
}

export interface ParsedFile {
  /** Song-level tags: everything that is not chart data. */
  tags: MsdTag[];
  charts: RawChart[];
}

const RADAR_KEYS = ["notes", "holds", "mines", "rolls", "holds_second", "notes_second"] as const;

export interface LoadOptions {
  /** Read only this chart file, for a loose file dropped into INPUT/ (spec 5). */
  chartFile?: string;
  /** Key count for charts whose step type is unknown (spec section 5 override). */
  assumeKeys?: number;
}

/**
 * Reads every .sm/.ssc file in a song folder and builds the IR song.
 *
 * Guesses (encoding, audio fallback, skipped chart) are returned as warnings
 * so the caller can log them (spec section 5).
 */
export function loadStepManiaSong(songDir: string, options: LoadOptions = {}): LoadOutcome {
  const warnings: string[] = [];

  const entries = readdirSync(songDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const chartFiles = (options.chartFile === undefined ? files : [options.chartFile])
    .filter((file) => CHART_EXTENSIONS.has(extname(file).toLowerCase()))
    // .ssc before .sm: when a folder holds both copies of the same song, the
    // newer format wins and the .sm copy is the one dropped as a duplicate.
    .sort((a, b) => extensionRank(a) - extensionRank(b) || a.localeCompare(b));

  if (chartFiles.length === 0) {
    return { song: null, warnings, reason: "no .sm or .ssc chart file" };
  }

  const folderName = songDir.split(/[\\/]/).filter(Boolean).pop() ?? songDir;
  let songTags: MsdTag[] | undefined;
  const charts: Chart[] = [];
  /** One chart per key count and name -> the file it came from. */
  const seen = new Map<string, string>();

  for (const file of chartFiles) {
    const decoded = decodeChartFile(join(songDir, file));
    if (decoded.warning) warnings.push(decoded.warning);

    const parsed = parseStepManiaText(decoded.text);
    songTags ??= parsed.tags;

    for (const raw of parsed.charts) {
      const chart = buildChart(raw, file, warnings, options.assumeKeys);
      if (chart === null) continue;

      const identity = chartIdentity(chart);
      const firstFile = seen.get(identity);
      if (firstFile !== undefined) {
        warnings.push(
          `${file}: duplicate of chart "${chart.meta.name}" in ${firstFile}, skipped`,
        );
        continue;
      }
      seen.set(identity, file);
      charts.push(chart);
    }
  }

  if (charts.length === 0) {
    return { song: null, warnings, reason: "no usable chart" };
  }

  const metadata = metadataFromTags(songTags ?? []);
  const assets = resolveAssets(songTags ?? [], files, warnings);
  if (assets === null) {
    return { song: null, warnings, reason: "no usable audio file" };
  }

  return {
    song: { folderName, directory: songDir, metadata, assets, charts, warnings },
    warnings,
  };
}

/**
 * Parses .sm and .ssc text. The two formats differ in how chart tags are
 * scoped: .sm keeps one song-level tag set, .ssc scopes tags per chart
 * section (spec section 6). Both end up as chart tags here.
 */
export function parseStepManiaText(text: string): ParsedFile {
  const tags = parseMsd(text);

  // #NOTEDATA (or #STEPSTYPE) only exists in .ssc; .sm only has #NOTES.
  if (tags.some((tag) => tag.key === "NOTEDATA" || tag.key === "STEPSTYPE")) {
    return parseSscFile(tags);
  }
  return parseSmFile(tags);
}

function parseSmFile(tags: MsdTag[]): ParsedFile {
  const songTags: MsdTag[] = [];
  const charts: RawChart[] = [];

  for (const tag of tags) {
    if (tag.key !== "NOTES") {
      songTags.push(tag);
      continue;
    }
    const raw = parseSmNoteFields(tag.value);
    if (raw === null) continue;
    charts.push({ ...raw, tags: songTags });
  }

  return { tags: songTags, charts };
}

/**
 * .ssc groups tags into sections: general data first, then one section per
 * chart. A chart inherits the general tags, then its section tags, then its
 * own tags.
 */
function parseSscFile(tags: MsdTag[]): ParsedFile {
  const general: MsdTag[] = [];
  let section: MsdTag[] | null = null;
  let chart: MsdTag[] | null = null;
  const chartScopes: MsdTag[][] = [];

  for (const tag of tags) {
    if (tag.key === "SECTION") {
      if (chart !== null) {
        chartScopes.push(chart);
        chart = null;
      }
      section = [];
      continue;
    }
    if (tag.key === "NOTEDATA") {
      if (chart !== null) chartScopes.push(chart);
      chart = [];
      continue;
    }
    if (chart !== null) chart.push(tag);
    else if (section !== null) section.push(tag);
    else general.push(tag);
  }
  if (chart !== null) chartScopes.push(chart);

  const charts: RawChart[] = [];
  for (const scope of chartScopes) {
    const merged = mergeTags(general, section ?? [], scope);
    const noteData = tagValue(merged, "NOTES");
    if (noteData === undefined || noteData.trim().length === 0) continue;
    charts.push({
      stepType: tagValue(merged, "STEPSTYPE") ?? "",
      difficulty: tagValue(merged, "DIFFICULTY") ?? "Edit",
      meter: Number(tagValue(merged, "METER") ?? "0") || 0,
      credit: tagValue(merged, "CREDIT") ?? "",
      radar: parseRadar(tagValue(merged, "RADARVALUES")),
      noteData,
      tags: merged,
    });
  }

  return { tags: general, charts };
}

/** Later scopes win; inside one scope the first occurrence wins. */
function mergeTags(...scopes: MsdTag[][]): MsdTag[] {
  const out: MsdTag[] = [];
  const seen = new Set<string>();
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    for (const tag of scopes[index]!) {
      if (seen.has(tag.key)) continue;
      seen.add(tag.key);
      out.unshift(tag);
    }
  }
  return out;
}

/**
 * Splits an .sm `#NOTES` value. Two layouts are in the wild:
 *
 *   stepType: description: difficulty: meter: credit: radar: noteData  (7)
 *   stepType: description: difficulty: meter: radar: noteData          (6)
 *   stepType: difficulty: meter: credit: radar: noteData              (6, legacy)
 */
function parseSmNoteFields(value: string): Omit<RawChart, "tags"> | null {
  const fields = value.split(":");
  if (fields.length < 6 || fields.length > 7) return null;

  const legacy = fields.length === 6 && isDifficultyLabel(fields[1] ?? "");
  const offset = legacy || fields.length === 7 ? 5 : 4;
  const difficultyIndex = fields.length - offset;

  const difficulty = (fields[difficultyIndex] ?? "").trim();
  const meter = Number((fields[difficultyIndex + 1] ?? "").trim()) || 0;
  const credit = offset === 5 ? (fields[difficultyIndex + 2] ?? "").trim() : "";

  return {
    stepType: (fields[0] ?? "").trim(),
    difficulty,
    meter,
    credit,
    radar: parseRadar(fields[fields.length - 2]),
    noteData: fields[fields.length - 1]!,
  };
}

function isDifficultyLabel(value: string): boolean {
  return Object.hasOwn(DIFFICULTY_LABELS, value.trim().toLowerCase());
}

function parseRadar(value: string | undefined): Record<string, number> {
  const radar: Record<string, number> = {};
  if (value === undefined) return radar;
  const parts = value.split(",");
  for (let index = 0; index < Math.min(parts.length, RADAR_KEYS.length); index += 1) {
    const parsed = Number(parts[index]);
    if (Number.isFinite(parsed)) radar[RADAR_KEYS[index]!] = parsed;
  }
  return radar;
}

function metadataFromTags(tags: MsdTag[]): SongMetadata {
  const title = tagValue(tags, "TITLE") ?? "";
  const artist = tagValue(tags, "ARTIST") ?? "";
  const sampleStart = Number(tagValue(tags, "SAMPLESTART") ?? "NaN");

  return {
    title: title.length > 0 ? title : "Unknown title",
    titleUnicode: tagValue(tags, "TITLETRANSLIT"),
    artist: artist.length > 0 ? artist : "Unknown artist",
    artistUnicode: tagValue(tags, "ARTISTTRANSLIT"),
    subtitle: tagValue(tags, "SUBTITLE") ?? undefined,
    credit: tagValue(tags, "CREDIT") ?? undefined,
    source: tagValue(tags, "SOURCE") ?? undefined,
    tags: (tagValue(tags, "TAGS") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
    previewTimeMs: Number.isFinite(sampleStart) ? Math.round(sampleStart * 1000) : null,
  };
}

/**
 * Identity of a difficulty the way osu! sees it: key count plus name. A folder
 * that ships both .sm and .ssc copies (or repeats a #NOTES block) would
 * otherwise import the same difficulty twice.
 */
function chartIdentity(chart: Chart): string {
  return `${chart.keyCount}|${chart.meta.name}`;
}

function buildChart(
  raw: RawChart,
  file: string,
  warnings: string[],
  assumeKeys: number | undefined,
): Chart | null {
  const declared = keyCountForStepType(raw.stepType);
  if (declared === undefined && assumeKeys === undefined) {
    warnings.push(`${file}: unknown step type "${raw.stepType}", chart skipped`);
    return null;
  }
  if (declared === undefined) {
    warnings.push(`${file}: unknown step type "${raw.stepType}", assuming ${assumeKeys} keys`);
  }
  const keyCount = declared ?? assumeKeys!;

  const timing = parseTiming(raw.tags, file, warnings);
  let timingMap: TimingMap;
  try {
    timingMap = new TimingMap(timing);
  } catch (error) {
    warnings.push(`${file}: chart "${raw.difficulty}" skipped: ${(error as Error).message}`);
    return null;
  }
  warnings.push(...timingMap.warnings.map((warning) => `${file}: ${warning}`));

  const parsed = parseNoteData(raw.noteData, keyCount);
  warnings.push(...parsed.warnings.map((warning) => `${file}: ${warning}`));

  if (parsed.notes.length === 0) {
    warnings.push(`${file}: chart "${raw.difficulty}" has no notes, skipped`);
    return null;
  }

  const notes: Note[] = [];
  for (const parsedNote of parsed.notes) {
    if (timingMap.isInsideWarp(parsedNote.beat)) {
      warnings.push(`${file}: note inside a warp at beat ${parsedNote.beat.n}/${parsedNote.beat.d} dropped`);
      continue;
    }
    notes.push(toNote(parsedNote.column, parsedNote.beat, parsedNote.kind, parsedNote.lengthBeats, timingMap));
  }

  if (notes.length === 0) {
    warnings.push(`${file}: chart "${raw.difficulty}" has no playable notes, skipped`);
    return null;
  }

  return {
    keyCount,
    meta: {
      name: difficultyName(raw.difficulty),
      stepType: raw.stepType,
      meter: raw.meter,
      radar: raw.radar,
    },
    timing,
    notes,
    backgroundEvents: [],
    sourceText: raw.noteData,
  };
}

function toNote(
  column: number,
  noteBeat: Beat,
  kind: Note["kind"],
  lengthBeats: Beat,
  timingMap: TimingMap,
): Note {
  const note: Note = {
    column,
    beat: noteBeat,
    ms: timingMap.timeAt(noteBeat),
    kind,
  };
  if (lengthBeats.n > 0) {
    const endBeat = addBeats(noteBeat, lengthBeats);
    note.endBeat = endBeat;
    note.endMs = timingMap.timeAt(endBeat);
  }
  return note;
}

function difficultyName(difficulty: string): string {
  const trimmed = difficulty.trim();
  if (trimmed.length === 0) return "Edit";
  const known = DIFFICULTY_LABELS[trimmed.toLowerCase()];
  if (known !== undefined) return known;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function parseTiming(tags: MsdTag[], file: string, warnings: string[]): TempoMap {
  const offsetText = tagValue(tags, "OFFSET");
  let offsetSeconds = 0;
  if (offsetText === undefined) {
    warnings.push(`${file}: no #OFFSET tag, assuming 0`);
  } else {
    const parsed = Number(offsetText);
    if (Number.isFinite(parsed)) offsetSeconds = parsed;
    else warnings.push(`${file}: unreadable #OFFSET "${offsetText}", assuming 0`);
  }

  const bpm = parsePairs(tagValue(tags, "BPMS"), file, "BPMS", warnings, (value, pair) => ({
    beat: pair.beat,
    bpm: value,
  }));
  if (bpm.length === 0) {
    warnings.push(`${file}: no usable #BPMS tag, assuming 120 BPM from beat 0`);
    bpm.push({ beat: ZERO_BEAT, bpm: 120 });
  }

  const stops = parsePairs(tagValue(tags, "STOPS"), file, "STOPS", warnings, (value, pair) => ({
    beat: pair.beat,
    seconds: value,
  }));
  const delays = parsePairs(tagValue(tags, "DELAYS"), file, "DELAYS", warnings, (value, pair) => ({
    beat: pair.beat,
    seconds: value,
  }));
  const warps = parsePairs(tagValue(tags, "WARPS"), file, "WARPS", warnings, (value, pair) => ({
    beat: pair.beat,
    beats: value,
  }));

  return { offsetSeconds, bpm, stops, delays, warps };
}

/**
 * Reads `beat=value` lists such as `0=180,64=175`. A malformed entry is
 * dropped with a log line instead of failing the song.
 */
function parsePairs<T>(
  value: string | undefined,
  file: string,
  label: string,
  warnings: string[],
  map: (value: number, pair: { beat: Beat }) => T,
): T[] {
  if (value === undefined || value.trim().length === 0) return [];
  const out: T[] = [];
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      warnings.push(`${file}: ignoring malformed #${label} entry "${trimmed}"`);
      continue;
    }
    const pairBeat = parseNumber(trimmed.slice(0, eq));
    const pairValue = parseNumber(trimmed.slice(eq + 1));
    if (pairBeat === null || pairValue === null) {
      warnings.push(`${file}: ignoring malformed #${label} entry "${trimmed}"`);
      continue;
    }
    out.push(map(pairValue, { beat: parseBeat(trimmed.slice(0, eq)) }));
  }
  return out;
}

function parseNumber(text: string): number | null {
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Picks the audio, background and banner. #MUSIC wins; a missing file falls
 * back to the only audio file in the folder (spec section 5).
 */
function resolveAssets(
  songTags: MsdTag[],
  files: string[],
  warnings: string[],
): SongAssets | null {
  const lower = new Map(files.map((file) => [file.toLowerCase(), file]));
  const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.has(extname(file).toLowerCase()));

  let audio = "";
  const declared = tagValue(songTags, "MUSIC")?.trim() ?? "";
  if (declared.length > 0) {
    const match = lower.get(declared.toLowerCase());
    if (match !== undefined) {
      audio = match;
    } else if (audioFiles.length === 1) {
      audio = audioFiles[0]!;
      warnings.push(`audio file "${declared}" is missing, using the only audio file "${audio}"`);
    } else if (audioFiles.length === 0) {
      warnings.push(`audio file "${declared}" is missing and the folder has no audio`);
    } else {
      warnings.push(
        `audio file "${declared}" is missing and the folder has ${audioFiles.length} audio files, cannot guess`,
      );
    }
  } else if (audioFiles.length === 1) {
    audio = audioFiles[0]!;
    warnings.push(`no #MUSIC tag, using the only audio file "${audio}"`);
  } else if (audioFiles.length > 1) {
    warnings.push(`no #MUSIC tag and ${audioFiles.length} audio files, cannot guess`);
  } else {
    warnings.push("folder has no audio file");
  }

  if (audio.length === 0) return null;

  return {
    audio,
    background: pickImage(songTags, "BACKGROUND", files, /bg/i),
    banner: pickImage(songTags, "BANNER", files, /bn/i),
    cdTitle: pickImage(songTags, "CDTITLE", files, /cdtitle/i),
  };
}

/** Tag file first, then a name hint, then nothing: a wrong image is worse. */
function pickImage(
  songTags: MsdTag[],
  key: string,
  files: string[],
  hint: RegExp,
): string | undefined {
  const declared = tagValue(songTags, key)?.trim() ?? "";
  if (declared.length > 0) {
    const match = files.find((file) => file.toLowerCase() === declared.toLowerCase());
    if (match !== undefined) return match;
  }
  return files.find((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()) && hint.test(file));
}