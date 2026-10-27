import { describe, expect, it } from "vitest";

import { CliError, DEFAULT_OPTIONS, parseArgs } from "../src/cli/options.js";

describe("command line options (spec section 11)", () => {
  it("has documented defaults", () => {
    const options = parseArgs([]);
    expect(options).toEqual({ ...DEFAULT_OPTIONS, keys: [] });
    expect(options.keys).toEqual([]);
  });

  it("parses a key list and removes duplicates", () => {
    expect(parseArgs(["--keys", "4,10,4,18"]).keys).toEqual([4, 10, 18]);
    expect(parseArgs(["--keys", "1"]).keys).toEqual([1]);
  });

  it("accepts every osu!mania key count from 1 to 18", () => {
    for (let keys = 1; keys <= 18; keys += 1) {
      expect(parseArgs(["--keys", String(keys)]).keys).toEqual([keys]);
    }
  });

  it("rejects key counts outside 1 to 18", () => {
    for (const bad of ["0", "19", "99", "-4"]) {
      expect(() => parseArgs(["--keys", bad])).toThrow(CliError);
      expect(() => parseArgs(["--keys", bad])).toThrow(/1 to 18/);
    }
  });

  it("rejects key counts that are not whole numbers", () => {
    for (const bad of ["4.5", "four", "", "4,,7"]) {
      expect(() => parseArgs(["--keys", bad])).toThrow(CliError);
    }
  });

  it("parses the roll and hold options", () => {
    const options = parseArgs([
      "--min-hold-beats",
      "0.5",
      "--roll-taps",
      "--roll-subdivision",
      "0.125",
      "--stop-emulation",
      "--seed",
      "7",
    ]);

    expect(options.minHoldBeats).toBe(0.5);
    expect(options.rollAsTaps).toBe(true);
    expect(options.rollTapBeats).toBe(0.125);
    expect(options.stopEmulation).toBe(true);
    expect(options.seed).toBe(7);
  });

  it("rejects a roll subdivision that is not positive", () => {
    expect(() => parseArgs(["--roll-subdivision", "0"])).toThrow(CliError);
    expect(() => parseArgs(["--roll-subdivision", "-1"])).toThrow(CliError);
  });

  it("rejects an unknown flag instead of ignoring it", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option/);
  });

  it("requires a value for flags that need one", () => {
    expect(() => parseArgs(["--keys"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--seed"])).toThrow(/needs a value/);
  });
});
