import { describe, expect, it } from "vitest";

import { addBeats, beat, compareBeats, equalsBeat, formatBeat, parseBeat, scaleBeat, subBeats, toNumber } from "../src/ir/beat.js";

describe("beat rationals", () => {
  it("reduces fractions", () => {
    expect(beat(4, 8)).toEqual({ n: 1, d: 2 });
    expect(beat(0, 5)).toEqual({ n: 0, d: 1 });
    expect(beat(6, -4)).toEqual({ n: -3, d: 2 });
  });

  it("adds, subtracts and scales exactly", () => {
    expect(addBeats(beat(1, 3), beat(1, 6))).toEqual({ n: 1, d: 2 });
    expect(subBeats(beat(1, 2), beat(1, 3))).toEqual({ n: 1, d: 6 });
    expect(scaleBeat(beat(1, 3), 4)).toEqual({ n: 4, d: 3 });
  });

  it("compares without floating point drift", () => {
    expect(compareBeats(beat(1, 3), beat(333333, 1000000))).toBe(1);
    expect(compareBeats(beat(1, 3), beat(1000000, 3000000))).toBe(0);
    expect(equalsBeat(beat(2, 4), beat(1, 2))).toBe(true);
  });

  it("parses decimals and fractions", () => {
    expect(parseBeat("4")).toEqual({ n: 4, d: 1 });
    expect(parseBeat("0.5")).toEqual({ n: 1, d: 2 });
    expect(parseBeat(" 3/4 ")).toEqual({ n: 3, d: 4 });
    expect(() => parseBeat("abc")).toThrow();
    expect(() => parseBeat("1/0")).toThrow();
  });

  it("converts to numbers and back", () => {
    expect(toNumber(beat(3, 4))).toBeCloseTo(0.75, 12);
    expect(formatBeat(beat(3, 4))).toBe("3/4");
  });
});