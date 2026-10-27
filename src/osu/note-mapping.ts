import { addBeats, beatFromDecimal, toNumber, type Beat } from "../ir/beat.js";
import type { Note } from "../ir/types.js";

/** An osu!mania hit object after the mapping rules of spec section 8. */
export interface MappedNote {
  column: number;
  startMs: number;
  /** Present for holds; always greater than startMs. */
  endMs?: number;
}

export interface MapOptions {
  /** Holds shorter than this many beats become taps (default: one 1/32 beat). */
  minHoldBeats: number;
  /** Split rolls into a series of taps instead of one long note. */
  rollAsTaps: boolean;
  /** Distance between the taps a roll is split into, in beats. */
  rollTapBeats: number;
  /** Beat -> absolute ms, needed to place the taps inside a split roll. */
  timeAt: (beat: Beat) => number;
}

export const DEFAULT_MAP_OPTIONS: Omit<MapOptions, "timeAt"> = {
  minHoldBeats: 1 / 32,
  rollAsTaps: false,
  rollTapBeats: 0.25,
};

/**
 * Applies spec section 8 to one chart:
 *   mine and fake dropped, lift and keysound become taps,
 *   hold becomes a long note, roll becomes a long note or a tap series,
 *   zero, negative or too short holds become taps,
 *   overlapping notes in one column are trimmed.
 *
 * The result is sorted by time and column and is safe to write directly.
 */
export function mapNotes(
  notes: readonly Note[],
  options: MapOptions,
): { notes: MappedNote[]; warnings: string[] } {
  const warnings: string[] = [];
  const candidates: MappedNote[] = [];

  for (const note of notes) {
    switch (note.kind) {
      case "mine":
      case "fake":
        continue; // dropped by an explicit rule
      case "hold":
      case "roll": {
        if (note.kind === "roll" && options.rollAsTaps) {
          candidates.push(...splitRoll(note, options, warnings));
          continue;
        }
        const endMs = note.endMs;
        const beats = holdLengthBeats(note);
        if (endMs === undefined || endMs <= note.ms || beats < options.minHoldBeats) {
          candidates.push({ column: note.column, startMs: note.ms });
          warnings.push(`column ${note.column + 1}: hold at ${note.ms.toFixed(3)} ms became a tap`);
          continue;
        }
        candidates.push({ column: note.column, startMs: note.ms, endMs });
        continue;
      }
      case "lift":
      case "keysound":
      case "tap":
        candidates.push({ column: note.column, startMs: note.ms });
        continue;
    }
  }

  candidates.sort((a, b) => a.startMs - b.startMs || a.column - b.column);

  const kept: MappedNote[] = [];
  const lastEnd = new Map<number, number>();

  for (const candidate of candidates) {
    const previousEnd = lastEnd.get(candidate.column);
    if (previousEnd !== undefined && candidate.startMs < previousEnd) {
      if (candidate.endMs !== undefined) {
        // An overlapping hold keeps its own tail but starts after the last end.
        if (candidate.endMs > previousEnd) {
          kept.push({ column: candidate.column, startMs: previousEnd, endMs: candidate.endMs });
          lastEnd.set(candidate.column, candidate.endMs);
        }
        warnings.push(`column ${candidate.column + 1}: hold at ${candidate.startMs.toFixed(3)} ms was trimmed`);
        continue;
      }
      // A tap inside another hold cannot be played: it moves to the release.
      if (previousEnd < candidate.startMs + 1) continue;
      kept.push({ column: candidate.column, startMs: previousEnd });
      warnings.push(`column ${candidate.column + 1}: note at ${candidate.startMs.toFixed(3)} ms was moved`);
      continue;
    }

    if (candidate.endMs !== undefined) lastEnd.set(candidate.column, candidate.endMs);
    else if (previousEnd === undefined || candidate.startMs >= previousEnd) lastEnd.delete(candidate.column);
    kept.push(candidate);
  }

  return { notes: kept, warnings };
}

/**
 * Splits one roll into taps. The last tap sits exactly on the release so the
 * roll still ends where the source ends.
 */
function splitRoll(note: Note, options: MapOptions, warnings: string[]): MappedNote[] {
  const endBeat = note.endBeat;
  if (endBeat === undefined || note.endMs === undefined) {
    warnings.push(`column ${note.column + 1}: roll at ${note.ms.toFixed(3)} ms has no length, became a tap`);
    return [{ column: note.column, startMs: note.ms }];
  }

  const step = options.rollTapBeats;
  if (!(step > 0)) {
    warnings.push(`column ${note.column + 1}: roll tap subdivision is not positive, roll became a tap`);
    return [{ column: note.column, startMs: note.ms }];
  }

  const taps: MappedNote[] = [];
  for (let beat = note.beat; toNumber(beat) < toNumber(endBeat); beat = addBeats(beat, beatFromDecimal(step))) {
    const ms = options.timeAt(beat);
    const previous = taps[taps.length - 1];
    if (previous !== undefined && ms <= previous.startMs) continue;
    taps.push({ column: note.column, startMs: ms });
  }

  const last = taps[taps.length - 1];
  if (last === undefined || last.startMs < note.endMs) {
    taps.push({ column: note.column, startMs: note.endMs });
  }

  return taps;
}

function holdLengthBeats(note: Note): number {
  if (note.endBeat === undefined) return Number.POSITIVE_INFINITY;
  return (note.endBeat.n * note.beat.d - note.beat.n * note.endBeat.d) / (note.endBeat.d * note.beat.d);
}
