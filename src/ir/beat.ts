/**
 * Exact rational beat positions. StepMania puts notes on rows of a measure, so
 * a beat is 4 * row / rows -- a rational by construction. Keeping it exact
 * means stop/delay/warp alignment is decided by integer comparison instead of
 * floating point near-misses.
 */
export interface Beat {
  readonly n: number;
  readonly d: number;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

export function beat(n: number, d = 1): Beat {
  if (d === 0) throw new Error("beat denominator must not be zero");
  if (!Number.isFinite(n) || !Number.isFinite(d)) throw new Error("beat parts must be finite");
  let num = n;
  let den = d;
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

export const ZERO_BEAT: Beat = { n: 0, d: 1 };

export function toNumber(value: Beat): number {
  return value.n / value.d;
}

export function compareBeats(a: Beat, b: Beat): number {
  const left = a.n * b.d;
  const right = b.n * a.d;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function equalsBeat(a: Beat, b: Beat): boolean {
  return compareBeats(a, b) === 0;
}

export function addBeats(a: Beat, b: Beat): Beat {
  return beat(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subBeats(a: Beat, b: Beat): Beat {
  return beat(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function scaleBeat(a: Beat, factor: number): Beat {
  return beat(a.n * factor, a.d);
}

export function maxBeat(a: Beat, b: Beat): Beat {
  return compareBeats(a, b) >= 0 ? a : b;
}

export function formatBeat(value: Beat): string {
  return `${value.n}/${value.d}`;
}

/** Parses "4", "0.5" or "1/3" into an exact beat. */
export function parseBeat(text: string): Beat {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  if (slash >= 0) {
    const n = Number(trimmed.slice(0, slash));
    const d = Number(trimmed.slice(slash + 1));
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) {
      throw new Error(`invalid beat "${text}"`);
    }
    return beat(n, d);
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) throw new Error(`invalid beat "${text}"`);
  return beatFromDecimal(value);
}

/**
 * Converts a decimal to a rational. Six decimal places cover StepMania's own
 * precision (offsets and stop times are written with ~7 digits at most).
 */
export function beatFromDecimal(value: number, precision = 1_000_000): Beat {
  const scaled = Math.round(value * precision);
  return beat(scaled, precision);
}
