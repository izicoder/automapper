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
}

export const DEFAULT_MAP_OPTIONS: MapOptions = { minHoldBeats: 1 / 32 };

/**
 * Applies spec section 8 to one chart:
 *   mine and fake dropped, lift and keysound become taps,
 *   hold and roll become a long note,
 *   zero, negative or too short holds become taps,
 *   overlapping holds in one column are trimmed.
 *
 * The result is sorted by time and column and is safe to write directly.
 */
export function mapNotes(notes: readonly Note[], options: MapOptions = DEFAULT_MAP_OPTIONS): {
  notes: MappedNote[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const candidates: MappedNote[] = [];

  for (const note of notes) {
    switch (note.kind) {
      case "mine":
      case "fake":
        continue; // dropped by an explicit rule
      case "hold":
      case "roll": {
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

  const notes_out: MappedNote[] = [];
  const lastEnd = new Map<number, number>();

  for (const candidate of candidates) {
    const previousEnd = lastEnd.get(candidate.column);
    if (previousEnd !== undefined && candidate.startMs < previousEnd) {
      if (candidate.endMs !== undefined) {
        // An overlapping hold keeps its own tail but starts after the last end.
        if (candidate.endMs > previousEnd) {
          notes_out.push({ column: candidate.column, startMs: previousEnd, endMs: candidate.endMs });
          lastEnd.set(candidate.column, candidate.endMs);
        }
        warnings.push(`column ${candidate.column + 1}: hold at ${candidate.startMs.toFixed(3)} ms was trimmed`);
        continue;
      }
      // A tap inside another hold cannot be played: it moves to the release.
      if (previousEnd > candidate.startMs && previousEnd < candidate.startMs + 1) continue;
      notes_out.push({ column: candidate.column, startMs: previousEnd });
      warnings.push(`column ${candidate.column + 1}: note at ${candidate.startMs.toFixed(3)} ms was moved`);
      continue;
    }

    if (candidate.endMs !== undefined) lastEnd.set(candidate.column, candidate.endMs);
    else if (previousEnd === undefined || candidate.startMs >= previousEnd) lastEnd.delete(candidate.column);
    notes_out.push(candidate);
  }

  return { notes: notes_out, warnings };
}

function holdLengthBeats(note: Note): number {
  if (note.endBeat === undefined) return Number.POSITIVE_INFINITY;
  return (note.endBeat.n * note.beat.d - note.beat.n * note.endBeat.d) / (note.endBeat.d * note.beat.d);
}