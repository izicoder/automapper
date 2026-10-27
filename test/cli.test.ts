import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { run } from "../src/cli/index.js";
import { createTestLogger } from "../src/log.js";
import { packFixture } from "./osu-format.js";
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

describe("CLI end to end (spec sections 5, 7 and 11)", () => {
  it("converts a pack and skips the broken song without aborting it", () => {
    const dirs = setupPack();
    const { logger, lines } = createTestLogger();

    const result = run([], logger, dirs);

    expect(result).toEqual({ converted: 2, failed: 1 });

    const files = readdirSync(join(dirs.output, "Demo Pack")).sort();
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toMatch(/^Same Artist - Same Song \[[0-9a-f]{6}\]\.osz$/);
    }
    expect(new Set(files).size).toBe(2); // same title/artist must not collide

    expect(lines.some((line) => line.includes("skipped:"))).toBe(true);
    expect(lines.some((line) => line.includes("2 songs converted, 1 skipped"))).toBe(true);
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

  it("says out loud when an option is not implemented yet", () => {
    const dirs = setupPack();
    const { logger, lines } = createTestLogger();

    expect(run(["--keys", "4,7"], logger, dirs)).toEqual({ converted: 2, failed: 1 });
    expect(lines.some((line) => line.includes("--keys is not implemented yet"))).toBe(true);
  });
});
