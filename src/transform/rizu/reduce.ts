/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
import { expDensity } from "./enps.js";
import { preprocess } from "./preprocess.js";
import type { Line, LinePair, PairCombination, PreprocessItem, RizuNote } from "./types.js";

/**
 * Narrows a chart from `columnCount` to `targetMode` (N > M).
 * Port of the reductor chain in rizu vsrg (GPL-3.0):
 *
 *   LinePreReductor  -> column overlap, maximum notes per line
 *   NoteCountReductor-> how many notes two neighbouring lines keep
 *   LineBalancer     -> which target columns, balancing density and jacks
 *   NoteApplyer      -> drop the surplus notes
 *   LongNoteReductor -> shorten holds that would cross the next line
 *
 * `chart/transform/Reductor.lua` is the entry point this function mirrors.
 */
export function reduceNotes(notes: RizuNote[], columnCount: number, targetMode: number): RizuNote[] {
  // Automap.processReductor treats every note as a tap while reducing; the
  // real long-note ends are kept in baseEndTime and restored afterwards.
  for (const note of notes) note.endTime = note.startTime;

  const { lines: preLines } = preprocess(notes, columnCount);
  const lines = buildLines(preLines, columnCount, targetMode);
  const pairs = buildPairs(lines, targetMode);
  chooseNoteCounts(pairs, targetMode);
  balanceLines(lines, targetMode);
  applyNotes(notes, lines);
  reduceLongNotes(notes, lines);

  return notes.filter((note) => note.reducedColumnIndex !== undefined);
}

/** How much of source column `bc` falls into target column `tc` (1-based). */
function intersectSegment(tc: number, tm: number, bc: number, bm: number): number {
  return (
    (Math.max((tc - 1) / tm, Math.min(tc / tm, bc / bm)) -
      Math.min(tc / tm, Math.max((tc - 1) / tm, (bc - 1) / bm))) *
    tm
  );
}

function createLine(startTime: number, items: PreprocessItem[]): Line {
  return { startTime, items };
}

/**
 * Builds the reducer's line list. Index 0 is an empty line, exactly like the
 * Lua table, so `lines[i - 1]` works for the first real line.
 */
function buildLines(preLines: Line[], columnCount: number, targetMode: number): Line[] {
  const intersect: number[][] = [];
  for (let target = 1; target <= targetMode; target += 1) {
    const row: number[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      row[column] = intersectSegment(target, targetMode, column, columnCount);
    }
    intersect[target] = row;
  }

  const empty = createLine(0, []);
  processLine(empty, intersect, targetMode);

  const lines: Line[] = [empty];
  for (const preLine of preLines) {
    const line = createLine(preLine.startTime, preLine.items);
    line.baseLine = preLine;
    processLine(line, intersect, targetMode);
    lines.push(line);
  }

  return lines;
}

/** LinePreReductor.processLine */
function processLine(line: Line, intersect: number[][], targetMode: number): void {
  const baseNotes = line.baseLine?.items ?? [];
  line.baseNotes = baseNotes;
  line.combination = baseNotes.map((item) => item.columnIndex).sort((a, b) => a - b);
  line.noteCount = baseNotes.length;
  line.time = baseNotes.length > 0 ? baseNotes[0]!.startTime : 0;
  line.shortNoteCount = baseNotes.filter((item) => item.startTime === item.endTime).length;
  line.longNoteCount = baseNotes.filter((item) => item.startTime !== item.endTime).length;

  if (baseNotes.length === 0) {
    line.reducedNoteCount = 0;
  }

  line.overlap = new Array<number>(targetMode + 1).fill(0);
  for (let target = 1; target <= targetMode; target += 1) {
    let sum = 0;
    for (const column of line.combination) sum += intersect[target]![column] ?? 0;
    line.overlap[target] = sum;
  }

  let countedOverlap = 0;
  for (let target = 1; target <= targetMode; target += 1) {
    if (line.overlap[target]! > 0) countedOverlap += 1;
  }

  line.maxReducedNoteCount = Math.min(countedOverlap, line.combination.length);
}

