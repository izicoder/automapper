import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { buildCharts, main, run } from "../src/cli/index.js";
import { DEFAULT_OPTIONS } from "../src/cli/options.js";
import { beat } from "../src/ir/beat.js";
import type { Chart, Song } from "../src/ir/types.js";
import { createTestLogger } from "../src/log.js";
import { packFixture, songFixture } from "./osu-format.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = tempDir(prefix);
  created.push(dir);
  return dir;
}

function setupPack(): { input: string; output: string } {
  const root = scratch("cli-pack-");
  const input = join(root, "INPUT");
  const output = join(root, "OUTPUT");
  mkdirSync(input, { recursive: true });
  cpSync(packFixture("demo-pack"), join(input, "Demo Pack"), { recursive: true });
  return { input, output };
}

/** Builds a .zip whose entries are `folder/<files of the fixture>`. */
function zipFixtureSong(zipPath: string, folder: string, fixture: string): void {
  const entries: Record<string, Uint8Array> = {};
  for (const name of readdirSync(songFixture(fixture))) {
    entries[`${folder}/${name}`] = readFileSync(join(songFixture(fixture), name));
  }
  writeFileSync(zipPath, zipSync(entries));
}

function outputFiles(outputDir: string): string[] {
  return readdirSync(outputDir)
    .filter((name) => name !== ".archive-state.json")
    .sort();
}

