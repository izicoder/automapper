import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendToLogFile, prepareLogFile } from "../src/log-file.js";
import { tempDir } from "./temp.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir("log-file-");
  created.push(dir);
  return dir;
}

describe("automapper.log (persistent log)", () => {
  it("appends every line with a timestamp and keeps old lines", () => {
    const file = join(scratch(), "automapper.log");

    appendToLogFile("INFO  first", file);
    appendToLogFile("WARN  [Song] no usable audio file", file);

    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO {2}first$/);
    expect(lines[1]).toContain("WARN  [Song] no usable audio file");
  });

  it("creates the log again after a restart instead of truncating it", () => {
    const file = join(scratch(), "automapper.log");

    appendToLogFile("INFO  before restart", file);
    prepareLogFile(file);
    appendToLogFile("INFO  after restart", file);

    const text = readFileSync(file, "utf8");
    expect(text).toContain("before restart");
    expect(text).toContain("after restart");
  });

  it("keeps one previous file when the log grew too large", () => {
    const dir = scratch();
    const file = join(dir, "automapper.log");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "x".repeat(9 * 1024 * 1024));

    prepareLogFile(file);

    expect(existsSync(`${file}.1`)).toBe(true);
    // The oversized file moved away; the next append starts a fresh one.
    expect(existsSync(file)).toBe(false);
    appendToLogFile("INFO  fresh", file);
    expect(readFileSync(file, "utf8")).toContain("fresh");
  });

  it("never throws when the log cannot be written", () => {
    const dir = scratch();
    expect(() => appendToLogFile("INFO  no folder here", join(dir, "missing", "x.log"))).not.toThrow();
  });
});