/** NoteCountReductor.preprocessLinePairs */
function buildPairs(lines: Line[], targetMode: number): LinePair[] {
  const pairs: LinePair[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const pair: LinePair = { index, line1: lines[index]!, line2: lines[index + 1]! };
    pairs.push(pair);

    pair.line1.pair1 = pairs[index - 1];
    pair.line1.pair2 = pair;
    pair.line2.pair1 = pair;
    pair.line2.pair2 = pairs[index + 1];

    preprocessPair(pair, targetMode);
  }

  return pairs;
}

/** NoteCountReductor.processJackCount */
function processJackCount(pair: LinePair, targetMode: number): void {
  const counts = new Map<number, number>();
  for (const column of pair.line1.combination!) counts.set(column, (counts.get(column) ?? 0) + 1);
  for (const column of pair.line2.combination!) counts.set(column, (counts.get(column) ?? 0) + 1);

  let jackCount = 0;
  for (const count of counts.values()) {
    if (count === 2) jackCount += 1;
  }

  let overlapsCount = 0;
  for (let target = 1; target <= targetMode; target += 1) {
    if (pair.line1.overlap![target]! > 0 && pair.line2.overlap![target]! > 0) overlapsCount += 1;
  }

  pair.jackCount = jackCount;
  pair.overlapsCount = overlapsCount;
  pair.preReducedJackCount = Math.min(overlapsCount, jackCount);
  if (targetMode === 1) pair.preReducedJackCount = Math.max(pair.preReducedJackCount, 1);
}

/** NoteCountReductor.preprocessLinePair */
function preprocessPair(pair: LinePair, targetMode: number): void {
  processJackCount(pair, targetMode);
  const preReducedJackCount = pair.preReducedJackCount!;

  const combinations = new Map<number, Map<number, PairCombination>>();
  for (let j = 1; j <= pair.line1.maxReducedNoteCount!; j += 1) {
    const sub = new Map<number, PairCombination>();
    combinations.set(j, sub);

    for (let k = 1; k <= pair.line2.maxReducedNoteCount!; k += 1) {
      if (j + k <= targetMode + preReducedJackCount) {
        let ratio = j / k / (pair.line1.noteCount! / pair.line2.noteCount!);
        if (ratio > 1) ratio = 1 / ratio;
        sub.set(k, { j, k, ratio, sum: j + k });
      }
    }
  }

  if (combinations.size === 0) {
    const sub = new Map<number, PairCombination>();
    combinations.set(0, sub);
    for (let k = 1; k <= pair.line2.maxReducedNoteCount!; k += 1) {
      sub.set(k, { j: 0, k, ratio: 1, sum: k });
    }
  }

  pair.combinations = combinations;
}

interface CountState {
  pairs: LinePair[];
  targetMode: number;
  recursionLimit: number;
}

/** NoteCountReductor.check */
function checkPair(state: CountState, pairIndex: number, line2NoteCount: number): number {
  let rate = 0;

  const pair = state.pairs[pairIndex]!;
  const nextPair = state.pairs[pairIndex + 1];
  const line1 = pair.line1;
  const line2 = pair.line2;

  const combination = pair.combinations?.get(line1.reducedNoteCount!)?.get(line2NoteCount);
  if (combination === undefined) return 0;

  const delta = line1.noteCount! - line2.noteCount!;
  const reducedDelta = line1.reducedNoteCount! - line2NoteCount;
  if (Math.abs(reducedDelta) - Math.abs(delta) > 0 || reducedDelta * delta < 0) return 0;

  rate += combination.sum;

  if (state.recursionLimit >= 1 && nextPair !== undefined) {
    const maxNextLine2NoteCount = Math.min(
      nextPair.line2.maxReducedNoteCount!,
      state.targetMode + nextPair.preReducedJackCount! - line2NoteCount,
    );
    if (maxNextLine2NoteCount === 0) return 0;

    state.recursionLimit /= maxNextLine2NoteCount;

    pair.bestLine2NoteCount = line2NoteCount;
    line2.reducedNoteCount = line2NoteCount;

    let maxNextRate = 0;
    for (let next = 1; next <= maxNextLine2NoteCount; next += 1) {
      maxNextRate = Math.max(maxNextRate, checkPair(state, pairIndex + 1, next));
    }
    rate += maxNextRate;

    pair.bestLine2NoteCount = undefined;
    line2.reducedNoteCount = undefined;

    state.recursionLimit *= maxNextLine2NoteCount;
  }

  return rate;
}

