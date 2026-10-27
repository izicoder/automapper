import type { Beat } from "./beat.js";

/**
 * Source note kinds, before the osu mapping rules of spec section 8 run.
 * `lift` and `keysound` exist so the parser never has to decide anything.
 */
export type NoteKind = "tap" | "hold" | "roll" | "mine" | "fake" | "lift" | "keysound";

export interface Note {
  column: number;
  beat: Beat;
  /** Present for holds and rolls. */
  endBeat?: Beat;
  /** Absolute time in ms, computed once from the tempo map. */
  ms: number;
  endMs?: number;
  kind: NoteKind;
  /** Keysound sample path relative to the song folder (BMS, later versions). */
  keysound?: string;
}

/** A sample that is not attached to a column (BMS BGM channel 01). */
export interface BackgroundEvent {
  beat: Beat;
  ms: number;
  sample: string;
  volume?: number;
}

export interface BpmChange {
  beat: Beat;
  bpm: number;
}

export interface StopEvent {
  beat: Beat;
  seconds: number;
}

export interface DelayEvent {
  beat: Beat;
  seconds: number;
}

/** A warp skips `beats` beats of chart time without any time passing. */
export interface Warp {
  beat: Beat;
  beats: number;
}

/**
 * Timing belongs to a chart, not a song (spec section 6: an .ssc chart can
 * carry its own offset, BPMs, stops and delays).
 */
export interface TempoMap {
  /** StepMania #OFFSET in seconds. Beat 0 happens at -offset seconds. */
  offsetSeconds: number;
  bpm: BpmChange[];
  stops: StopEvent[];
  delays: DelayEvent[];
  warps: Warp[];
}

export interface ChartMeta {
  /** Difficulty name as shown in the source, e.g. "Challenge". */
  name: string;
  /** Source step type, e.g. "dance-solo". */
  stepType: string;
  /** Source meter, e.g. 11. Purely informational. */
  meter: number;
  /** Source radar values, kept for tags/metadata and future use. */
  radar?: Record<string, number>;
}

export interface Chart {
  keyCount: number;
  meta: ChartMeta;
  timing: TempoMap;
  notes: Note[];
  backgroundEvents: BackgroundEvent[];
  /** Raw chart text, used for the deterministic content hash (spec section 7). */
  sourceText: string;
}

export interface SongAssets {
  /** File name inside the song folder; the writer copies it into the .osz. */
  audio: string;
  background?: string;
  banner?: string;
  cdTitle?: string;
  video?: string;
}

export interface SongMetadata {
  title: string;
  titleUnicode?: string;
  artist: string;
  artistUnicode?: string;
  subtitle?: string;
  /** Original chart author, becomes the osu Creator. */
  credit?: string;
  source?: string;
  tags: string[];
  /** Preview start in ms, or null when the source gives none. */
  previewTimeMs: number | null;
  /** Loudness normalisation hint from the source (BMS), unused for v1. */
  sampleLengthMs?: number;
}

export interface Song {
  /** Folder name, used for file naming. */
  folderName: string;
  /** Absolute path of the song folder. */
  directory: string;
  metadata: SongMetadata;
  assets: SongAssets;
  charts: Chart[];
  /** Every parser guess (encoding, audio fallback, skipped chart) lands here. */
  warnings: string[];
}
