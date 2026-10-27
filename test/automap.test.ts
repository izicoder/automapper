import { describe, expect, it } from "vitest";

import { beat } from "../src/ir/beat.js";
import type { Chart, Note } from "../src/ir/types.js";
import { automapChart } from "../src/transform/automap.js";

/** 120 BPM test chart: one beat is 500 ms. */
function makeChart(
  keyCount: number,
  notes: { column: number; ms: number; endMs?: number }[],
): Chart {
  const converted: Note[] = notes.map((note) => ({
    column: note.column,
    beat: beat(note.ms, 500),
    ms: note.ms,
    kind: note.endMs === undefined ? "tap" : "hold",
    ...(note.endMs === undefined ? {} : { endMs: note.endMs, endBeat: beat(note.endMs, 500) }),
  }));

  return {
    keyCount,
    meta: { name: "Test", stepType: "dance-single", meter: 5 },
    timing: {
      offsetSeconds: 0,
      bpm: [{ beat: beat(0), bpm: 120 }],
      stops: [],
      delays: [],
      warps: [],
    },
    notes: converted,
    backgroundEvents: [],
    sourceText: "notes",
  };
}

function columns(chart: Chart): Set<number> {
  return new Set(chart.notes.map((note) => note.column));
}

describe("automapper, key count conversion (spec section 10)", () => {
  it("returns the chart unchanged for the identity case", () => {
    const chart = makeChart(4, [
      { column: 0, ms: 0 },
      { column: 3, ms: 500 },
    ]);
    const result = automapChart(chart, 4);

    expect(result.warnings).toEqual([]);
    expect(result.chart.keyCount).toBe(4);
    expect(result.chart.notes).toEqual(chart.notes);
  });

  it("spreads a 4K chart over 7K without inventing notes", () => {
    const chart = makeChart(4, [
      { column: 0, ms: 0 },
      { column: 1, ms: 0 },
      { column: 2, ms: 500 },
      { column: 3, ms: 1000 },
      { column: 0, ms: 1500, endMs: 2500 },
    ]);

    const result = automapChart(chart, 7);

    expect(result.chart.keyCount).toBe(7);
    expect(result.chart.notes).toHaveLength(chart.notes.length);
    expect(result.warnings).toEqual([]);

    for (const note of result.chart.notes) {
      expect(note.column).toBeGreaterThanOrEqual(0);
      expect(note.column).toBeLessThan(7);
    }

    // Absolute times survive unchanged.
    expect(result.chart.notes.map((note) => note.ms)).toEqual([0, 0, 500, 1000, 1500]);

    // The hold keeps its length.
    const hold = result.chart.notes.find((note) => note.kind === "hold")!;
    expect(hold.ms).toBe(1500);
    expect(hold.endMs).toBe(2500);
  });

  it("uses the wide field instead of leaving notes bunched up", () => {
    const chart = makeChart(4, [
      { column: 0, ms: 0 },
      { column: 1, ms: 500 },
      { column: 2, ms: 1000 },
      { column: 3, ms: 1500 },
    ]);

    const result = automapChart(chart, 7);
    expect(columns(result.chart).size).toBeGreaterThan(1);
  });

  it("fits a 7K chart into 4K without overlapping notes", () => {
    const notes = [
      { column: 0, ms: 0 },
      { column: 1, ms: 0 },
      { column: 2, ms: 0 },
      { column: 3, ms: 0 },
      { column: 4, ms: 0 },
      { column: 5, ms: 0 },
      { column: 6, ms: 0 },
      { column: 0, ms: 500 },
      { column: 1, ms: 500 },
      { column: 5, ms: 1000, endMs: 1500 },
    ];
    const chart = makeChart(7, notes);

    const result = automapChart(chart, 4);

    expect(result.chart.keyCount).toBe(4);
    expect(result.chart.notes.length).toBeGreaterThan(0);
    expect(result.chart.notes.length).toBeLessThanOrEqual(chart.notes.length);

    for (const note of result.chart.notes) {
      expect(note.column).toBeGreaterThanOrEqual(0);
      expect(note.column).toBeLessThan(4);
    }

    // No two notes in one column at the same time.
    const taken = new Set(result.chart.notes.map((note) => `${note.column}@${note.ms}`));
    expect(taken.size).toBe(result.chart.notes.length);

    // Every kept note keeps its absolute time.
    const sourceTimes = new Set(chart.notes.map((note) => note.ms));
    for (const note of result.chart.notes) expect(sourceTimes.has(note.ms)).toBe(true);

    // A chord never exceeds the target key count.
    const perTime = new Map<number, number>();
    for (const note of result.chart.notes) perTime.set(note.ms, (perTime.get(note.ms) ?? 0) + 1);
    expect(Math.max(...perTime.values())).toBeLessThanOrEqual(4);
  });

  it("keeps long notes as long notes when narrowing", () => {
    const chart = makeChart(7, [
      { column: 0, ms: 0, endMs: 1000 },
      { column: 6, ms: 0, endMs: 1000 },
      { column: 1, ms: 1500 },
      { column: 5, ms: 2000 },
    ]);

    const result = automapChart(chart, 4);
    const holds = result.chart.notes.filter((note) => note.kind === "hold");

    expect(holds.length).toBeGreaterThan(0);
    for (const hold of holds) expect(hold.endMs!).toBeGreaterThan(hold.ms);
  });

  it("reports dropped notes when it has to thin a chord", () => {
    const chart = makeChart(7, [
      { column: 0, ms: 0 },
      { column: 1, ms: 0 },
      { column: 2, ms: 0 },
      { column: 3, ms: 0 },
      { column: 4, ms: 0 },
      { column: 5, ms: 0 },
      { column: 6, ms: 0 },
      { column: 0, ms: 1000 },
      { column: 1, ms: 1000 },
      { column: 2, ms: 1000 },
      { column: 3, ms: 1000 },
      { column: 4, ms: 1000 },
      { column: 5, ms: 1000 },
      { column: 6, ms: 1000 },
    ]);

    const result = automapChart(chart, 4);

    expect(result.warnings.some((line) => line.includes("dropped"))).toBe(true);
    expect(result.chart.notes.length).toBeLessThan(chart.notes.length);
  });

  it("is deterministic", () => {
    const chart = makeChart(6, [
      { column: 0, ms: 0 },
      { column: 2, ms: 125 },
      { column: 4, ms: 250 },
      { column: 5, ms: 375 },
      { column: 1, ms: 500 },
      { column: 3, ms: 625 },
    ]);

    const first = automapChart(chart, 4).chart.notes;
    const second = automapChart(chart, 4).chart.notes;
    expect(second).toEqual(first);
  });

  it("rejects a target key count outside osu's range", () => {
    const chart = makeChart(4, [{ column: 0, ms: 0 }]);
    expect(() => automapChart(chart, 0)).toThrow(/key count/);
    expect(() => automapChart(chart, 19)).toThrow(/key count/);
  });

  it("handles every target key count from 1 to 18", () => {
    const source = makeChart(7, [
      { column: 0, ms: 0 },
      { column: 1, ms: 125 },
      { column: 2, ms: 250 },
      { column: 3, ms: 250 },
      { column: 4, ms: 375 },
      { column: 5, ms: 500 },
      { column: 6, ms: 625 },
      { column: 0, ms: 750, endMs: 1500 },
      { column: 3, ms: 875 },
      { column: 6, ms: 1000, endMs: 1750 },
      { column: 1, ms: 1250 },
      { column: 4, ms: 1375 },
    ]);

    for (let target = 1; target <= 18; target += 1) {
      if (target === source.keyCount) continue;
      const result = automapChart(source, target);

      expect(result.chart.keyCount).toBe(target);
      expect(result.chart.notes.length).toBeGreaterThan(0);

      for (const note of result.chart.notes) {
        expect(note.column).toBeGreaterThanOrEqual(0);
        expect(note.column).toBeLessThan(target);
      }

      // Times only ever come from the source.
      const sourceTimes = new Set(source.notes.map((note) => note.ms));
      for (const note of result.chart.notes) expect(sourceTimes.has(note.ms)).toBe(true);

      // No two notes share a column at the same time.
      const slots = new Set(result.chart.notes.map((note) => `${note.column}@${note.ms}`));
      expect(slots.size).toBe(result.chart.notes.length);

      // Holds stay holds.
      for (const hold of result.chart.notes.filter((note) => note.kind === "hold")) {
        expect(hold.endMs!).toBeGreaterThan(hold.ms);
      }
    }
  });

  it("converts a 7K source up to 18K and down to 1K", () => {
    const source = makeChart(7, [
      { column: 0, ms: 0 },
      { column: 3, ms: 125 },
      { column: 6, ms: 250 },
      { column: 2, ms: 375 },
      { column: 5, ms: 500, endMs: 1250 },
    ]);

    const wide = automapChart(source, 18);
    expect(wide.chart.keyCount).toBe(18);
    expect(wide.chart.notes).toHaveLength(source.notes.length);

    const narrow = automapChart(source, 1);
    expect(narrow.chart.keyCount).toBe(1);
    expect(narrow.chart.notes.every((note) => note.column === 0)).toBe(true);
    expect(narrow.chart.notes).toHaveLength(source.notes.length);
  });

  it("accepts a 1K source", () => {
    const source = makeChart(1, [
      { column: 0, ms: 0 },
      { column: 0, ms: 250 },
      { column: 0, ms: 500, endMs: 1000 },
    ]);

    for (const target of [2, 4, 7, 18]) {
      const result = automapChart(source, target);
      expect(result.chart.keyCount).toBe(target);
      expect(result.chart.notes).toHaveLength(source.notes.length);
      for (const note of result.chart.notes) {
        expect(note.column).toBeGreaterThanOrEqual(0);
        expect(note.column).toBeLessThan(target);
      }
    }
  });
});
