/*
 * Ported from rizu vsrg (https://github.com/semyon422/rizu), GPL-3.0.
 * See NOTICE at the repository root for the file-by-file mapping.
 */
/**
 * Exponential note density used by the line balancer.
 * Port of `chart/scoring/enps.lua` in rizu vsrg (GPL-3.0).
 *
 * f(0, c) = c + 1, f(infinity, c) = 0, f(1 / c, c) = c.
 */
export function expDensity(t: number, c: number): number {
  return c === 0 ? Math.exp(-t) : (c + 1) / Math.pow(1 / c + 1, c * t);
}
