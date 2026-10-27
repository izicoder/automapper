import { beat, type Beat } from "../ir/beat.js";
import type { NoteKind } from "../ir/types.js";

export interface ParsedNote {
  column: number;
  beat: Beat;
  /** 0 for taps, mines, fakes and lifts. */
  lengthBeats: Beat;
  kind: NoteKind;
}

interface OpenHead {
  column: number;
  beat: Beat;
  kind: "hold" | "roll";
}

/**
 * Parses StepMania note data. A measure is a list of rows separated by commas;
 * rows may be any length (real charts use 4, 12, 48, 192 and even 4000+ rows),
 * and the row count defines the beat subdivision.
 *
 * Column order is preserved: source column 0 becomes output column 0.
 */
export function parseNoteData(text: string, columnCount: number): { notes: ParsedNote[]; warnings: string[] } {
  const warnings: string[] = [];
  const notes: ParsedNote[] = [];
  const open = new Map<number, OpenHead>();

  const lines = text.split(/\r\n|\n|\r/);
  let measure = 0;
  let rowsInMeasure: string[] = [];
  let lastBeat: Beat = beat(0);

  const flushMeasure = (): void => {
    if (rowsInMeasure.length === 0) {
      measure += 1;
      return;
    }
    const totalRows = rowsInMeasure.length;
    for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
      const row = rowsInMeasure[rowIndex]!;
      const rowBeat = beat(measure * 4 * totalRows + rowIndex * 4, totalRows);
      lastBeat = rowBeat;
      if (row.length !== columnCount) {
        warnings.push(
          `measure ${measure + 1} row ${rowIndex + 1}: expected ${columnCount} columns, found ${row.length}`,
        );
      }
      for (let column = 0; column < Math.min(columnCount, row.length); column += 1) {
        handleCell(row[column]!, column, rowBeat);
      }
    }
    measure += 1;
    rowsInMeasure = [];
  };

  const handleCell = (cell: string, column: number, rowBeat: Beat): void => {
    const trimmed = cell.trim();
    if (trimmed === "" || trimmed === "0") return;
    const openHead = open.get(column);

    switch (trimmed) {
      case "1":
        notes.push({ column, beat: rowBeat, lengthBeats: beat(0), kind: "tap" });
        return;
      case "2":
      case "4": {
        if (openHead !== undefined) {
          warnings.push(`column ${column + 1}: hold head at beat ${rowBeat.n}/${rowBeat.d} overlapped an open hold`);
          closeHead(openHead, rowBeat, false);
        }
        open.set(column, { column, beat: rowBeat, kind: trimmed === "2" ? "hold" : "roll" });
        return;
      }
      case "3": {
        if (openHead === undefined) {
          warnings.push(`column ${column + 1}: hold tail without a head at beat ${rowBeat.n}/${rowBeat.d}`);
          return;
        }
        closeHead(openHead, rowBeat, true);
        return;
      }
      case "M":
        notes.push({ column, beat: rowBeat, lengthBeats: beat(0), kind: "mine" });
        return;
      case "F":
        notes.push({ column, beat: rowBeat, lengthBeats: beat(0), kind: "fake" });
        return;
      case "L":
        notes.push({ column, beat: rowBeat, lengthBeats: beat(0), kind: "lift" });
        return;
      case "K":
        notes.push({ column, beat: rowBeat, lengthBeats: beat(0), kind: "keysound" });
        return;
      case "A": // attack, not supported: dropped by the type mapping rules
        notes.push({ column, beat: rowBeat, lengthBeats: beat(0), kind: "fake" });
        return;
      default:
        warnings.push(`column ${column + 1}: unknown note character "${trimmed}" at beat ${rowBeat.n}/${rowBeat.d}`);
    }
  };

  const closeHead = (head: OpenHead, endBeat: Beat, explicitTail: boolean): void => {
    open.delete(head.column);
    const lengthNumerator = endBeat.n * head.beat.d - head.beat.n * endBeat.d;
    const lengthDenominator = endBeat.d * head.beat.d;
    const length = beat(lengthNumerator, lengthDenominator);
    if (length.n <= 0 && explicitTail) {
      // Zero length hold: becomes a tap (spec section 8, edge rules).
      notes.push({ column: head.column, beat: head.beat, lengthBeats: beat(0), kind: "tap" });
      return;
    }
    notes.push({ column: head.column, beat: head.beat, lengthBeats: length, kind: head.kind });
  };

  for (const rawLine of lines) {
    // StepMania allows comments anywhere, including on the measure separator
    // (",  // measure 2") and after a row. Cut them before parsing.
    const comment = rawLine.indexOf("//");
    const line = (comment >= 0 ? rawLine.slice(0, comment) : rawLine).trim();
    if (line.length === 0) continue;
    if (line === ",") {
      flushMeasure();
      continue;
    }
    rowsInMeasure.push(line);
  }
  flushMeasure();

  for (const head of open.values()) {
    warnings.push(`column ${head.column + 1}: hold starting at beat ${head.beat.n}/${head.beat.d} was never closed`);
    closeHead(head, lastBeat, false);
  }

  notes.sort((a, b) => a.beat.n * b.beat.d - b.beat.n * a.beat.d || a.column - b.column);
  return { notes, warnings };
}
