/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
import type { NoteBlock, RizuNote } from "./types.js";

/**
 * Finds repeated note blocks: runs of notes that step through the lanes with
 * a fixed distance and timing, so the upscaler can move them as one piece.
 * Port of rizu's `chart/transform/BlockFinder.lua` and `NoteBlock.lua`.
 */
export function buildBlocks(notes: readonly RizuNote[]): NoteBlock[] {
  const lines = notes[0]?.line?.lines ?? [];

  for (const line of lines) {
    for (const item of line.items) {
      if (item.type !== undefined || item.locked) continue;
      lockBlock(extendBlock(findBlock(item as RizuNote)));
    }
  }

  const blocks: NoteBlock[] = [];
  for (const note of notes) {
    if (note.blockStart && note.block !== undefined) blocks.push(note.block);
  }
  blocks.sort((a, b) => a.startTime - b.startTime || a.columnIndex - b.columnIndex);
  return blocks;
}

function createBlock(): NoteBlock {
  return {
    startTime: 0,
    endTime: 0,
    columnIndex: 0,
    baseColumnIndex: 0,
    notes: [],
    size: 0,
  };
}

function addNote(block: NoteBlock, note: RizuNote): void {
  block.notes.push(note);
  if (block.notes.length === 1) {
    block.baseColumnIndex = note.columnIndex;
    block.startTime = note.startTime;
    block.endTime = note.endTime;
  } else {
    block.startTime = Math.min(block.startTime, note.startTime);
    block.endTime = Math.max(block.endTime, note.endTime);
  }
  block.columnIndex = block.baseColumnIndex;
  block.size += 1;
}

function lockBlock(block: NoteBlock): NoteBlock {
  block.locked = true;
  block.notes[0]!.blockStart = true;
  for (const note of block.notes) {
    note.block = block;
    note.locked = true;
  }
  return block;
}

/** Stretches a block's span to the start of the next line that follows it. */
function extendBlock(block: NoteBlock): NoteBlock {
  const lastNote = block.notes[block.notes.length - 1]!;
  const nextNote = lastNote.top as RizuNote | undefined;
  const nextLine = nextNote === undefined ? lastNote.line!.last : nextNote.line?.prev;

  if (nextLine === undefined || nextLine.startTime <= block.endTime) return block;
  block.endTime = nextLine.startTime;
  return block;
}

function matchDelta(a: number, b: number, c: number, d: number, strict = false): boolean {
  const delta = Math.abs(Math.abs(a - b) - Math.abs(c));
  return strict ? delta === Math.abs(d) : delta <= Math.abs(d);
}

function sameType(a: RizuNote, b: RizuNote): boolean {
  return (
    (a.startTime === a.endTime && b.startTime === b.endTime) ||
    matchDelta(Math.abs(a.endTime - a.startTime), Math.abs(b.endTime - b.startTime), 0, 1)
  );
}

function checkNextNote(
  note: RizuNote,
  nextNote: RizuNote | undefined,
  step: number,
  deltaTime: number,
  forceSameType: boolean,
): boolean {
  if (nextNote === undefined) return false;
  if (
    !(
      matchDelta(nextNote.lanePos!, note.lanePos!, 0, step) ||
      matchDelta(nextNote.startTime, note.startTime, deltaTime, 1)
    )
  ) {
    return false;
  }
  return forceSameType ? sameType(note, nextNote) : true;
}

function findBlock(note: RizuNote): NoteBlock {
  const block = createBlock();
  addNote(block, note);

  let current = note;
  let nextNote = note.top as RizuNote | undefined;
  if (nextNote === undefined) return block;

  const deltaTime = nextNote.startTime - note.startTime;
  let nextNote2 = nextNote.top as RizuNote | undefined;
  let step = 0;
  let forceSameType = false;

  if (matchDelta(nextNote.lanePos!, current.lanePos!, 0, 1, true)) {
    step = 1;
  } else if (matchDelta(nextNote.lanePos!, current.lanePos!, 0, 2, true)) {
    step = 2;
    forceSameType = true;
  } else if (sameType(current, nextNote) && current.startTime !== current.endTime) {
    forceSameType = true;
  } else if (
    nextNote2 !== undefined &&
    matchDelta(nextNote2.startTime, nextNote.startTime, deltaTime, 1) &&
    sameType(current, nextNote) &&
    sameType(current, nextNote2)
  ) {
    forceSameType = true;
  } else {
    return block;
  }

  while (checkNextNote(current, nextNote, step, deltaTime, forceSameType)) {
    addNote(block, nextNote);
    current = nextNote;
    nextNote = nextNote.top as RizuNote | undefined;
    if (nextNote === undefined) break;
  }

  return block;
}
