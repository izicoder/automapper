import { describe, expect, it } from "vitest";

import { beat } from "../src/ir/beat.js";
import { TimingMap } from "../src/ir/timing.js";
import type { TempoMap } from "../src/ir/types.js";

function tempo(partial: Partial<TempoMap>): TempoMap {
  return {
    offsetSeconds: 0,
    bpm: [{ beat: beat(0), bpm: 120 }],
    stops: [],
    delays: [],
    warps: [],
    ...partial,
  };
}

describe("TimingMap", () => {
  it("places beat 0 at -offset seconds, negative offset included", () => {
    const timing = new TimingMap(tempo({ offsetSeconds: -0.5 }));
    expect(timing.timeAt(beat(0))).toBeCloseTo(500, 9);
    expect(timing.timeAt(beat(2))).toBeCloseTo(1500, 9);
  });

  it("keeps a positive offset negative instead of clamping it", () => {
    const timing = new TimingMap(tempo({ offsetSeconds: 0.25 }));
    expect(timing.timeAt(beat(0))).toBeCloseTo(-250, 9);
  });

  it("applies a BPM change from its own beat onwards", () => {
    const timing = new TimingMap(
      tempo({ bpm: [{ beat: beat(0), bpm: 120 }, { beat: beat(4), bpm: 60 }] }),
    );
    expect(timing.timeAt(beat(4))).toBeCloseTo(2000, 9);
    expect(timing.timeAt(beat(5))).toBeCloseTo(3000, 9);
    expect(timing.bpmAt(beat(3))).toBe(120);
    expect(timing.bpmAt(beat(4))).toBe(60);
  });

  it("holds time after a note on the stop beat", () => {
    const timing = new TimingMap(tempo({ stops: [{ beat: beat(2), seconds: 0.25 }] }));
    expect(timing.timeAt(beat(2))).toBeCloseTo(1000, 9);
    expect(timing.timeAt(beat(3))).toBeCloseTo(1750, 9);
    expect(timing.timeAt(beat(4))).toBeCloseTo(2250, 9);
  });

  it("holds time before a note on the delay beat", () => {
    const timing = new TimingMap(tempo({ delays: [{ beat: beat(2), seconds: 0.25 }] }));
    expect(timing.timeAt(beat(1))).toBeCloseTo(500, 9);
    expect(timing.timeAt(beat(2))).toBeCloseTo(1250, 9);
    expect(timing.timeAt(beat(3))).toBeCloseTo(1750, 9);
  });

  it("collapses notes inside a warp onto its start", () => {
    const timing = new TimingMap(tempo({ warps: [{ beat: beat(4), beats: 2 }] }));
    expect(timing.timeAt(beat(3))).toBeCloseTo(1500, 9);
    expect(timing.timeAt(beat(4))).toBeCloseTo(2000, 9);
    expect(timing.timeAt(beat(5))).toBeCloseTo(2000, 9);
    expect(timing.timeAt(beat(6))).toBeCloseTo(2000, 9);
    expect(timing.timeAt(beat(7))).toBeCloseTo(2500, 9);
    expect(timing.isInsideWarp(beat(5))).toBe(true);
    expect(timing.isInsideWarp(beat(6))).toBe(false);
  });

  it("emits one line per actual BPM change", () => {
    const timing = new TimingMap(
      tempo({
        bpm: [
          { beat: beat(0), bpm: 120 },
          { beat: beat(4), bpm: 60 },
          { beat: beat(8), bpm: 60 },
          { beat: beat(12), bpm: 180 },
        ],
      }),
    );
    expect(timing.redLines().map((line) => [line.beat.n, line.bpm, Math.round(line.ms)])).toEqual([
      [0, 120, 0],
      [4, 60, 2000],
      [12, 180, 10000],
    ]);
  });

  it("warns and ignores invalid BPM changes", () => {
    const timing = new TimingMap(
      tempo({ bpm: [{ beat: beat(0), bpm: 120 }, { beat: beat(4), bpm: 0 }] }),
    );
    expect(timing.warnings).toHaveLength(1);
    expect(timing.bpmAt(beat(4))).toBe(120);
  });

  it("assumes the first BPM applies from beat 0", () => {
    const timing = new TimingMap(tempo({ bpm: [{ beat: beat(4), bpm: 180 }] }));
    expect(timing.warnings[0]).toContain("no BPM change at beat 0");
    expect(timing.timeAt(beat(0))).toBeCloseTo(0, 9);
    expect(timing.timeAt(beat(4))).toBeCloseTo(4 * (60000 / 180), 9);
  });

  it("throws when there is no BPM at all", () => {
    expect(() => new TimingMap(tempo({ bpm: [] }))).toThrow(/no usable BPM/);
  });
});