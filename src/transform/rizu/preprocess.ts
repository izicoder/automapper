/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
import type { Line, PreprocessItem, RizuNote } from "./types.js";

export interface PreprocessResult {
  lines: Line[];
  lanes: PreprocessItem[][];
}

/**
 * Lays the notes out into lines (one per exact time) and lanes (one per
 * source column) and links them to their neighbours. Port of rizu's
 * `chart/transform/NotePreprocessor.lua`; long notes get body/tail entries
 * on every line they pass through, which is what keeps them out of the way
 * of single notes later.
 */
export function preprocess(items: PreprocessItem[], columnCount: number): PreprocessResult {
  const lineMaps = new Map<number, Map<number, PreprocessItem>>();
  const lanes: Map<number, Set<PreprocessItem>> = new Map();
  for (let column = 1; column <= columnCount; column += 1) lanes.set(column, new Set());

  for (const item of items) {
    let map = lineMaps.get(item.startTime);
    if (map === undefined) {
      map = new Map();
      lineMaps.set(item.startTime, map);
    }
    map.set(item.columnIndex, item);
    lanes.get(item.columnIndex)?.add(item);
  }

  const times = [...lineMaps.keys()].sort((a, b) => a - b);
  const openLong: (RizuNote | undefined)[] = new Array(columnCount + 1).fill(undefined);

  // Insert body/tail entries for every long note that is still held.
  for (const time of times) {
    const map = lineMaps.get(time)!;

    for (let column = 1; column <= columnCount; column += 1) {
      const long = openLong[column];
      if (long === undefined) continue;

      if (long.endTime < time) {
        openLong[column] = undefined;
        continue;
      }

      const pseudo: PreprocessItem = {
        startTime: time,
        endTime: time,
        columnIndex: column,
        baseColumnIndex: column,
        type: long.endTime === time ? "tail" : "body",
        note: long,
      };
      map.set(column, pseudo);
      lanes.get(column)?.add(pseudo);
      if (long.endTime === time) openLong[column] = undefined;
    }

    for (let column = 1; column <= columnCount; column += 1) {
      const item = map.get(column);
      if (
        openLong[column] === undefined &&
        item !== undefined &&
        item.type === undefined &&
        item.columnIndex === column &&
        item.endTime > item.startTime
      ) {
        openLong[column] = item as RizuNote;
      }
    }
  }

  const lines: Line[] = [];
  for (const time of times) {
    const map = lineMaps.get(time)!;
    const lineItems = [...map.values()].sort((a, b) => a.columnIndex - b.columnIndex);
    const line: Line = { startTime: time, items: lineItems };
    for (const item of lineItems) item.line = line;
    lines.push(line);
  }

  const compactLanes: PreprocessItem[][] = [];
  for (let column = 1; column <= columnCount; column += 1) {
    const lane = [...(lanes.get(column) ?? [])].sort(
      (a, b) => a.startTime - b.startTime || a.columnIndex - b.columnIndex,
    );
    compactLanes.push(lane);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    line.prev = lines[index - 1];
    line.next = lines[index + 1];
    line.first = lines[0];
    line.last = lines[lines.length - 1];
    line.lines = lines;

    for (let j = 0; j < line.items.length; j += 1) {
      const item = line.items[j]!;
      item.left = line.items[j - 1];
      item.right = line.items[j + 1];
      item.linePos = item.columnIndex;
      item.lanePos = index + 1;
    }
  }

  for (const lane of compactLanes) {
    for (let j = 0; j < lane.length; j += 1) {
      const item = lane[j]!;

      let bottom: PreprocessItem | undefined;
      for (let k = j - 1; k >= 0; k -= 1) {
        if (lane[k]!.type === undefined) {
          bottom = lane[k];
          break;
        }
      }
      item.bottom = bottom;

      let top: PreprocessItem | undefined;
      for (let k = j + 1; k < lane.length; k += 1) {
        if (lane[k]!.type === undefined) {
          top = lane[k];
          break;
        }
      }
      item.top = top;
    }
  }

  for (const line of lines) {
    for (const baseItem of line.items) {
      if (baseItem.note !== undefined) {
        baseItem.note.distance ??= new Map();
        baseItem.distance = baseItem.note.distance;
      }
      baseItem.distance ??= new Map();

      for (const other of line.items) {
        const trueItem = other.note ?? other;
        baseItem.distance.set(trueItem, baseItem.columnIndex - trueItem.columnIndex);
      }
    }
  }

  return { lines, lanes: compactLanes };
}