/** NoteCountReductor.processLinePairs */
function chooseNoteCounts(pairs: LinePair[], targetMode: number): void {
  const state: CountState = { pairs, targetMode, recursionLimit: 1000 };

  for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    const pair = pairs[pairIndex]!;
    const nextPair = pairs[pairIndex + 1];

    const maxLine2NoteCount = Math.max(
      1,
      Math.min(
        pair.line2.maxReducedNoteCount!,
        targetMode + pair.preReducedJackCount! - pair.line1.reducedNoteCount!,
        targetMode + (nextPair !== undefined ? nextPair.preReducedJackCount! - 1 : 0),
      ),
    );

    const rates: number[] = [];
    const combinations: (PairCombination | undefined)[] = [];

    for (let line2NoteCount = 1; line2NoteCount <= maxLine2NoteCount; line2NoteCount += 1) {
      state.recursionLimit /= maxLine2NoteCount;
      rates[line2NoteCount] = checkPair(state, pairIndex, line2NoteCount);
      combinations[line2NoteCount] = pair.combinations
        ?.get(pair.line1.reducedNoteCount!)
        ?.get(line2NoteCount);
      state.recursionLimit *= maxLine2NoteCount;
    }

    let bestLine2NoteCount = 1;
    let bestCombination = combinations[1];
    let bestRate = rates[1] ?? 0;

    for (let line2NoteCount = 1; line2NoteCount <= maxLine2NoteCount; line2NoteCount += 1) {
      const rate = rates[line2NoteCount] ?? 0;
      const combination = combinations[line2NoteCount];
      if (combination === undefined) continue;

      let currentIsBetter = false;
      if (rate > bestRate) {
        currentIsBetter = true;
      } else if (rate === bestRate && bestCombination !== undefined) {
        if (combination.ratio !== bestCombination.ratio) {
          currentIsBetter = combination.ratio > bestCombination.ratio;
        }
        if (combination.j === combination.k && bestCombination.j === bestCombination.k) {
          currentIsBetter = combination.j > bestCombination.j;
        }
      } else if (rate === bestRate && bestCombination === undefined) {
        currentIsBetter = true;
      }

      if (currentIsBetter) {
        bestLine2NoteCount = line2NoteCount;
        bestRate = rate;
        bestCombination = combination;
      }
    }

    pair.bestLine2NoteCount = bestLine2NoteCount;
    pair.line2.reducedNoteCount = bestLine2NoteCount;
    pair.reducedJackCount = Math.min(
      pair.preReducedJackCount!,
      pair.line1.reducedNoteCount!,
      pair.line2.reducedNoteCount!,
    );
  }
}

interface BalanceState {
  lines: Line[];
  targetMode: number;
  /** combinations[noteCount][index] = target columns, 1-based. */
  combinations: number[][][];
  /** maps[noteCount][index][targetColumn] = 0 | 1. */
  maps: number[][][];
  count: number[];
  densityStacks: { time: number; density: number }[][];
  recursionLimit: number;
}

/** All combinations of `k` columns out of `1..targetMode`, ascending. */
function columnCombinations(targetMode: number, k: number): number[][] {
  const out: number[][] = [];
  if (k < 1 || k > targetMode) return out;

  const current = Array.from({ length: k }, (_, i) => i + 1);
  for (;;) {
    out.push([...current]);
    let i = k - 1;
    while (i >= 0 && current[i]! >= targetMode - (k - 1 - i)) i -= 1;
    if (i < 0) break;
    current[i]! += 1;
    for (let j = i + 1; j < k; j += 1) current[j] = current[j - 1]! + 1;
  }

  return out;
}

