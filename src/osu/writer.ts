import { TimingMap } from "../ir/timing.js";
import type { Chart, Song } from "../ir/types.js";
import { mapNotes, type MappedNote } from "./note-mapping.js";

/** osu identifies an object by content, these stay zero so nothing is online. */
const BEATMAP_ID = 0;
const BEATMAP_SET_ID = -1;

export interface WriteOptions {
  /** Difficulties are suffixed with it, e.g. "4K Challenge #a1b2c3". */
  versionHash: string;
  creator: string;
  audioFileName: string;
  minHoldBeats: number;
}

export interface WrittenBeatmap {
  version: string;
  content: string;
}

/**
 * Writes one osu!mania difficulty. Input is always IR: this module never
 * learns about the source format (spec section 4).
 *
 * Timing comes from the chart's own tempo map, so one .osz can hold
 * difficulties with different timing (spec section 6). Rounding to whole
 * milliseconds happens here and only here, per line.
 */
export function writeBeatmap(song: Song, chart: Chart, options: WriteOptions): WrittenBeatmap {
  const timing = new TimingView(chart);
  const { notes } = mapNotes(chart.notes, { minHoldBeats: options.minHoldBeats });
  const version = `${chart.keyCount}K ${chart.meta.name} #${options.versionHash}`;

  const metadata = song.metadata;
  const lines: string[] = [];

  lines.push("osu file format v14");
  lines.push("");
  lines.push("[General]");
  lines.push(`AudioFilename: ${options.audioFileName}`);
  lines.push("AudioLeadIn: 0");
  lines.push(`PreviewTime: ${metadata.previewTimeMs ?? -1}`);
  lines.push("Countdown: 0");
  lines.push("SampleSet: Soft");
  lines.push("StackLeniency: 0.2");
  lines.push("Mode: 3");
  lines.push("LetterboxInBreaks: 0");
  lines.push("WidescreenStoryboard: 0");
  lines.push("");
  lines.push("[Editor]");
  lines.push("DistanceSpacing: 0.8");
  lines.push("BeatDivisor: 4");
  lines.push("GridSize: 32");
  lines.push("TimelineZoom: 1");
  lines.push("");
  lines.push("[Metadata]");
  lines.push(`Title:${strip(metadata.title)}`);
  lines.push(`TitleUnicode:${strip(metadata.titleUnicode ?? metadata.title)}`);
  lines.push(`Artist:${strip(metadata.artist)}`);
  lines.push(`ArtistUnicode:${strip(metadata.artistUnicode ?? metadata.artist)}`);
  lines.push(`Version:${strip(version)}`);
  lines.push(`Creator:${strip(options.creator)}`);
  lines.push(`Source:${strip(metadata.source ?? "")}`);
  lines.push(`Tags:${metadata.tags.join(" ")}`);
  lines.push(`BeatmapID:${BEATMAP_ID}`);
  lines.push(`BeatmapSetID:${BEATMAP_SET_ID}`);
  lines.push("");
  lines.push("[Difficulty]");
  lines.push("HPDrainRate:7");
  lines.push(`CircleSize:${chart.keyCount}`);
  lines.push("OverallDifficulty:8");
  lines.push("ApproachRate:5");
  lines.push("SliderMultiplier:1.4");
  lines.push("SliderTickRate:1");
  lines.push("");
  lines.push("[Events]");
  lines.push("//Background and Video events");
  if (song.assets.background !== undefined) {
    lines.push(`0,0,"${escapeString(song.assets.background)}",0,0`);
  }
  lines.push("//Break Periods");
  lines.push("//Storyboard Layer 0 (Background)");
  lines.push("//Storyboard Layer 1 (Fail)");
  lines.push("//Storyboard Layer 2 (Pass)");
  lines.push("//Storyboard Layer 3 (Foreground)");
  lines.push("//Storyboard Sound Samples");
  lines.push("//Storyboard Layer 4 (Timeline)");
  lines.push("");
  lines.push("[TimingPoints]");
  // time, beatLength, meter, sampleSet, sampleIndex, volume, uninherited, effects
  for (const line of timing.redLines()) {
    const beatLength = formatBeatLength(60000 / line.bpm);
    lines.push(`${Math.round(line.ms)},${beatLength},4,2,0,60,1,0`);
  }
  lines.push("");
  lines.push("[HitObjects]");

  const columnWidth = 512 / chart.keyCount;
  for (const note of notes) {
    lines.push(writeHitObject(note, columnWidth));
  }
  lines.push("");

  return { version, content: lines.join("\r\n") };
}

/**
 * osu stores no beat hint in hit objects; the absolute time alone decides
 * where the note lands. This wrapper only exists to expose the timing points.
 */
class TimingView {
  private readonly map: TimingMap;

  constructor(chart: Chart) {
    this.map = new TimingMap(chart.timing);
  }

  redLines(): { ms: number; bpm: number }[] {
    return this.map.redLines().map((line) => ({ ms: line.ms, bpm: line.bpm }));
  }
}

/**
 * osu!mania hit object: x, y, time, type, hitSound, objectParams, hitSample.
 * y is unused in mania and kept at the conventional 192; type is 1 for a tap
 * and 128 for a hold, whose objectParams carry the release time.
 */
function writeHitObject(note: MappedNote, columnWidth: number): string {
  const x = Math.round((note.column + 0.5) * columnWidth);
  const startMs = Math.round(note.startMs);

  if (note.endMs !== undefined) {
    return `${x},192,${startMs},128,0,${Math.round(note.endMs)}:0:0:0:0:`;
  }
  return `${x},192,${startMs},1,0,0:0:0:0:`;
}

/** Full precision, trimmed: osu stores floats in the beat length. */
function formatBeatLength(value: number): string {
  return Number(value.toFixed(7)).toString();
}

function strip(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

function escapeString(text: string): string {
  return text.replace(/"/g, "'");
}

export function audioFileName(song: Song): string {
  return song.assets.audio;
}