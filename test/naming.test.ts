import { describe, expect, it } from "vitest";

import type { Chart, Song } from "../src/ir/types.js";
import { chartSettingsHash, setFileName, setSettingsHash } from "../src/osu/naming.js";
import { loadStepManiaSong } from "../src/parsers/stepmania.js";
import { songFixture } from "./osu-format.js";

function load(name: string): { song: Song; chart: Chart } {
  const song = loadStepManiaSong(songFixture(name)).song!;
  return { song, chart: song.charts[0]! };
}

describe("naming and collision avoidance (spec section 7)", () => {
  it("produces a six hex character hash", () => {
    const { song, chart } = load("negative-offset");
    const hash = chartSettingsHash(song, chart, { seed: 0 });
    expect(hash).toMatch(/^[0-9a-f]{6}$/);
  });

  it("is deterministic for the same source and settings", () => {
    const first = load("negative-offset");
    const second = load("negative-offset");
    const settings = { keys: [4], seed: 0 };

    expect(chartSettingsHash(first.song, first.chart, settings)).toBe(
      chartSettingsHash(second.song, second.chart, settings),
    );
    expect(setSettingsHash(first.song, settings)).toBe(setSettingsHash(second.song, settings));
  });

  it("changes when the settings change", () => {
    const { song, chart } = load("negative-offset");
    expect(chartSettingsHash(song, chart, { seed: 0 })).not.toBe(chartSettingsHash(song, chart, { seed: 1 }));
    expect(setSettingsHash(song, { keys: [] })).not.toBe(setSettingsHash(song, { keys: [7] }));
  });

  it("changes when the source chart changes", () => {
    const before = load("negative-offset");
    const after = load("note-types");
    const settings = { seed: 0 };
    expect(chartSettingsHash(before.song, before.chart, settings)).not.toBe(
      chartSettingsHash(after.song, after.chart, settings),
    );
  });

  it("builds an osz file name with the artist, title and hash", () => {
    const { song } = load("negative-offset");
    expect(setFileName(song, "a1b2c3")).toBe("Fixture - Negative Offset [a1b2c3].osz");
  });

  it("strips characters that are illegal in file names", () => {
    const { song } = load("negative-offset");
    song.metadata.artist = 'A/B:C*D?E"F<G>H|I';
    song.metadata.title = "Nice: Song";
    expect(setFileName(song, "a1b2c3")).toBe("ABCDEFGHI - Nice Song [a1b2c3].osz");
  });

  it("strips control characters but keeps spaces and dashes", () => {
    const { song } = load("negative-offset");
    song.metadata.title = "Nice\u0001 Song";
    expect(setFileName(song, "a1b2c3")).toBe("Fixture - Nice Song [a1b2c3].osz");
  });

  it("falls back to untitled when artist and title are empty", () => {
    const { song } = load("negative-offset");
    song.metadata.artist = "";
    song.metadata.title = "";
    expect(setFileName(song, "a1b2c3")).toBe("untitled [a1b2c3].osz");
  });
});