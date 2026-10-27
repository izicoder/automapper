import { fileURLToPath } from "node:url";

/** Folder of a committed song fixture (`test/fixtures/songs/<name>`). */
export function songFixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/songs/${name}`, import.meta.url));
}

/** Folder of a committed pack fixture (`test/fixtures/packs/<name>`). */
export function packFixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/packs/${name}`, import.meta.url));
}

export interface TimingPointLine {
  ms: number;
  beatLength: number;
  /** 1 = uninherited (BPM), 0 = inherited (SV). */
  uninherited: number;
}

export interface HitObjectLine {
  x: number;
  time: number;
  type: number;
  /** Only set for holds (type 128): the release time. */
  endTime?: number;
}

export interface ParsedOsu {
  general: Record<string, string>;
  metadata: Record<string, string>;
  difficulty: Record<string, string>;
  timingPoints: TimingPointLine[];
  hitObjects: HitObjectLine[];
}

/**
 * Minimal .osu reader for tests: only the fields the spec cares about
 * (sections 6 and 7). It parses the file the same way a player would, so a
 * wrong field order in the writer fails the test instead of passing it.
 */
export function parseOsu(text: string): ParsedOsu {
  const parsed: ParsedOsu = {
    general: {},
    metadata: {},
    difficulty: {},
    timingPoints: [],
    hitObjects: [],
  };

  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("//")) continue;

    const heading = /^\[(.+)\]$/.exec(line);
    if (heading !== null) {
      section = heading[1]!;
      continue;
    }

    if (section === "General" || section === "Metadata" || section === "Difficulty") {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const target =
        section === "General" ? parsed.general : section === "Metadata" ? parsed.metadata : parsed.difficulty;
      target[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      continue;
    }

    if (section === "TimingPoints") {
      const fields = line.split(",");
      parsed.timingPoints.push({
        ms: Number(fields[0]),
        beatLength: Number(fields[1]),
        uninherited: Number(fields[6]),
      });
      continue;
    }

    if (section === "HitObjects") {
      const fields = line.split(",");
      const type = Number(fields[3]);
      const object: HitObjectLine = { x: Number(fields[0]), time: Number(fields[2]), type };
      if ((type & 128) !== 0) object.endTime = Number(fields[5]?.split(":")[0]);
      parsed.hitObjects.push(object);
    }
  }

  return parsed;
}