function overDiff(map: number[], overlap: number[]): number {
  let sum = 0;
  for (let target = 1; target < overlap.length; target += 1) {
    sum += Math.abs(overlap[target]! - map[target]!);
  }
  return sum;
}

function lineExpDensities(state: BalanceState, time: number): number[] {
  const densities: number[] = [];
  for (let target = 1; target <= state.targetMode; target += 1) {
    const stack = state.densityStacks[target]!;
    const last = stack[stack.length - 1]!;
    densities[target] = expDensity((time - last.time) / 1000, last.density);
  }
  return densities;
}

/** LineBalancer.checkLine */
function checkLine(state: BalanceState, lineIndex: number, combinationIndex: number): number {
  const line = state.lines[lineIndex];
  if (line === undefined) return 1;

  const map = state.maps[line.reducedNoteCount!]![combinationIndex]!;
  const targetMode = state.targetMode;

  const previousLine = state.lines[lineIndex - 1];
  if (lineIndex - 1 !== 0 && previousLine !== undefined) {
    const previousIndex =
      previousLine.appliedLineCombinationIndex ?? previousLine.bestLineCombinationIndex;
    const previousMap = state.maps[previousLine.reducedNoteCount!]?.[previousIndex!];
    if (previousMap === undefined) return 0;

    const reducedJackCount = line.pair1!.reducedJackCount!;
    if (reducedJackCount === 0) {
      for (let target = 1; target <= targetMode; target += 1) {
        if (map[target] === previousMap[target] && map[target] === 1) return 0;
      }
    } else {
      let hasJack = false;
      let actualJackCount = 0;
      for (let target = 1; target <= targetMode; target += 1) {
        if (map[target] === previousMap[target] && map[target] === 1) {
          hasJack = true;
          actualJackCount += 1;
        }
      }
      if (!hasJack) return 0;

      const jackCount = line.pair1!.jackCount!;
      if (
        actualJackCount > reducedJackCount ||
        (actualJackCount / line.reducedNoteCount! < 1 &&
          jackCount / line.combination!.length === 1) ||
        actualJackCount / reducedJackCount < jackCount / line.combination!.length
      ) {
        return 0;
      }
    }
  }

  let densitySum = 0;
  const time = line.time!;
  const densities = lineExpDensities(state, time);
  for (let target = 1; target <= targetMode; target += 1) {
    if (map[target] === 1) {
      state.densityStacks[target]!.push({ time, density: densities[target]! });
      densitySum += densities[target]!;
    }
  }

  const difference = overDiff(map, line.overlap!);

  let rate = 1;
  if (difference > 0) rate *= 1 / difference;
  if (densitySum > 0) rate *= 1 / densitySum;

  const nextLine = state.lines[lineIndex + 1];
  if (state.recursionLimit >= 1 && nextLine !== undefined) {
    const combinationsCount = state.count[nextLine.reducedNoteCount!]!;

    state.recursionLimit /= combinationsCount;
    line.appliedLineCombinationIndex = combinationIndex;

    let maxNextRate = 0;
    for (let index = 1; index <= combinationsCount; index += 1) {
      maxNextRate = Math.max(maxNextRate, checkLine(state, lineIndex + 1, index));
    }
    rate *= maxNextRate;

    line.appliedLineCombinationIndex = undefined;
    state.recursionLimit *= combinationsCount;
  }

  for (let target = 1; target <= targetMode; target += 1) {
    if (map[target] === 1) state.densityStacks[target]!.pop();
  }

  return rate;
}

