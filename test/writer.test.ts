import { describe, expect, it } from "vitest";

import { mapNotes } from "../src/osu/note-mapping.js";
import { writeBeatmap, type WriteOptions } from "../src/osu/writer.js";
import { loadStepManiaSong } from "../src/parsers/stepmania.js";
import { parseOsu, songFixture, type ParsedOsu } from "./osu-format.js";

const OPTIONS: WriteOptions = {
  versionHash: "a1b2c3",
  creator: "tester",
  audioFileName: "song.mp3",
  minHoldBeats: 1 / 32,
  rollAsTaps: false,
  rollTapBeats: 0.25,
  stopEmulation: false,
};

/** Time of a beat in the fixtures: enough for the note-mapping call. */
const NO_ROLLS = {
  minHoldBeats: OPTIONS.minHoldBeats,
  rollAsTaps: false,
  rollTapBeats: 0.25,
  timeAt: (): number => 0,
};

function writeFixture(name: string): { parsed: ParsedOsu; content: string; offsetSeconds: number } {
  const outcome = loadStepManiaSong(songFixture(name));
  expect(outcome.reason).toBeUndefined();
  const song = outcome.song!;
  const chart = song.charts[0]!;
  const written = writeBeatmap(song, chart, OPTIONS);
  return {
    parsed: parseOsu(written.content),
    content: written.content,
    offsetSeconds: chart.timing.offsetSeconds,
  };
}

