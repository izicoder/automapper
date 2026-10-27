import { addBeats, beatFromDecimal, compareBeats, equalsBeat, toNumber, type Beat } from "./beat.js";
import type { BpmChange, TempoMap } from "./types.js";

interface Segment {
  startBeat: Beat;
  /** Exact beat offset where the next segment starts. */
  endBeat: Beat;
  bpm: number;
  /** Absolute ms at startBeat, including every pause before it. */
  startMs: number;
  /** True when the whole segment sits inside a warp: no time passes. */
  warped: boolean;
}

function sortByBeat<T extends { beat: Beat }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => compareBeats(a.beat, b.beat));
}

function uniqueBeats(items: readonly Beat[]): Beat[] {
  const sorted = [...items].sort(compareBeats);
  const out: Beat[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || !equalsBeat(last, item)) out.push(item);
  }
  return out;
}

/**
 * Converts beats to absolute milliseconds exactly once (spec section 6).
 *
 * Rules implemented here:
 * - beat 0 is at -#OFFSET seconds, negative times are kept as they are;
 * - each BPM segment is measured at full double precision, never accumulated
 *   through rounded values;
 * - a #STOP pauses time *after* a note sitting on its beat;
 * - a #DELAY pauses time *before* a note sitting on its beat;
 * - a #WARP makes time stand still, so notes inside it collapse onto its start.
 */
export class TimingMap {
  private readonly segments: Segment[];
  private readonly stops: { beat: Beat; seconds: number; sum: number }[];
  private readonly delays: { beat: Beat; seconds: number; sum: number }[];
  private readonly warps: { start: Beat; end: Beat }[];
  readonly warnings: string[] = [];

  constructor(timing: TempoMap) {
    const bpmChanges = sortByBeat(timing.bpm).filter((change) => {
      if (!Number.isFinite(change.bpm) || change.bpm <= 0) {
        this.warnings.push(`ignored BPM change at beat ${toNumber(change.beat)}: invalid value ${change.bpm}`);
        return false;
      }
      return true;
    });

    if (bpmChanges.length === 0) {
      throw new Error("tempo map has no usable BPM changes");
    }

    if (!equalsBeat(bpmChanges[0]!.beat, { n: 0, d: 1 })) {
      this.warnings.push("no BPM change at beat 0; assuming the first BPM applies from beat 0");
      bpmChanges.unshift({ beat: { n: 0, d: 1 }, bpm: bpmChanges[0]!.bpm });
    }

    this.warps = sortByBeat(timing.warps)
      .filter((warp) => Number.isFinite(warp.beats) && warp.beats > 0)
      .map((warp) => ({ start: warp.beat, end: addBeats(warp.beat, beatFromDecimal(warp.beats)) }));

    this.stops = buildPauses(sortByBeat(timing.stops));
    this.delays = buildPauses(sortByBeat(timing.delays));

    this.segments = this.buildSegments(bpmChanges, timing.offsetSeconds);
  }

  /** Absolute ms of a beat. Full precision; round only when writing. */
  timeAt(beat: Beat): number {
    const segment = this.findSegment(beat);
    if (segment === undefined) {
      // Before the first segment cannot happen (first segment starts at beat 0),
      // but keep the function total for defensive parsing of broken charts.
      return this.originMs();
    }
    if (segment.warped) {
      return segment.startMs + this.pausesBefore(beat);
    }
    const beats = toNumber(beat) - toNumber(segment.startBeat);
    const spanMs = (beats * 60000) / segment.bpm;
    return segment.startMs + spanMs + this.pausesBefore(beat);
  }

  /** True when a beat falls inside a warp and therefore cannot be hit. */
  isInsideWarp(beat: Beat): boolean {
    return this.warps.some((warp) => compareBeats(beat, warp.start) >= 0 && compareBeats(beat, warp.end) < 0);
  }

  /** BPM in effect at a beat, used for timing point generation. */
  bpmAt(beat: Beat): number {
    let active = this.segments[0]?.bpm ?? 120;
    for (const segment of this.segments) {
      if (compareBeats(segment.startBeat, beat) <= 0) active = segment.bpm;
      else break;
    }
    return active;
  }

