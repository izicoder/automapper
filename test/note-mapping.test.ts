import { describe, expect, it } from "vitest";

import type { Note } from "../src/ir/types.js";
import { DEFAULT_MAP_OPTIONS, mapNotes } from "../src/osu/note-mapping.js";

function note(partial: Partial<Note> & { column: number; ms: number }): Note {
  return { beat: { n: 0, d: 1 }, kind: "tap", ...partial };
}

describe("note mapping (spec section 8)", () => {
  it("drops mines and fakes, turns lifts and keysounds into taps", () => {
    const { notes, warnings } = mapNotes([
      note({ column: 0, ms: 0, kind: "tap" }),
      note({ column: 1, ms: 500, kind: "mine" }),
      note({ column: 2, ms: 1000, kind: "fake" }),
      note({ column: 3, ms: 1500, kind: "lift" }),
      note({ column: 0, ms: 2000, kind: "keysound" }),
    ]);

    expect(notes.map((mapped) => [mapped.startMs, mapped.column, mapped.endMs])).toEqual([
      [0, 0, undefined],
      [1500, 3, undefined],
      [2000, 0, undefined],
    ]);
    expect(warnings).toEqual([]);
  });

  it("keeps holds and rolls as long notes with their duration", () => {
    const { notes } = mapNotes([
      note({ column: 0, ms: 0, endMs: 1000, kind: "hold", beat: { n: 0, d: 1 }, endBeat: { n: 2, d: 1 } }),
      note({ column: 1, ms: 2000, endMs: 3500, kind: "roll", beat: { n: 4, d: 1 }, endBeat: { n: 7, d: 1 } }),
    ]);

    expect(notes).toEqual([
      { column: 0, startMs: 0, endMs: 1000 },
      { column: 1, startMs: 2000, endMs: 3500 },
    ]);
  });

  it("turns a zero length or too short hold into a tap with a warning", () => {
    const zero = mapNotes([note({ column: 0, ms: 500, endMs: 500, kind: "hold" })]);
    expect(zero.notes).toEqual([{ column: 0, startMs: 500 }]);
    expect(zero.warnings[0]).toContain("became a tap");

    const short = mapNotes(
      [note({ column: 0, ms: 0, endMs: 10, kind: "hold", beat: { n: 0, d: 1 }, endBeat: { n: 1, d: 64 } })],
      { minHoldBeats: 1 / 32 },
    );
    expect(short.notes).toEqual([{ column: 0, startMs: 0 }]);
    expect(short.warnings).toHaveLength(1);
  });

  it("keeps a hold longer than the minimum when the option allows it", () => {
    const { notes } = mapNotes(
      [note({ column: 0, ms: 0, endMs: 10, kind: "hold", beat: { n: 0, d: 1 }, endBeat: { n: 1, d: 64 } })],
      { minHoldBeats: 1 / 64 },
    );
    expect(notes).toEqual([{ column: 0, startMs: 0, endMs: 10 }]);
  });

  it("trims overlapping holds in the same column", () => {
    const { notes, warnings } = mapNotes([
      note({ column: 0, ms: 0, endMs: 1000, kind: "hold" }),
      note({ column: 0, ms: 500, endMs: 2000, kind: "hold" }),
    ]);

    expect(notes).toEqual([
      { column: 0, startMs: 0, endMs: 1000 },
      { column: 0, startMs: 1000, endMs: 2000 },
    ]);
    expect(warnings.some((line) => line.includes("trimmed"))).toBe(true);
  });

  it("moves a tap inside an open hold to the release point", () => {
    const inside = mapNotes([
      note({ column: 0, ms: 0, endMs: 1000, kind: "hold" }),
      note({ column: 0, ms: 500, kind: "tap" }),
    ]);

    expect(inside.notes).toEqual([
      { column: 0, startMs: 0, endMs: 1000 },
      { column: 0, startMs: 1000 },
    ]);
    expect(inside.warnings.some((line) => line.includes("was moved"))).toBe(true);

    // A tap within 1 ms of the release is the release: it disappears.
    const atRelease = mapNotes([
      note({ column: 0, ms: 0, endMs: 1000, kind: "hold" }),
      note({ column: 0, ms: 999.5, kind: "tap" }),
    ]);
    expect(atRelease.notes).toEqual([{ column: 0, startMs: 0, endMs: 1000 }]);
  });

  it("sorts the result by time then column", () => {
    const { notes } = mapNotes([
      note({ column: 3, ms: 1000 }),
      note({ column: 1, ms: 1000 }),
      note({ column: 0, ms: 0 }),
    ]);

    expect(notes.map((mapped) => [mapped.startMs, mapped.column])).toEqual([
      [0, 0],
      [1000, 1],
      [1000, 3],
    ]);
  });

  it("has a documented default minimum hold length", () => {
    expect(DEFAULT_MAP_OPTIONS.minHoldBeats).toBe(1 / 32);
  });
});
