import { describe, expect, it } from "vitest";

import { isLegalKeyCount, MAX_KEY_COUNT, MIN_KEY_COUNT, nearestLegalKeyCount } from "../src/keys.js";

describe("osu!mania key counts", () => {
  it("documents the range the game supports", () => {
    expect(MIN_KEY_COUNT).toBe(1);
    expect(MAX_KEY_COUNT).toBe(18);
  });

  it("accepts every count from 1 to 18", () => {
    for (let keys = 1; keys <= 18; keys += 1) {
      expect(isLegalKeyCount(keys)).toBe(true);
      expect(nearestLegalKeyCount(keys)).toBe(keys);
    }
  });

  it("rejects counts outside the range and non-integers", () => {
    for (const keys of [0, 19, 24, -3, 4.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isLegalKeyCount(keys)).toBe(false);
    }
  });

  it("maps an out-of-range source chart onto the closest legal count", () => {
    expect(nearestLegalKeyCount(0)).toBe(1);
    expect(nearestLegalKeyCount(19)).toBe(18);
    expect(nearestLegalKeyCount(24)).toBe(18);
    expect(nearestLegalKeyCount(-2)).toBe(1);
    expect(nearestLegalKeyCount(4.4)).toBe(4);
    expect(nearestLegalKeyCount(Number.NaN)).toBe(1);
  });
});
