import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { runJobs, selectJobs } from "../src/cli/jobs.js";
import { parseArgs, DEFAULT_OPTIONS } from "../src/cli/options.js";
import { run } from "../src/cli/index.js";
import { createTestLogger } from "../src/log.js";
import { scan } from "../src/ui/scan.js";
import { songFixture } from "./osu-format.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir("ui-scan-");
  created.push(dir);
  return dir;
}

function setup(): { input: string; output: string; stage: string; root: string } {
  const root = scratch();
  const input = join(root, "INPUT");
  const output = join(root, "OUTPUT");
  const stage = join(root, "stage");
  mkdirSync(input, { recursive: true });
  mkdirSync(output, { recursive: true });
  mkdirSync(stage, { recursive: true });
  return { input, output, stage, root };
}

/** Copies a song fixture into a folder, like a drop would. */
function dropSong(stage: string, folder: string, fixture: string): void {
  cpSync(songFixture(fixture), join(stage, folder), { recursive: true });
}

/** One song fixture as zip entries under `prefix` (a folder, or "" for the root). */
function zipSong(prefix: string, fixture: string): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  for (const name of readdirSync(songFixture(fixture))) {
    const entry = prefix.length > 0 ? `${prefix}/${name}` : name;
    entries[entry] = readFileSync(join(songFixture(fixture), name));
  }
  return entries;
}

function listScan(input: string, output: string, stageDir: string | null, argv: string[] = []) {
  return scan({ inputDir: input, outputDir: output, stageDir, options: parseArgs(argv) });
}

describe("discovery for the UI (spec section 7)", () => {
  it("lists INPUT/ songs with their charts and key counts", () => {
    const dirs = setup();
    cpSync(songFixture("seven-keys"), join(dirs.input, "Seven Keys"), { recursive: true });

    const { result } = listScan(dirs.input, dirs.output, null);

    expect(result.songs).toHaveLength(1);
    const song = result.songs[0]!;
    expect(song.origin).toBe("input");
    expect(song.label).toBe("Seven Keys");
    expect(song.charts).toHaveLength(1);
    expect(song.charts[0]!.keyCount).toBe(7);
    expect(song.charts[0]!.notes).toBeGreaterThan(0);
    expect(song.converted).toBe(false);
    expect(result.total).toBe(1);
  });

  it("adds dropped songs next to the ones from INPUT/", () => {
    const dirs = setup();
    cpSync(songFixture("zero-offset"), join(dirs.input, "In Input"), { recursive: true });
    dropSong(dirs.stage, "Dropped", "positive-offset");

    const { result } = listScan(dirs.input, dirs.output, dirs.stage);

    expect(result.songs.map((song) => `${song.origin}|${song.label}`)).toEqual([
      "input|In Input",
      "drop|Dropped",
    ]);
  });

  it("groups pack songs and keeps the pack name", () => {
    const dirs = setup();
    const pack = join(dirs.input, "Demo Pack");
    mkdirSync(pack, { recursive: true });
    cpSync(songFixture("zero-offset"), join(pack, "Song A"), { recursive: true });

    const { result } = listScan(dirs.input, dirs.output, null);

    expect(result.songs[0]!.pack).toBe("Demo Pack");
    expect(result.songs[0]!.kind).toBe("pack-song");
  });

  it("marks a song already in OUTPUT/ by its content hash", () => {
    const dirs = setup();
    cpSync(songFixture("zero-offset"), join(dirs.input, "Zero Offset"), { recursive: true });

    // Same hash code as the writer: converting with the same options must
    // produce the name the scan looked for.
    run([], createTestLogger().logger, { input: dirs.input, output: dirs.output });

    const { result } = listScan(dirs.input, dirs.output, null);
    const song = result.songs[0]!;

    expect(song.converted).toBe(true);
    expect(readdirSync(dirs.output)).toContain(song.expectedOsz);
  });

  it("marks a song as new again when the options change the output", () => {
    const dirs = setup();
    cpSync(songFixture("zero-offset"), join(dirs.input, "Zero Offset"), { recursive: true });
    run([], createTestLogger().logger, { input: dirs.input, output: dirs.output });

    expect(listScan(dirs.input, dirs.output, null, ["--keys", "4"]).result.songs[0]!.converted).toBe(
      false,
    );
  });

  it("marks an archive as already unpacked only with the same settings", () => {
    const dirs = setup();
    writeFileSync(join(dirs.input, "pack.zip"), zipSync(zipSong("Song", "zero-offset")));

    const before = listScan(dirs.input, dirs.output, null).result;
    expect(before.archives).toHaveLength(1);
    expect(before.archives[0]!.converted).toBe(false);

    run([], createTestLogger().logger, { input: dirs.input, output: dirs.output });

    expect(listScan(dirs.input, dirs.output, null).result.archives[0]!.converted).toBe(true);
    expect(listScan(dirs.input, dirs.output, null, ["--seed", "1"]).result.archives[0]!.converted).toBe(
      false,
    );
  });

  it("keeps a song that cannot convert in the list with its reason", () => {
    const dirs = setup();
    cpSync(songFixture("unknown-step-type"), join(dirs.input, "Strange"), { recursive: true });

    const { result } = listScan(dirs.input, dirs.output, null);

    expect(result.songs[0]!.error).toBeDefined();
    expect(result.songs[0]!.charts).toHaveLength(0);
  });

  it("reports files it cannot use instead of silently dropping them", () => {
    const dirs = setup();
    writeFileSync(join(dirs.input, "notes.txt"), "hello");

    const { result } = listScan(dirs.input, dirs.output, null);

    expect(result.ignored.some((item) => item.label === "notes.txt")).toBe(true);
  });

  it("hands the UI one job per song plus one per archive", () => {
    const dirs = setup();
    cpSync(songFixture("zero-offset"), join(dirs.input, "Song"), { recursive: true });
    dropSong(dirs.stage, "Dropped", "positive-offset");

    const { jobs } = listScan(dirs.input, dirs.output, dirs.stage);

    expect(jobs.map((job) => job.kind)).toEqual(["song", "song"]);
    expect(jobs[1]!.id.startsWith(dirs.stage)).toBe(true);
  });

  it("uses the same defaults as the CLI for the options it is given", () => {
    const dirs = setup();
    expect(listScan(dirs.input, dirs.output, null).result.songs).toHaveLength(0);
    expect(parseArgs([])).toEqual({ ...DEFAULT_OPTIONS, keys: [] });
  });
});

