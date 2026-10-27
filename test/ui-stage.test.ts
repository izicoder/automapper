import { existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { DropStage, sanitizeDropPath } from "../src/ui/stage.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir("ui-stage-");
  created.push(dir);
  return dir;
}

describe("dropped paths (spec section 7)", () => {
  it("keeps the folder structure of a dropped pack", () => {
    expect(sanitizeDropPath("Pack/Song/chart.sm")).toEqual(["Pack", "Song", "chart.sm"]);
    expect(sanitizeDropPath("Pack\\Song\\chart.sm")).toEqual(["Pack", "Song", "chart.sm"]);
    expect(sanitizeDropPath("./Song//chart.sm")).toEqual(["Song", "chart.sm"]);
  });

  it("refuses to escape the staging folder", () => {
    for (const bad of ["../evil.sm", "Pack/../../evil.sm", "..", "/etc/passwd", "C:/Windows/x.sm"]) {
      expect(() => sanitizeDropPath(bad)).toThrow();
    }
  });

  it("strips characters Windows rejects and names it cannot use", () => {
    expect(sanitizeDropPath('so"ng<>|?.sm')).toEqual(["song.sm"]);
    expect(sanitizeDropPath("con/chart.sm")).toEqual(["_con", "chart.sm"]);
    expect(sanitizeDropPath("Song./chart.sm")).toEqual(["Song", "chart.sm"]);
    expect(() => sanitizeDropPath("???")).toThrow();
  });
});

describe("drop staging (spec section 7)", () => {
  it("writes dropped files outside INPUT/ and removes them on dispose", async () => {
    const stage = DropStage.create();
    created.push(stage.dir);

    const saved = await stage.save("Song/chart.sm", Readable.from(["#TITLE:Test;"]));
    expect(saved.startsWith(stage.dir)).toBe(true);
    expect(readFileSync(saved, "utf8")).toBe("#TITLE:Test;");

    stage.dispose();
    expect(existsSync(stage.dir)).toBe(false);
  });

  it("keeps two dropped files with the same name apart", async () => {
    const root = scratch();
    const stage = DropStage.at(join(root, "stage"));
    created.push(stage.dir);

    writeFileSync(join(stage.dir, "chart.sm"), "first");
    const second = await stage.save("chart.sm", Readable.from(["second"]));

    expect(second.endsWith("chart (2).sm")).toBe(true);
    expect(readFileSync(join(stage.dir, "chart.sm"), "utf8")).toBe("first");
  });

  it("clears the staging folder without touching anything else", async () => {
    const root = scratch();
    const stage = DropStage.at(join(root, "stage"));

    await stage.save("Song/chart.sm", Readable.from(["x"]));
    expect(existsSync(join(stage.dir, "Song", "chart.sm"))).toBe(true);

    stage.clear();
    expect(existsSync(join(stage.dir, "Song", "chart.sm"))).toBe(false);
    expect(existsSync(stage.dir)).toBe(true);
  });
});
