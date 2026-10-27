/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
import { buildBlocks } from "./blocks.js";
import { preprocess } from "./preprocess.js";
import type { NoteBlock, PreprocessItem, RizuNote } from "./types.js";

/**
 * Widens a chart from `columnCount` to `targetMode` (N < M).
 * Port of rizu's `chart/transform/NextUpscaler.lua` and
 * `chart/transform/SolutionSeeker.lua` (GPL-3.0); the notes are spread over
 * the wider field, never duplicated.
 */
export function expandNotes(
  notes: RizuNote[],
  columnCount: number,
  targetMode: number,
): { notes: RizuNote[]; solved: boolean } {
  preprocess(notes, columnCount);

  const blocks = buildBlocks(notes);
  preprocess(blocks, columnCount);

  const solved = nextUpscale(blocks, columnCount, targetMode);

  const out: RizuNote[] = [];
  for (const block of blocks) {
    for (const note of block.notes) {
      note.columnIndex = block.columnIndex;
      out.push(note);
    }
  }

  return { notes: out, solved };
}

function nextUpscale(blocks: NoteBlock[], columnCount: number, targetMode: number): boolean {
  const check = (index: number, lane: number): number =>
    checkRate(blocks, index, lane, columnCount, targetMode);

  const solved = solve(blocks, targetMode, check);

  for (const block of blocks) {
    if (block.seeker?.lane !== undefined) block.columnIndex = block.seeker.lane;
  }

  return solved;
}

/**
 * Backtracks over the notes, giving each one the best free lane according to
 * `check`. Port of `SolutionSeeker.lua`.
 */
function solve(
  notes: PreprocessItem[],
  laneCount: number,
  check: (index: number, lane: number) => number,
): boolean {
  let noteIndex = 0;

  for (;;) {
    const note = notes[noteIndex];
    if (note === undefined) break;

    note.seeker ??= {};
    const seeker = note.seeker;

    seeker.lanes ??= new Array<number>(laneCount).fill(0);
    if (seeker.rates === undefined) {
      seeker.rates = [];
      for (let lane = 1; lane <= laneCount; lane += 1) {
        seeker.rates.push({ lane, rate: check(noteIndex, lane) });
      }
    }

    let topLane: number | undefined;
    let topRate = 0;
    for (const candidate of seeker.rates) {
      if (seeker.lanes[candidate.lane - 1] === 0 && candidate.rate > topRate) {
        topLane = candidate.lane;
        topRate = candidate.rate;
      }
    }

    if (topLane !== undefined) {
      seeker.lanes[topLane - 1] = 1;
      seeker.lane = topLane;
    }

    if (seeker.lane !== undefined) {
      noteIndex += 1;
      continue;
    }

    seeker.lanes = undefined;
    seeker.rates = undefined;

    const previous = notes[noteIndex - 1];
    if (previous === undefined) break;

    const previousSeeker = previous.seeker;
    if (previousSeeker?.lanes === undefined || previousSeeker.lane === undefined) break;
    previousSeeker.lanes[previousSeeker.lane - 1] = -1;
    previousSeeker.lane = undefined;
    noteIndex -= 1;
  }

  return noteIndex !== 0;
}

/** How much of a source column falls inside a target column, 1-based. */
function intersectSegment(tc: number, tm: number, bc: number, bm: number): number {
  return (
    (Math.max((tc - 1) / tm, Math.min(tc / tm, bc / bm)) -
      Math.min(tc / tm, Math.max((tc - 1) / tm, (bc - 1) / bm))) *
    tm
  );
}

function previousNoteIndex(notes: PreprocessItem[], index: number, lane: number): number | undefined {
  for (let k = index - 1; k >= 0; k -= 1) {
    if (notes[k]!.seeker?.lane === lane) return k;
  }
  return undefined;
}

function previousNote(notes: PreprocessItem[], index: number, lane: number): PreprocessItem | undefined {
  const found = previousNoteIndex(notes, index, lane);
  return found === undefined ? undefined : notes[found];
}

function getDelta(notes: PreprocessItem[], index: number, lane: number): number {
  const startTime = notes[index]!.startTime;
  const previous = previousNoteIndex(notes, index, lane);
  if (previous !== undefined) return Math.max(0, startTime - notes[previous]!.endTime);
  return startTime + 1000;
}

function checkHorizontalSpacing(
  notes: PreprocessItem[],
  index: number,
  lane: number,
  targetMode: number,
): number {
  const note = notes[index]!;
  const rates = new Array<number>(targetMode + 1).fill(1);

  // Literal port, including rizu's repeated per-column pass: every iteration
  // clears its own column first, so a blocked lane ends at 0.
  for (let column = 1; column <= targetMode; column += 1) {
    const previousIndex = previousNoteIndex(notes, index, lane);
    if (previousIndex === undefined) continue;

    const previous = notes[previousIndex]!;
    const deltaTime = note.startTime - previous.endTime;
    if (deltaTime > 0) continue;

    rates[column] = 0;
    const distance = note.distance?.get(previous);
    for (let other = 1; other <= targetMode; other += 1) {
      if (distance === undefined) break;
      if (
        rates[other]! > 0 &&
        Math.abs(other - previous.columnIndex) >= Math.abs(distance) &&
        (other - previous.columnIndex) * distance > 0
      ) {
        continue;
      }
      rates[other] = 0;
    }
  }

  return rates[lane]!;
}

function checkVerticalSpacing(notes: PreprocessItem[], index: number, lane: number): number {
  const note = notes[index]!;
  const previous = previousNote(notes, index, lane);
  if (previous === undefined) return 1;

  const basePrevious = note.bottom;
  if (basePrevious !== undefined) {
    const baseDelta = note.startTime - basePrevious.endTime;
    const delta = note.startTime - previous.endTime;
    if (delta < baseDelta) return 0;
  }

  const nextNote = note;
  const current = previous;

  const baseNext = current.top;
  if (baseNext !== undefined) {
    const baseDelta = baseNext.startTime - current.endTime;
    const delta = nextNote.startTime - current.endTime;
    if (delta < baseDelta) return 0;
  }

  return 1;
}

function checkRate(
  notes: PreprocessItem[],
  index: number,
  lane: number,
  columnCount: number,
  targetMode: number,
): number {
  let rate = 1;

  const note = notes[index];
  if (note === undefined) return rate;

  rate *= intersectSegment(lane, targetMode, note.columnIndex, columnCount);
  if (rate === 0) return rate;

  rate *= getDelta(notes, index, lane) / 1000;
  if (rate === 0) return rate;

  rate *= checkHorizontalSpacing(notes, index, lane, targetMode);
  if (rate === 0) return rate;

  rate *= checkVerticalSpacing(notes, index, lane);
  if (rate === 0) return rate;

  // rizu's recursion is disabled in the current version (`recursionLimit` 0).
  return rate;
}