describe("songs inside an archive (spec section 7)", () => {
  it("lists them under their archive without unpacking it", () => {
    const dirs = setup();
    writeFileSync(
      join(dirs.input, "collection.zip"),
      zipSync({
        ...zipSong("Pack/One", "zero-offset"),
        ...zipSong("Pack/Two", "seven-keys"),
        ...zipSong("Lonely", "positive-offset"),
      }),
    );

    const { result } = listScan(dirs.input, dirs.output, null);

    expect(result.archives).toHaveLength(1);
    expect(result.archives[0]!.songCount).toBe(3);
    expect(readdirSync(dirs.input)).toEqual(["collection.zip"]);

    const archive = result.archives[0]!;
    const songs = result.songs.filter((song) => song.archive === archive.id);
    expect(songs.map((song) => `${song.pack ?? "-"}|${song.label}`)).toEqual([
      "Pack|One",
      "Pack|Two",
      "-|Lonely",
    ]);
    expect(songs[0]!.id).toBe(`${archive.id}::Pack/One`);
    expect(songs[0]!.charts[0]!.keyCount).toBe(4);
    expect(songs[1]!.charts[0]!.keyCount).toBe(7);
    expect(songs[0]!.expectedOsz).toMatch(/\.osz$/);
    expect(songs[0]!.converted).toBe(false);
  });

  it("marks a listed archive song as in OUTPUT/ once it is converted", () => {
    const dirs = setup();
    writeFileSync(join(dirs.input, "pack.zip"), zipSync(zipSong("Pack/One", "zero-offset")));
    const before = listScan(dirs.input, dirs.output, null).result;
    const innerId = before.songs[0]!.id;

    const { jobs } = listScan(dirs.input, dirs.output, null);
    const logger = createTestLogger();
    runJobs(selectJobs(jobs, [innerId]), parseArgs([]), dirs, logger.logger);

    const after = listScan(dirs.input, dirs.output, null).result;
    expect(after.songs[0]!.converted).toBe(true);
    expect(after.archives[0]!.converted).toBe(true);
    expect(readdirSync(join(dirs.output, "Pack"))).toContain(after.songs[0]!.expectedOsz);
  });

  it("converts only the song that was picked out of the archive", () => {
    const dirs = setup();
    writeFileSync(
      join(dirs.input, "collection.zip"),
      zipSync({
        ...zipSong("Pack/One", "zero-offset"),
        ...zipSong("Pack/Two", "seven-keys"),
      }),
    );

    const { jobs, result } = listScan(dirs.input, dirs.output, null);
    const archiveId = result.archives[0]!.id;
    const picked = selectJobs(jobs, [`${archiveId}::Pack/Two`]);

    expect(picked).toHaveLength(1);
    expect(picked[0]!.songs).toEqual(["Pack/Two"]);

    const logger = createTestLogger();
    runJobs(picked, parseArgs([]), dirs, logger.logger);

    expect(readdirSync(join(dirs.output, "Pack"))).toHaveLength(1);
    expect(logger.lines.some((line) => line.includes("partial selection: 1 of 2"))).toBe(true);

    // A partly converted archive is not remembered as done, so the song that
    // was skipped can still be converted later.
    const after = listScan(dirs.input, dirs.output, null);
    expect(after.result.archives[0]!.converted).toBe(false);

    runJobs(
      selectJobs(after.jobs, [`${archiveId}::Pack/One`]),
      parseArgs([]),
      dirs,
      createTestLogger().logger,
    );

    expect(readdirSync(join(dirs.output, "Pack"))).toHaveLength(2);
  });

  it("converts a song whose chart sits at the archive root", () => {
    const dirs = setup();
    writeFileSync(join(dirs.input, "loose.zip"), zipSync(zipSong("", "zero-offset")));

    const { jobs, result } = listScan(dirs.input, dirs.output, null);
    const song = result.songs[0]!;
    expect(song.id).toBe(`${result.archives[0]!.id}::song.sm`);
    expect(song.label).toBe("song.sm");
    expect(song.charts).toHaveLength(1);

    runJobs(selectJobs(jobs, [song.id]), parseArgs([]), dirs, createTestLogger().logger);
    expect(readdirSync(dirs.output).filter((name) => name.endsWith(".osz"))).toHaveLength(1);
  });
});