describe("CLI end to end (spec sections 5, 7 and 11)", () => {
  it("converts a pack and skips the broken song without aborting it", () => {
    const dirs = setupPack();
    const { logger, lines } = createTestLogger();

    const result = run([], logger, dirs);

    expect(result).toEqual({ converted: 2, failed: 2 });

    const files = readdirSync(join(dirs.output, "Demo Pack")).sort();
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toMatch(/^Same Artist - Same Song \[[0-9a-f]{6}\]\.osz$/);
    }
    expect(new Set(files).size).toBe(2); // same title/artist must not collide

    expect(lines.filter((line) => line.includes("skipped:")).length).toBe(2);
    expect(lines.some((line) => line.includes("2 songs converted, 2 skipped"))).toBe(true);

    // A broken chart (bad encoding) and a missing audio file are both skipped.
    expect(lines.some((line) => line.includes("no usable chart"))).toBe(true);
    expect(lines.some((line) => line.includes("no usable audio"))).toBe(true);
  });

  it("exits with a failure code when any song was skipped", () => {
    const dirs = setupPack();
    expect(main([], createTestLogger().logger, dirs)).toBe(1);
  });

  it("exits cleanly when everything converted", () => {
    const root = scratch("cli-clean-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });
    cpSync(songFixture("zero-offset"), join(input, "Zero Offset"), { recursive: true });

    expect(main([], createTestLogger().logger, { input, output })).toBe(0);
  });

  it("converts a loose chart file in INPUT/ as a one-file song", () => {
    const root = scratch("cli-loose-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });
    copyFileSync(join(songFixture("zero-offset"), "song.sm"), join(input, "loose.sm"));
    copyFileSync(join(songFixture("zero-offset"), "song.mp3"), join(input, "song.mp3"));

    expect(run([], createTestLogger().logger, { input, output })).toEqual({
      converted: 1,
      failed: 0,
    });

    const files = readdirSync(output);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^Fixture - Zero Offset \[[0-9a-f]{6}\]\.osz$/);
  });

  it("uses --assume-keys for a chart with an unknown step type", () => {
    const root = scratch("cli-unknown-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });
    cpSync(songFixture("unknown-step-type"), join(input, "Strange"), { recursive: true });

    expect(run([], createTestLogger().logger, { input, output })).toEqual({
      converted: 0,
      failed: 1,
    });

    const forced = run(["--assume-keys", "4"], createTestLogger().logger, { input, output });
    expect(forced).toEqual({ converted: 1, failed: 0 });
    expect(readdirSync(output)).toHaveLength(1);
  });

  it("produces identical files on a second run", () => {
    const dirs = setupPack();
    const first = run([], createTestLogger().logger, dirs);
    const before = readdirSync(join(dirs.output, "Demo Pack"))
      .sort()
      .map((file) => readFileSync(join(dirs.output, "Demo Pack", file)));

    const second = run([], createTestLogger().logger, dirs);
    const after = readdirSync(join(dirs.output, "Demo Pack"))
      .sort()
      .map((file) => readFileSync(join(dirs.output, "Demo Pack", file)));

    expect(second).toEqual(first);
    expect(after).toHaveLength(before.length);
    after.forEach((content, index) => expect(content.equals(before[index]!)).toBe(true));
  });

  it("rejects an unknown option with the usage text", () => {
    const dirs = setupPack();
    const { logger, lines } = createTestLogger();

    expect(run(["--nope"], logger, dirs)).toEqual({ converted: 0, failed: 1 });
    expect(lines.some((line) => line.includes('unknown option "--nope"'))).toBe(true);
    expect(lines.some((line) => line.includes("Usage:"))).toBe(true);
  });

  it("prints help and touches nothing", () => {
    const dirs = setupPack();
    const { logger, lines } = createTestLogger();

    expect(run(["--help"], logger, dirs)).toEqual({ converted: 0, failed: 0 });
    expect(lines.some((line) => line.includes("Everything in INPUT/"))).toBe(true);
  });

  it("adds automapped difficulties across the whole key range", () => {
    const dirs = setupPack();
    const { logger } = createTestLogger();

    expect(run(["--keys", "1,2,10,18"], logger, dirs)).toEqual({ converted: 2, failed: 2 });

    const files = readdirSync(join(dirs.output, "Demo Pack")).sort();
    const archive = unzipSync(readFileSync(join(dirs.output, "Demo Pack", files[0]!)));
    const beatmaps = Object.keys(archive).filter((name) => name.endsWith(".osu"));

    expect(beatmaps).toHaveLength(5);
    for (const keys of ["4K ", "1K ", "2K ", "10K ", "18K "]) {
      expect(beatmaps.some((name) => name.startsWith(keys))).toBe(true);
    }
  });

  it("reads a 7K source and automaps it to 4K", () => {
    const root = scratch("cli-7k-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });
    cpSync(songFixture("seven-keys"), join(input, "Seven Keys"), { recursive: true });

    expect(run(["--keys", "4"], createTestLogger().logger, { input, output })).toEqual({
      converted: 1,
      failed: 0,
    });

    const files = readdirSync(output);
    expect(files).toHaveLength(1);
    const archive = unzipSync(readFileSync(join(output, files[0]!)));
    const beatmaps = Object.keys(archive).filter((name) => name.endsWith(".osu")).sort();

    expect(beatmaps).toHaveLength(2);
    expect(beatmaps[0]!.startsWith("4K ")).toBe(true);
    expect(beatmaps[1]!.startsWith("7K ")).toBe(true);
  });

  it("does not duplicate the source difficulty for its own key count", () => {
    const dirs = setupPack();
    run(["--keys", "4"], createTestLogger().logger, dirs);

    const files = readdirSync(join(dirs.output, "Demo Pack")).sort();
    const archive = unzipSync(readFileSync(join(dirs.output, "Demo Pack", files[0]!)));
    expect(Object.keys(archive).filter((name) => name.endsWith(".osu"))).toHaveLength(1);
  });

  it("rejects an illegal key count before converting anything", () => {
    const dirs = setupPack();
    const { logger, lines } = createTestLogger();

    expect(run(["--keys", "19"], logger, dirs)).toEqual({ converted: 0, failed: 1 });
    expect(lines.some((line) => line.includes("1 to 18"))).toBe(true);
    expect(existsSync(dirs.output)).toBe(false);
  });

  it("accepts a source chart wider than osu!mania and maps it to 18K", () => {
    const notes = Array.from({ length: 20 }, (_, column) => ({
      column,
      beat: beat(column),
      ms: column * 100,
      kind: "tap" as const,
    }));
    const wide: Chart = {
      keyCount: 20,
      meta: { name: "Wide", stepType: "made-up", meter: 1 },
      timing: {
        offsetSeconds: 0,
        bpm: [{ beat: beat(0), bpm: 120 }],
        stops: [],
        delays: [],
        warps: [],
      },
      notes,
      backgroundEvents: [],
      sourceText: "wide",
    };
    const song: Song = {
      folderName: "wide",
      directory: "wide",
      metadata: { title: "Wide", artist: "Fixture", tags: [], previewTimeMs: null },
      assets: { audio: "song.mp3" },
      charts: [wide],
      warnings: [],
    };

    const { logger, lines } = createTestLogger();
    const charts = buildCharts(song, { ...DEFAULT_OPTIONS, keys: [] }, logger, "wide");

    expect(charts).toHaveLength(1);
    expect(charts[0]!.keyCount).toBe(18);
    expect(lines.some((line) => line.includes("20K is not an osu!mania key count, mapped to 18K"))).toBe(
      true,
    );
  });
});

describe("archives dropped into INPUT/ (spec section 5)", () => {
  function setupArchive(fixture = "zero-offset"): { input: string; output: string; zip: string } {
    const root = scratch("cli-zip-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });
    const zip = join(input, "song.zip");
    zipFixtureSong(zip, "Zero Offset", fixture);
    return { input, output, zip };
  }

  it("unpacks a single-song archive and writes one .osz", () => {
    const dirs = setupArchive();
    const { logger, lines } = createTestLogger();

    expect(run([], logger, dirs)).toEqual({ converted: 1, failed: 0 });

    expect(outputFiles(dirs.output)).toHaveLength(1);
    expect(outputFiles(dirs.output)[0]).toMatch(/^Fixture - Zero Offset \[[0-9a-f]{6}\]\.osz$/);
    expect(lines.some((line) => line.includes("unpacking archive"))).toBe(true);
    expect(lines.some((line) => line.includes("nested archive"))).toBe(false);
    expect(existsSync(join(dirs.output, ".archive-state.json"))).toBe(true);
  });

  it("does not unpack the same archive twice", () => {
    const dirs = setupArchive();
    const first = run([], createTestLogger().logger, dirs);
    expect(first).toEqual({ converted: 1, failed: 0 });

    const { logger, lines } = createTestLogger();
    const second = run([], logger, dirs);

    expect(second).toEqual({ converted: 0, failed: 0 });
    expect(lines.some((line) => line.includes("already converted"))).toBe(true);
    expect(outputFiles(dirs.output)).toHaveLength(1);
  });

  it("unpacks only the archives that are new", () => {
    const dirs = setupArchive();
    run([], createTestLogger().logger, dirs);

    zipFixtureSong(join(dirs.input, "second.zip"), "Positive Offset", "positive-offset");
    const { logger, lines } = createTestLogger();
    expect(run([], logger, dirs)).toEqual({ converted: 1, failed: 0 });

    expect(lines.filter((line) => line.includes("unpacking archive"))).toHaveLength(1);
    expect(lines.some((line) => line.includes("already converted"))).toBe(true);
    expect(outputFiles(dirs.output)).toHaveLength(2);
  });

  it("unpacks an archive again after it was replaced", () => {
    const dirs = setupArchive();
    run([], createTestLogger().logger, dirs);

    // Same file name, different content and size -> new stamp.
    zipFixtureSong(dirs.zip, "Negative Offset", "negative-offset");
    expect(run([], createTestLogger().logger, dirs)).toEqual({ converted: 1, failed: 0 });
  });

  it("unpacks an archive again when the settings change", () => {
    const dirs = setupArchive();
    run(["--seed", "0"], createTestLogger().logger, dirs);

    expect(run(["--seed", "1"], createTestLogger().logger, dirs)).toEqual({
      converted: 1,
      failed: 0,
    });
    // Different settings produce a different name, so both results stay.
    expect(outputFiles(dirs.output)).toHaveLength(2);
  });

  it("re-unpacks on --force", () => {
    const dirs = setupArchive();
    run([], createTestLogger().logger, dirs);

    const { logger, lines } = createTestLogger();
    expect(run(["--force"], logger, dirs)).toEqual({ converted: 1, failed: 0 });
    expect(lines.some((line) => line.includes("unpacking archive"))).toBe(true);
  });

  it("converts song folders at the archive root like song folders in INPUT/", () => {
    const root = scratch("cli-zip-pack-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });

    const entries: Record<string, Uint8Array> = {};
    for (const fixture of ["zero-offset", "positive-offset"]) {
      const folder = fixture === "zero-offset" ? "Song A" : "Song B";
      for (const name of readdirSync(songFixture(fixture))) {
        entries[`${folder}/${name}`] = readFileSync(join(songFixture(fixture), name));
      }
    }
    writeFileSync(join(input, "My Pack.zip"), zipSync(entries));

    expect(run([], createTestLogger().logger, { input, output })).toEqual({
      converted: 2,
      failed: 0,
    });

    // Same rule as folders directly in INPUT/: these are two songs.
    expect(outputFiles(output)).toHaveLength(2);
  });

  it("keeps a pack folder from inside the archive", () => {
    const root = scratch("cli-zip-wrapped-");
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });

    const entries: Record<string, Uint8Array> = {};
    for (const fixture of ["zero-offset", "positive-offset"]) {
      const folder = fixture === "zero-offset" ? "Song A" : "Song B";
      for (const name of readdirSync(songFixture(fixture))) {
        entries[`My Pack/${folder}/${name}`] = readFileSync(join(songFixture(fixture), name));
      }
    }
    writeFileSync(join(input, "collection.zip"), zipSync(entries));

    expect(run([], createTestLogger().logger, { input, output })).toEqual({
      converted: 2,
      failed: 0,
    });

    expect(readdirSync(output)).toContain("My Pack");
    expect(readdirSync(join(output, "My Pack"))).toHaveLength(2);
  });

  it("reports a broken archive without stopping the rest", () => {
    const dirs = setupArchive();
    writeFileSync(join(dirs.input, "broken.zip"), "this is not a zip");
    const { logger, lines } = createTestLogger();

    expect(run([], logger, dirs)).toEqual({ converted: 1, failed: 1 });
    expect(lines.some((line) => line.includes("archive failed"))).toBe(true);
  });
});