describe("beatmap writer (spec sections 6 and 7)", () => {
  for (const name of ["negative-offset", "positive-offset", "zero-offset", "bpm-change-stop"]) {
    it(`lands every note of ${name} within 1 ms of the IR time`, () => {
      const outcome = loadStepManiaSong(songFixture(name));
      const song = outcome.song!;
      const chart = song.charts[0]!;

      const { parsed } = writeFixture(name);
      const expected = mapNotes(chart.notes, NO_ROLLS).notes;

      expect(parsed.hitObjects).toHaveLength(expected.length);
      parsed.hitObjects.forEach((object, index) => {
        expect(Math.abs(object.time - expected[index]!.startMs)).toBeLessThanOrEqual(1);
      });
    });
  }

  it("puts the first timing point at -OFFSET * 1000, unclamped", () => {
    const positive = writeFixture("positive-offset");
    expect(positive.offsetSeconds).toBe(0.25);
    expect(positive.parsed.timingPoints[0]!.ms).toBe(-250);
    // The first note sits before zero and must not be shifted to hide it.
    expect(positive.parsed.hitObjects[0]!.time).toBe(-250);
    expect(positive.content).toContain("-250,1,0,0:0:0:0:");

    const negative = writeFixture("negative-offset");
    expect(negative.offsetSeconds).toBe(-0.5);
    expect(negative.parsed.timingPoints[0]!.ms).toBe(500);
  });

  it("writes one uninherited timing point per BPM change", () => {
    const { parsed } = writeFixture("bpm-change-stop");
    expect(parsed.timingPoints).toHaveLength(2);
    for (const point of parsed.timingPoints) {
      expect(point.uninherited).toBe(1);
      expect(point.beatLength).toBeGreaterThan(0);
    }
    expect(parsed.timingPoints[0]!.beatLength).toBe(500); // 120 BPM
    expect(parsed.timingPoints[1]!.beatLength).toBe(1000); // 60 BPM from beat 4
    // Beat 4 is reached through a 0.25 s stop: 1000 ms + 250 ms + 1000 ms.
    expect(parsed.timingPoints[1]!.ms).toBe(2250);
  });

  it("can emulate a stop with inherited SV lines", () => {
    const outcome = loadStepManiaSong(songFixture("bpm-change-stop"));
    const song = outcome.song!;
    const parsed = parseOsu(
      writeBeatmap(song, song.charts[0]!, { ...OPTIONS, stopEmulation: true }).content,
    );

    const inherited = parsed.timingPoints.filter((point) => point.uninherited === 0);
    expect(inherited).toHaveLength(2);
    // The stop sits on beat 2: 1000 ms, and lasts 250 ms.
    expect(inherited[0]!.ms).toBe(1000);
    expect(inherited[1]!.ms).toBe(1250);
    expect(inherited[0]!.beatLength).toBeLessThan(0);
  });

  it("writes taps and holds in the osu!mania hit object format", () => {
    const { parsed } = writeFixture("note-types");

    for (const object of parsed.hitObjects) {
      expect(Number.isInteger(object.x)).toBe(true);
      expect(object.x).toBeGreaterThanOrEqual(0);
      expect(object.x).toBeLessThan(512);
      expect([1, 128]).toContain(object.type);
    }

    const holds = parsed.hitObjects.filter((object) => object.type === 128);
    const taps = parsed.hitObjects.filter((object) => object.type === 1);
    expect(holds.length).toBeGreaterThan(0);
    expect(taps.length).toBeGreaterThan(0);
    for (const hold of holds) expect(hold.endTime!).toBeGreaterThan(hold.time);

    // Mines and fakes are dropped, so their times never appear.
    const times = parsed.hitObjects.map((object) => object.time);
    expect(times).not.toContain(1500); // mine
    expect(times).not.toContain(3000); // fake and the tap that moved away
  });

  it("uses one column per key with the conventional x positions", () => {
    const { parsed } = writeFixture("negative-offset");
    const columns = [...new Set(parsed.hitObjects.map((object) => object.x))];
    expect(columns).toEqual([64, 448]); // 4K columns are 64, 192, 320, 448
    expect(parsed.difficulty["CircleSize"]).toBe("4");
    expect(parsed.general["Mode"]).toBe("3");
  });

  it("names the difficulty with the key count and the settings hash", () => {
    const outcome = loadStepManiaSong(songFixture("negative-offset"));
    const song = outcome.song!;
    const written = writeBeatmap(song, song.charts[0]!, OPTIONS);
    expect(written.version).toBe("4K Hard #a1b2c3");
    expect(parseOsu(written.content).metadata["Version"]).toBe("4K Hard #a1b2c3");
  });

  it("claims no online identity", () => {
    const { parsed } = writeFixture("negative-offset");
    expect(parsed.metadata["BeatmapID"]).toBe("0");
    expect(parsed.metadata["BeatmapSetID"]).toBe("-1");
  });

  it("gives each .ssc chart its own timing points", () => {
    const outcome = loadStepManiaSong(songFixture("per-chart-timing"));
    const song = outcome.song!;

    const easy = parseOsu(writeBeatmap(song, song.charts[0]!, OPTIONS).content);
    const hard = parseOsu(writeBeatmap(song, song.charts[1]!, OPTIONS).content);

    expect(easy.timingPoints[0]!.ms).toBe(250); // chart #OFFSET:-0.25
    expect(hard.timingPoints[0]!.ms).toBe(0); // chart #OFFSET:0
    expect(hard.timingPoints[0]!.beatLength).toBeCloseTo(333.3333333, 5);
  });

  it("keeps the audio file name and preview time from the source", () => {
    const { parsed } = writeFixture("negative-offset");
    expect(parsed.general["AudioFilename"]).toBe("song.mp3");
    expect(parsed.general["PreviewTime"]).toBe("1500");
  });

  it("refuses a key count osu!mania cannot load", () => {
    const song = loadStepManiaSong(songFixture("zero-offset")).song!;
    const chart = { ...song.charts[0]!, keyCount: 19 };
    expect(() => writeBeatmap(song, chart, OPTIONS)).toThrow(/1 to 18/);

    const zero = { ...song.charts[0]!, keyCount: 0 };
    expect(() => writeBeatmap(song, zero, OPTIONS)).toThrow(/1 to 18/);
  });

  it("writes a structurally valid .osu file", () => {
    const outcome = loadStepManiaSong(songFixture("note-types"));
    const song = outcome.song!;
    const content = writeBeatmap(song, song.charts[0]!, OPTIONS).content;
    const lines = content.split("\r\n");

    for (const section of ["[General]", "[Metadata]", "[Difficulty]", "[Events]", "[TimingPoints]", "[HitObjects]"]) {
      expect(lines).toContain(section);
    }

    const timingHeader = lines.indexOf("[TimingPoints]");
    const objectsHeader = lines.indexOf("[HitObjects]");
    expect(timingHeader).toBeGreaterThan(-1);
    expect(objectsHeader).toBeGreaterThan(timingHeader);

    for (const line of lines.slice(timingHeader + 1, objectsHeader).filter((entry) => entry.length > 0)) {
      expect(line.split(",")).toHaveLength(8); // time, beatLength, meter, sampleSet, sampleIndex, volume, uninherited, effects
    }

    let previousTime = Number.NEGATIVE_INFINITY;
    for (const line of lines.slice(objectsHeader + 1).filter((entry) => entry.length > 0)) {
      const fields = line.split(",");
      expect(fields).toHaveLength(6);
      const [x, y, time, type, hitSound] = fields;
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThan(512);
      expect(y).toBe("192");
      expect(Number.isInteger(Number(time))).toBe(true);
      expect(Number(time)).toBeGreaterThanOrEqual(previousTime);
      previousTime = Number(time);
      expect(["1", "128"]).toContain(type);
      expect(hitSound).toBe("0");

      if (type === "128") {
        const endTime = Number(fields[5]!.split(":")[0]);
        expect(endTime).toBeGreaterThan(Number(time));
      }
    }
  });
});
