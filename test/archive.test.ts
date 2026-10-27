import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  archiveStamp,
  extractZip,
  isArchiveProcessed,
  readArchiveState,
  settingsFingerprint,
  writeArchiveState,
  type ArchiveState,
} from "../src/package/archive.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix = "archive-"): string {
  const dir = tempDir(prefix);
  created.push(dir);
  return dir;
}

function zipWith(path: string, files: Record<string, string>): string {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text);
  writeFileSync(path, zipSync(entries));
  return path;
}

describe("archive unpacking", () => {
  it("writes nested folders", () => {
    const root = scratch();
    const archive = zipWith(join(root, "pack.zip"), {
      "Pack/Song/song.sm": "#TITLE:Song;",
      "Pack/Song/song.mp3": "audio",
    });
    const target = join(root, "out");

    const result = extractZip(archive, target);

    expect(result.skipped).toEqual([]);
    expect(readFileSync(join(target, "Pack", "Song", "song.sm"), "utf8")).toBe("#TITLE:Song;");
    expect(readFileSync(join(target, "Pack", "Song", "song.mp3"), "utf8")).toBe("audio");
  });

  it("never writes entries that escape the target folder", () => {
    const root = scratch();
    const archive = zipWith(join(root, "evil.zip"), {
      "../evil.txt": "nope",
      "C:/evil.txt": "nope",
      "Pack/../../evil2.txt": "nope",
      "Pack/song.sm": "ok",
    });
    const target = join(root, "out");

    const result = extractZip(archive, target);

    expect(result.skipped).toHaveLength(3);
    expect(readFileSync(join(target, "Pack", "song.sm"), "utf8")).toBe("ok");
    expect(existsSync(join(root, "evil.txt"))).toBe(false);
    expect(existsSync(join(root, "evil2.txt"))).toBe(false);
  });
});

describe("archive conversion state", () => {
  it("remembers size, modification time and settings", () => {
    const root = scratch();
    const archive = zipWith(join(root, "pack.zip"), { "song.sm": "#TITLE:x;" });
    const statePath = join(root, ".archive-state.json");

    const stamp = {
      ...archiveStamp(archive),
      settings: settingsFingerprint({ seed: 0 }, "1.0.0"),
    };
    const state: ArchiveState = { [archive]: stamp };
    writeArchiveState(statePath, state);

    const read = readArchiveState(statePath);
    expect(isArchiveProcessed(read, archive, stamp)).toBe(true);

    const otherSettings = {
      ...stamp,
      settings: settingsFingerprint({ seed: 1 }, "1.0.0"),
    };
    expect(isArchiveProcessed(read, archive, otherSettings)).toBe(false);

    const newerVersion = {
      ...stamp,
      settings: settingsFingerprint({ seed: 0 }, "1.0.1"),
    };
    expect(isArchiveProcessed(read, archive, newerVersion)).toBe(false);
  });

  it("survives a missing or broken state file", () => {
    const root = scratch();
    expect(readArchiveState(join(root, "missing.json"))).toEqual({});

    const broken = join(root, "broken.json");
    writeFileSync(broken, "{not json");
    expect(readArchiveState(broken)).toEqual({});
  });
});