/** LineBalancer.balanceLines */
function balanceLines(lines: Line[], targetMode: number): void {
  const state: BalanceState = {
    lines,
    targetMode,
    combinations: [],
    maps: [],
    count: [],
    densityStacks: [],
    recursionLimit: 100,
  };

  for (let noteCount = 1; noteCount <= targetMode; noteCount += 1) {
    const table = columnCombinations(targetMode, noteCount);

    // 1-based like the Lua tables: combinations[noteCount][index].
    const combos: number[][] = [];
    const maps: number[][] = [];
    for (let index = 0; index < table.length; index += 1) {
      combos[index + 1] = table[index]!;

      const map = new Array<number>(targetMode + 1).fill(0);
      for (const column of table[index]!) map[column] = 1;
      maps[index + 1] = map;
    }

    state.combinations[noteCount] = combos;
    state.maps[noteCount] = maps;
    state.count[noteCount] = table.length;
  }

  const emptyMaps: number[][] = [];
  state.maps[0] = emptyMaps;
  state.count[0] = 0;

  for (let target = 1; target <= targetMode; target += 1) {
    state.densityStacks[target] = [{ time: -Infinity, density: 0 }];
  }

  for (let lineIndex = 1; lineIndex <= lines.length - 1; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const combinationsCount = state.count[line.reducedNoteCount!]!;

    const rates: number[] = [];
    for (let index = 1; index <= combinationsCount; index += 1) {
      state.recursionLimit /= combinationsCount;
      rates[index] = checkLine(state, lineIndex, index);
      state.recursionLimit *= combinationsCount;
    }

    let bestIndex: number | undefined;
    let bestRate = 0;
    for (let index = 1; index <= combinationsCount; index += 1) {
      const rate = rates[index] ?? 0;
      if (bestIndex === undefined || rate > bestRate) {
        bestIndex = index;
        bestRate = rate;
      }
    }

    line.bestLineCombinationIndex = bestIndex;
    line.bestLineCombination = state.combinations[line.reducedNoteCount!]![bestIndex ?? 1]!;

    const time = line.time!;
    const densities = lineExpDensities(state, time);
    const chosen = state.maps[line.reducedNoteCount!]![bestIndex ?? 1]!;
    for (let target = 1; target <= targetMode; target += 1) {
      if (chosen[target] === 1) {
        state.densityStacks[target]!.push({ time, density: densities[target]! });
      }
    }
  }
}

/** NoteApplyer */
function applyNotes(notes: RizuNote[], lines: Line[]): void {
  for (let lineIndex = 1; lineIndex <= lines.length - 1; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (line.reducedNoteCount === line.noteCount) applyNotesEqual(line);
    else applyNotesLess(line);
  }

  for (const note of notes) {
    if (note.reducedColumnIndex !== undefined) note.columnIndex = note.reducedColumnIndex;
    note.endTime = note.baseEndTime;
  }
}

function applyNotesEqual(line: Line): void {
  const notes: PreprocessItem[] = [];
  for (let i = 1; i <= line.reducedNoteCount!; i += 1) notes.push(line.baseNotes![i - 1]!);
  assignColumns(line, notes);
  line.reducedNotes = notes;
}

/** Hands the kept notes their target columns, left to right. */
function assignColumns(line: Line, notes: PreprocessItem[]): void {
  line.appliedSuggested ??= {};
  for (let i = 1; i <= line.reducedNoteCount!; i += 1) {
    const note = notes[i - 1]!;
    const column = line.bestLineCombination![i - 1]!;
    (note as RizuNote).reducedColumnIndex = column;
    line.appliedSuggested[column] = note;
  }
}

function applyNotesLess(line: Line): void {
  if (line.shortNoteCount! > 0 && line.longNoteCount === 0) {
    applyNotesLessShort(line);
  } else if (line.shortNoteCount === 0 && line.longNoteCount! > 0) {
    applyNotesLessLong(line);
  } else if (line.shortNoteCount! > 0 && line.longNoteCount! > 0) {
    applyNotesLessCombined(line);
  }
}

function applyNotesLessShort(line: Line): void {
  // rizu keeps the leftmost notes of the line.
  const kept = line.baseNotes!.slice(0, line.reducedNoteCount!);
  line.reducedNotes = kept;
  assignColumns(line, kept);
}

function applyNotesLessLong(line: Line): void {
  line.reducedNotes = trimNotes(line, (notes) => {
    let longest = 0;
    for (let i = 1; i < notes.length; i += 1) {
      if ((notes[i] as RizuNote).baseEndTime > (notes[longest] as RizuNote).baseEndTime) longest = i;
    }
    return longest;
  });
}