  /** One entry per BPM change that actually starts a new section in osu. */
  redLines(): { beat: Beat; ms: number; bpm: number }[] {
    const out: { beat: Beat; ms: number; bpm: number }[] = [];
    for (const segment of this.segments) {
      const previous = out[out.length - 1];
      if (previous !== undefined && previous.bpm === segment.bpm) continue;
      out.push({ beat: segment.startBeat, ms: this.timeAt(segment.startBeat), bpm: segment.bpm });
    }
    return out;
  }

  private originMs(): number {
    return this.segments[0]?.startMs ?? 0;
  }

  private pausesBefore(beat: Beat, includeDelaysAtBeat = true): number {
    let total = 0;
    // A stop on the beat happens after the note on that beat.
    const stopIndex = lastIndexStrictlyBefore(this.stops, beat);
    if (stopIndex >= 0) total += this.stops[stopIndex]!.sum;
    // A delay on the beat happens before the note on that beat.
    const delayIndex = includeDelaysAtBeat ? lastIndexAtOrBefore(this.delays, beat) : lastIndexStrictlyBefore(this.delays, beat);
    if (delayIndex >= 0) total += this.delays[delayIndex]!.sum;
    return total;
  }

  private findSegment(beat: Beat): Segment | undefined {
    let low = 0;
    let high = this.segments.length - 1;
    let found: Segment | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = this.segments[mid]!;
      if (compareBeats(segment.startBeat, beat) <= 0) {
        found = segment;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  private buildSegments(bpmChanges: BpmChange[], offsetSeconds: number): Segment[] {
    const boundaries = uniqueBeats([
      { n: 0, d: 1 },
      ...bpmChanges.map((change) => change.beat),
      ...this.warps.flatMap((warp) => [warp.start, warp.end]),
    ]);

    const segments: Segment[] = [];
    let ms = -offsetSeconds * 1000;

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startBeat = boundaries[index]!;
      const endBeat = boundaries[index + 1]!;
      const bpm = bpmAtChange(bpmChanges, startBeat);
      const warped = this.isInsideWarp(startBeat);
      segments.push({ startBeat, endBeat, bpm, startMs: ms, warped });
      if (!warped) {
        ms += (toNumber(endBeat) - toNumber(startBeat)) * (60000 / bpm);
      }
    }

    if (segments.length === 0) {
      const bpm = bpmChanges[0]!.bpm;
      segments.push({
        startBeat: { n: 0, d: 1 },
        endBeat: { n: Number.MAX_SAFE_INTEGER, d: 1 },
        bpm,
        startMs: ms,
        warped: false,
      });
    }
    return segments;
  }
}

function bpmAtChange(changes: BpmChange[], beat: Beat): number {
  let active = changes[0]?.bpm ?? 120;
  for (const change of changes) {
    if (compareBeats(change.beat, beat) <= 0) active = change.bpm;
    else break;
  }
  return active;
}

function buildPauses(events: readonly { beat: Beat; seconds: number }[]): { beat: Beat; seconds: number; sum: number }[] {
  const out: { beat: Beat; seconds: number; sum: number }[] = [];
  for (const event of events) {
    if (!Number.isFinite(event.seconds) || event.seconds <= 0) continue;
    const previous = out[out.length - 1];
    if (previous !== undefined && equalsBeat(previous.beat, event.beat)) {
      previous.seconds += event.seconds;
      previous.sum += event.seconds;
      continue;
    }
    out.push({ beat: event.beat, seconds: event.seconds, sum: (previous?.sum ?? 0) + event.seconds });
  }
  return out;
}

function lastIndexStrictlyBefore(items: readonly { beat: Beat }[], beat: Beat): number {
  let result = -1;
  for (let index = 0; index < items.length; index += 1) {
    if (compareBeats(items[index]!.beat, beat) < 0) result = index;
    else break;
  }
  return result;
}

function lastIndexAtOrBefore(items: readonly { beat: Beat }[], beat: Beat): number {
  let result = -1;
  for (let index = 0; index < items.length; index += 1) {
    if (compareBeats(items[index]!.beat, beat) <= 0) result = index;
    else break;
  }
  return result;
}


