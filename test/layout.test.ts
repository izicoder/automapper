import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { discover } from "../src/package/layout.js";
import { packFixture, songFixture } from "./osu-format.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir("layout-");
  created.push(dir);
  return dir;
}

function copySong(fixture: string, inputDir: string, folder: string): void {
  const target = join(inputDir, folder);
  mkdirSync(target, { recursive: true });
  copyFileSync(join(songFixture(fixture), "song.sm"), join(target, "song.sm"));
  copyFileSync(join(songFixture(fixture), "song.mp3"), join(target, "song.mp3"));
}

describe("INPUT discovery (spec section 5)", () => {
  it("recognises a song folder, a pack, loose files and junk", () => {
    const input = scratch();
    copySong("zero-offset", input, "Song A");
    writeFileSync(join(input, "loose.sm"), "#TITLE:x;");
    writeFileSync(join(input, "notes.txt"), "ignore me");

    const discovery = discover(input);

    expect(discovery.songs.map((song) => song.label)).toEqual(["Song A"]);
    expect(discovery.songs[0]!.directory).toBe(join(input, "Song A"));
    expect(discovery.packs).toEqual([]);
    expect(discovery.loose).toEqual([join(input, "loose.sm")]);
    expect(discovery.skipped).toEqual([join(input, "notes.txt")]);
  });

  it("recognises a folder of song folders as a pack", () => {
    const input = scratch();
    copySong("zero-offset", join(input, "PackX"), "Song 1");
    copySong("positive-offset", join(input, "PackX"), "Song 2");

    const discovery = discover(input);

    expect(discovery.songs).toEqual([]);
    expect(discovery.packs).toHaveLength(1);
    expect(discovery.packs[0]!.label).toBe("PackX");
    expect(discovery.packs[0]!.songs.map((song) => song.label)).toEqual(["Song 1", "Song 2"]);
  });

  it("finds the committed demo pack", () => {
    const discovery = discover(packFixture(""));

    expect(discovery.packs.map((pack) => pack.label)).toEqual(["demo-pack"]);
    expect(discovery.packs[0]!.songs.map((song) => song.label)).toEqual([
      "broken",
      "same-title-a",
      "same-title-b",
    ]);
  });

  it("does not throw when INPUT/ is missing", () => {
    const discovery = discover(join(scratch(), "does-not-exist"));
    expect(discovery).toEqual({ songs: [], packs: [], loose: [], skipped: [] });
  });
});