function applyNotesLessCombined(line: Line): void {
  line.reducedNotes = trimNotes(line, (notes) => {
    const short = notes.findIndex((note) => note.startTime === (note as RizuNote).baseEndTime);
    if (short >= 0) return short;

    let longest = 0;
    for (let i = 1; i < notes.length; i += 1) {
      if ((notes[i] as RizuNote).baseEndTime > (notes[longest] as RizuNote).baseEndTime) longest = i;
    }
    return longest;
  });
}

/**
 * Drops notes until the line keeps `reducedNoteCount`, then hands out target
 * columns. `pickRemoved` chooses the note to remove next.
 */
function trimNotes(line: Line, pickRemoved: (notes: PreprocessItem[]) => number): PreprocessItem[] {
  const notes = [...line.baseNotes!];
  while (notes.length > line.reducedNoteCount!) {
    notes.splice(pickRemoved(notes), 1);
  }

  assignColumns(line, notes);
  return notes;
}

/** LongNoteReductor */
function reduceLongNotes(notes: RizuNote[], lines: Line[]): void {
  const allLinesMap = new Map<number, number>();
  for (const note of notes) {
    allLinesMap.set(note.startTime, 0);
    allLinesMap.set(note.baseEndTime, 0);
  }

  const allLines = [...allLinesMap.keys()].sort((a, b) => a - b);
  allLines.forEach((time, index) => allLinesMap.set(time, index));

  for (let i = 1; i <= lines.length - 2; i += 1) {
    const line = lines[i]!;

    for (const note of line.reducedNotes ?? []) {
      const real = note as RizuNote;
      if (real.baseEndTime === real.startTime) continue;

      const next = getNextLines(lines, i, real);
      const nextLine = next.nextLine;
      const preNextLine = next.preNextLine;
      if (nextLine === undefined || preNextLine === undefined) continue;

      const window = nextLine.time! - line.time! - 10;

      let gap: number | undefined;
      if (real.baseEndTime >= line.time! + window) {
        gap = nextLine.time! - preNextLine.time!;
      }

      let baseGap: number | undefined;
      const nearLineIndex = allLinesMap.get(real.baseEndTime)!;
      const nearLineTime = allLines[nearLineIndex + 1];
      if (nearLineTime !== undefined) baseGap = nearLineTime - real.baseEndTime;

      let reverseGap: number | undefined;
      const nextSuggested = nextLine.appliedSuggested?.[real.columnIndex] as RizuNote | undefined;
      const bottom = nextSuggested?.bottom as RizuNote | undefined;
      if (bottom !== undefined) reverseGap = nextSuggested!.startTime - bottom.baseEndTime;

      let minBaseGap: number | undefined;
      if (baseGap !== undefined && reverseGap !== undefined) {
        minBaseGap = Math.min(baseGap, reverseGap);
      } else if (baseGap !== undefined) {
        minBaseGap = baseGap;
      } else if (reverseGap !== undefined) {
        minBaseGap = reverseGap;
      }

      if (minBaseGap !== undefined && minBaseGap < window) {
        real.endTime = Math.min(nextLine.time! - minBaseGap, real.baseEndTime);
      } else if (gap !== undefined) {
        real.endTime = Math.min(nextLine.time! - gap, real.baseEndTime);
      } else {
        real.endTime = Math.min(real.startTime, real.baseEndTime);
      }
    }
  }
}

/** LongNoteReductor.getNextLines: the next line that uses the same column. */
function getNextLines(
  lines: Line[],
  lineIndex: number,
  note: RizuNote,
): { nextLine: Line | undefined; preNextLine: Line | undefined } {
  // Lua: `for j = i + 1, #lines - 2`; #lines is the number of real lines,
  // which is `lines.length - 1` here (index 0 is the empty line).
  for (let j = lineIndex + 1; j <= lines.length - 3; j += 1) {
    const nextLine = lines[j]!;
    if (nextLine.bestLineCombination?.includes(note.columnIndex)) {
      return { nextLine, preNextLine: lines[j - 1] };
    }
  }
  return { nextLine: lines[lineIndex + 1], preNextLine: lines[lineIndex] };
}
