import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { clearArchiveCache, peekArchive } from "../src/ui/archive-scan.js";
import { songFixture } from "./osu-format.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  clearArchiveCache();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir("archive-scan-");
  created.push(dir);
  return dir;
}

/** The song fixtures most tests peek at, as zip entries under `prefix`. */
function songEntries(prefix: string, fixture: string, entries: Record<string, Uint8Array> = {}) {
  for (const name of readdirSync(songFixture(fixture))) {
    entries[prefix.length > 0 ? `${prefix}/${name}` : name] = readFileSync(
      join(songFixture(fixture), name),
    );
  }
  return entries;
}

function zipWith(path: string, entries: Record<string, Uint8Array>): string {
  writeFileSync(path, zipSync(entries));
  return path;
}

describe("listing a zip without unpacking it (spec section 7)", () => {
  it("finds songs, their packs and their key counts", () => {
    const root = scratch();
    const archive = zipWith(
      join(root, "collection.zip"),
      songEntries("Pack/Seven", "seven-keys", songEntries("Loose", "zero-offset")),
    );

    const contents = peekArchive(archive);

    expect(contents.error).toBeUndefined();
    expect(contents.songs.map((song) => `${song.pack ?? "-"}|${song.inner}`)).toEqual([
      "-|Loose",
      "Pack|Pack/Seven",
    ]);
    const seven = contents.songs[1]!;
    expect(seven.title).toBeDefined();
    expect(seven.audio).toBe("song.mp3");
    expect(seven.charts.map((chart) => chart.keyCount)).toEqual([7]);
    // The chart text feeds the same content hash the writer uses.
    expect(seven.charts[0]!.sourceText.length).toBeGreaterThan(0);
  });

  it("selects a chart at the archive root by its file name", () => {
    const root = scratch();
    const archive = zipWith(join(root, "loose.zip"), songEntries("", "zero-offset"));

    const contents = peekArchive(archive);

    expect(contents.songs).toHaveLength(1);
    expect(contents.songs[0]!.inner).toBe("song.sm");
    expect(contents.songs[0]!.charts).toHaveLength(1);
  });

  it("reports a chart that is nested deeper than the folder scanner looks", () => {
    const root = scratch();
    const archive = zipWith(
      join(root, "deep.zip"),
      songEntries("Pack/Song/More", "zero-offset"),
    );

    const contents = peekArchive(archive);

    expect(contents.songs).toEqual([]);
    expect(contents.ignored).toEqual(["Pack/Song/More/song.sm"]);
  });

  it("keeps a song that cannot be converted with its reason", () => {
    const root = scratch();
    const archive = zipWith(join(root, "broken.zip"), {
      "No Audio/song.sm": strToU8("#TITLE:Silent;\n#NOTES:\n dance-single:\n :\n :\n 1:\n :\n 0,0,0,0,0:\n1000\n;"),
    });

    const contents = peekArchive(archive);

    expect(contents.songs).toHaveLength(1);
    expect(contents.songs[0]!.charts).toEqual([]);
    expect(contents.songs[0]!.error).toBe("no usable audio file");
  });

  it("reports a zip it cannot read instead of throwing", () => {
    const root = scratch();
    const path = join(root, "broken.zip");
    writeFileSync(path, "not a zip");

    const contents = peekArchive(path);

    expect(contents.songs).toEqual([]);
    expect(contents.error).toBeDefined();
    expect(peekArchive(join(root, "missing.zip")).error).toBeDefined();
  });
});
