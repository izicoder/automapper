import { describe, expect, it } from "vitest";

import { beat } from "../src/ir/beat.js";
import { parseNoteData } from "../src/parsers/steps.js";

describe("StepMania note data", () => {
  it("places rows on exact beats", () => {
    const { notes } = parseNoteData("1000\n0001\n,\n1000\n", 4);
    expect(notes.map((note) => [note.beat.n / note.beat.d, note.column])).toEqual([
      [0, 0],
      [2, 3],
      [4, 0],
    ]);
  });

  it("subdivides a measure by its row count", () => {
    const { notes } = parseNoteData("1\n1\n0\n0\n1\n0\n0\n0\n", 1);
    expect(notes.map((note) => note.beat.n / note.beat.d)).toEqual([0, 0.5, 2]);
  });

  it("reads holds and rolls with their length", () => {
    const { notes } = parseNoteData("2000\n0000\n0000\n3000\n,\n4000\n0000\n0000\n3000\n", 4);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ kind: "hold", lengthBeats: beat(3) });
    expect(notes[1]).toMatchObject({ kind: "roll", lengthBeats: beat(3) });
  });

  it("maps mine, fake, lift and keysound characters", () => {
    const { notes } = parseNoteData("M000\n0F00\n00L0\n000K\n", 4);
    expect(notes.map((note) => note.kind)).toEqual(["mine", "fake", "lift", "keysound"]);
  });

  it("warns on a tail without a head", () => {
    const { notes, warnings } = parseNoteData("0000\n0003\n", 4);
    expect(notes).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("hold tail without a head");
  });

  it("warns and closes a hold when a new head arrives", () => {
    const { notes, warnings } = parseNoteData("2000\n2000\n3000\n0000\n", 4);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("overlapped an open hold");
    expect(notes.map((note) => [note.beat.n, note.lengthBeats.n])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("turns a hold closed by the end of the chart into a hold to the last row", () => {
    const { notes, warnings } = parseNoteData("2000\n0000\n", 4);
    expect(warnings[0]).toContain("was never closed");
    expect(notes[0]!.lengthBeats.n).toBeGreaterThan(0);
  });

  it("warns on unknown characters and wrong column counts", () => {
    const { warnings } = parseNoteData("10000\n00X0\n", 4);
    expect(warnings.some((line) => line.includes("expected 4 columns"))).toBe(true);
    expect(warnings.some((line) => line.includes('unknown note character "X"'))).toBe(true);
  });

  it("ignores comments and empty rows", () => {
    const { notes, warnings } = parseNoteData("// comment\n1000\n\n0000\n", 4);
    expect(notes).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });
});