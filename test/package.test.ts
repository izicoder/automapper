import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { setFileName, setSettingsHash } from "../src/osu/naming.js";
import { packageSong } from "../src/package/osz.js";
import { loadStepManiaSong } from "../src/parsers/stepmania.js";
import { parseOsu, songFixture } from "./osu-format.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir();
  created.push(dir);
  return dir;
}

describe("osz packaging (spec sections 5 and 7)", () => {
  it("puts the audio and one .osu per chart into the archive", () => {
    const song = loadStepManiaSong(songFixture("per-chart-timing")).song!;
    const outputPath = join(scratch(), "song.osz");

    const result = packageSong(song, {
      versionHash: "a1b2c3",
      creator: "tester",
      audioFileName: song.assets.audio,
      minHoldBeats: 1 / 32,
      outputPath,
    });

    expect(result.versions).toEqual(["4K Easy #a1b2c3", "4K Hard #a1b2c3"]);

    const files = Object.keys(unzipSync(readFileSync(outputPath))).sort();
    expect(files).toEqual(["4K Easy #a1b2c3.osu", "4K Hard #a1b2c3.osu", "song.mp3"]);
  });

  it("writes a beatmap that parses back with the right notes", () => {
    const song = loadStepManiaSong(songFixture("negative-offset")).song!;
    const outputPath = join(scratch(), "song.osz");

    packageSong(song, {
      versionHash: "a1b2c3",
      creator: "tester",
      audioFileName: song.assets.audio,
      minHoldBeats: 1 / 32,
      outputPath,
    });

    const archive = unzipSync(readFileSync(outputPath));
    const text = new TextDecoder().decode(archive["4K Hard #a1b2c3.osu"]!);
    const parsed = parseOsu(text);
    expect(parsed.hitObjects.map((object) => object.time)).toEqual([500, 1500, 2500, 3500]);
  });

  it("is byte identical when the same song is converted twice", () => {
    const song = loadStepManiaSong(songFixture("negative-offset")).song!;
    const first = join(scratch(), "first.osz");
    const second = join(scratch(), "second.osz");
    const options = {
      versionHash: "a1b2c3",
      creator: "tester",
      audioFileName: song.assets.audio,
      minHoldBeats: 1 / 32,
    };

    packageSong(song, { ...options, outputPath: first });
    packageSong(song, { ...options, outputPath: second });

    expect(readFileSync(first).equals(readFileSync(second))).toBe(true);
  });

  it("gives different settings a different file name", () => {
    const song = loadStepManiaSong(songFixture("negative-offset")).song!;
    const base = setFileName(song, setSettingsHash(song, { seed: 0 }));
    const other = setFileName(song, setSettingsHash(song, { seed: 1 }));

    expect(base).not.toBe(other);
    expect(base).toMatch(/^Fixture - Negative Offset \[[0-9a-f]{6}\]\.osz$/);
  });
});
