/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
import type { Chart, Note } from "../ir/types.js";
import { compareBeats } from "../ir/beat.js";
import { isLegalKeyCount } from "../keys.js";
import { expandNotes } from "./rizu/expand.js";
import { reduceNotes } from "./rizu/reduce.js";
import type { RizuNote } from "./rizu/types.js";

export interface AutomapResult {
  chart: Chart;
  warnings: string[];
}

/**
 * Converts a chart from its own key count to `targetKeys`.
 *
 * This is a port of the key-count conversion from rizu vsrg
 * (https://github.com/semyon422/rizu, GPL-3.0): `Reduce` for N > M and
 * `Upscale` for N < M. Nothing else from rizu is used. Timing is untouched:
 * every note keeps its absolute time, holds keep their length, and the
 * mapper never invents notes — the upscaler only spreads existing ones.
 *
 * Notes are handled in whole milliseconds because rizu works that way; that
 * is also the precision osu stores.
 */
export function automapChart(chart: Chart, targetKeys: number): AutomapResult {
  if (!isLegalKeyCount(targetKeys)) {
    throw new Error(`target key count must be a whole number between 1 and 18, got ${targetKeys}`);
  }

  if (targetKeys === chart.keyCount) {
    return { chart: { ...chart, notes: [...chart.notes] }, warnings: [] };
  }

  const warnings: string[] = [];
  const sources = new Map<RizuNote, Note>();
  const notes: RizuNote[] = [];

  for (const note of chart.notes) {
    if (note.kind === "mine" || note.kind === "fake") continue; // dropped by spec rule
    const startTime = Math.round(note.ms);
    const endTime = note.endMs === undefined ? startTime : Math.round(note.endMs);
    const rizuNote: RizuNote = {
      startTime,
      endTime,
      baseEndTime: endTime,
      long: endTime > startTime,
      columnIndex: note.column + 1,
      baseColumnIndex: note.column + 1,
    };
    notes.push(rizuNote);
    sources.set(rizuNote, note);
  }

  notes.sort((a, b) => a.startTime - b.startTime || a.columnIndex - b.columnIndex);

  let mapped: RizuNote[];
  if (targetKeys < chart.keyCount) {
    mapped = reduceNotes(notes, chart.keyCount, targetKeys);
    const dropped = notes.length - mapped.length;
    if (dropped > 0) {
      warnings.push(
        `${dropped} note${dropped === 1 ? "" : "s"} dropped while fitting ${chart.keyCount}K into ${targetKeys}K`,
      );
    }
  } else {
    const expanded = expandNotes(notes, chart.keyCount, targetKeys);
    mapped = expanded.notes;
    if (!expanded.solved) {
      warnings.push(
        `${chart.keyCount}K to ${targetKeys}K: the lane solver could not place every note, kept source columns for the rest`,
      );
    }
  }

  const converted: Note[] = [];
  for (const rizuNote of mapped) {
    const source = sources.get(rizuNote)!;
    const isLong = rizuNote.long && rizuNote.endTime > rizuNote.startTime;

    const note: Note = {
      column: rizuNote.columnIndex - 1,
      beat: source.beat,
      ms: rizuNote.startTime,
      kind: isLong ? "hold" : "tap",
    };

    if (isLong) {
      note.endMs = rizuNote.endTime;
      // A shortened hold no longer matches the source beat position.
      if (rizuNote.endTime === rizuNote.baseEndTime) note.endBeat = source.endBeat;
    }

    converted.push(note);
  }

  converted.sort((a, b) => a.ms - b.ms || a.column - b.column || compareBeats(a.beat, b.beat));

  return {
    chart: {
      ...chart,
      keyCount: targetKeys,
      notes: converted,
      meta: { ...chart.meta },
    },
    warnings,
  };
}
