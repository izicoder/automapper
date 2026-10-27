import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { loadStepManiaSong, parseStepManiaText } from "../src/parsers/stepmania.js";

function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/songs/${name}`, import.meta.url));
}

function times(chart: { notes: { ms: number }[] }): number[] {
  return chart.notes.map((note) => note.ms);
}

describe("StepMania song loader", () => {
  it("turns a negative offset into a positive first note time", () => {
    const outcome = loadStepManiaSong(fixture("negative-offset"));
    expect(outcome.reason).toBeUndefined();
    const song = outcome.song!;
    expect(song.metadata.title).toBe("Negative Offset");
    expect(song.metadata.artist).toBe("Fixture");
    expect(song.metadata.previewTimeMs).toBe(1500);
    expect(song.assets.audio).toBe("song.mp3");

    const chart = song.charts[0]!;
    expect(chart.keyCount).toBe(4);
    expect(chart.meta.name).toBe("Hard");
    expect(chart.meta.meter).toBe(7);
    expect(times(chart)).toEqual([500, 1500, 2500, 3500]);
  });

  it("keeps a zero offset at exactly zero", () => {
    const outcome = loadStepManiaSong(fixture("zero-offset"));
    expect(times(outcome.song!.charts[0]!)).toEqual([0, 1000, 2000, 3000]);
  });

  it("shifts a positive offset into negative time, unclamped", () => {
    const outcome = loadStepManiaSong(fixture("positive-offset"));
    expect(times(outcome.song!.charts[0]!)).toEqual([-250, 750, 1750, 2750]);
  });

  it("handles BPM changes and stops sample-accurately", () => {
    const outcome = loadStepManiaSong(fixture("bpm-change-stop"));
    const chart = outcome.song!.charts[0]!;
    expect(times(chart)).toEqual([0, 500, 1000, 1750, 2250, 4250]);
    expect(chart.timing.bpm).toHaveLength(2);
    expect(chart.timing.stops).toHaveLength(1);
  });

  it("reads note types and warns about broken note data", () => {
    const outcome = loadStepManiaSong(fixture("note-types"));
    const chart = outcome.song!.charts[0]!;

    expect(chart.notes.map((note) => [note.ms, note.column, note.kind])).toEqual([
      [0, 0, "hold"],
      [500, 1, "tap"],
      [1500, 2, "mine"],
      [2000, 3, "lift"],
      [2500, 0, "roll"],
      [3000, 0, "tap"],
      [3000, 1, "fake"],
      [4000, 3, "keysound"],
      [6000, 0, "hold"],
      [6500, 0, "hold"],
    ]);

    const hold = chart.notes[0]!;
    expect(hold.endMs).toBe(1000);
    expect(chart.notes[4]!.endMs).toBe(3500);

    const warnings = outcome.warnings;
    expect(warnings.some((line) => line.includes("overlapped an open hold"))).toBe(true);
    expect(warnings.some((line) => line.includes("hold tail without a head"))).toBe(true);
    expect(warnings.some((line) => line.includes('unknown note character "X"'))).toBe(true);
  });

  it("reads per-chart timing from an .ssc", () => {
    const outcome = loadStepManiaSong(fixture("per-chart-timing"));
    expect(outcome.warnings).toEqual([]);
    const charts = outcome.song!.charts;
    expect(charts).toHaveLength(2);

    const easy = charts[0]!;
    expect(easy.meta.name).toBe("Easy");
    expect(times(easy)).toEqual([250, 2250]);

    const hard = charts[1]!;
    expect(hard.meta.name).toBe("Hard");
    expect(hard.meta.meter).toBe(8);
    expect(times(hard)[0]).toBe(0);
    expect(times(hard)[1]).toBeCloseTo(1333.333, 3);
  });

  it("skips a song without audio", () => {
    const outcome = loadStepManiaSong(fixture("no-audio"));
    expect(outcome.song).toBeNull();
    expect(outcome.reason).toMatch(/audio/);
    expect(
      outcome.warnings.some((line) => line.includes("is missing and the folder has no audio")),
    ).toBe(true);
  });

  it("falls back to the only audio file when #MUSIC is missing", () => {
    const outcome = loadStepManiaSong(fixture("audio-fallback"));
    expect(outcome.song).not.toBeNull();
    expect(outcome.song!.assets.audio).toBe("track.ogg");
    expect(outcome.warnings.some((line) => line.includes("using the only audio file"))).toBe(true);
  });

  it("skips charts with an unknown step type", () => {
    const outcome = loadStepManiaSong(fixture("unknown-step-type"));
    expect(outcome.song).toBeNull();
    expect(outcome.warnings.some((line) => line.includes('unknown step type "made-up-type"'))).toBe(true);
  });

  it("returns a reason for a folder without chart files", () => {
    const outcome = loadStepManiaSong(fixture(""));
    expect(outcome.song).toBeNull();
    expect(outcome.reason).toBe("no .sm or .ssc chart file");
  });
});

describe(".sm and .ssc structure", () => {
  it("reads all difficulties out of one .sm", () => {
    const parsed = parseStepManiaText(
      [
        "#TITLE:T;",
        "#BPMS:0=120;",
        "#NOTES:",
        " dance-single:",
        " :",
        " Easy:",
        " 3:",
        " :",
        " data",
        "1000",
        ";",
        "#NOTES:",
        " dance-single:",
        " :",
        " Hard:",
        " 7:",
        " :",
        " data",
        "1000",
        ";",
      ].join("\n"),
    );
    expect(parsed.charts).toHaveLength(2);
    expect(parsed.charts.map((chart) => chart.difficulty)).toEqual(["Easy", "Hard"]);
    expect(parsed.charts.map((chart) => chart.meter)).toEqual([3, 7]);
    expect(parsed.charts[0]!.stepType).toBe("dance-single");
    expect(parsed.charts[0]!.noteData).toContain("1000");
  });

  it("reads the legacy six field layout", () => {
    const parsed = parseStepManiaText(
      ["#BPMS:0=120;", "#NOTES:", "dance-single:", "Hard:", "9:", "author:", "0,0:", "1000", ";"].join("\n"),
    );
    const chart = parsed.charts[0]!;
    expect(chart.difficulty).toBe("Hard");
    expect(chart.meter).toBe(9);
    expect(chart.credit).toBe("author");
  });

  it("reads the seven field layout", () => {
    const parsed = parseStepManiaText(
      [
        "#BPMS:0=120;",
        "#NOTES:",
        "dance-single:",
        "description:",
        "Challenge:",
        "12:",
        "author:",
        "0,0,0:",
        "1000",
        ";",
      ].join("\n"),
    );
    const chart = parsed.charts[0]!;
    expect(chart.difficulty).toBe("Challenge");
    expect(chart.meter).toBe(12);
    expect(chart.credit).toBe("author");
    expect(chart.stepType).toBe("dance-single");
  });
});