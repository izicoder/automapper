/**
 * osu!mania key counts. The game plays 1K to 18K; 10K and above are normally
 * dual-stage or Co-Op layouts, but they all use `CircleSize`.
 *
 * Source charts may sit outside this range (other formats have wider
 * layouts), so they are mapped onto the nearest legal count instead of being
 * rejected; see `nearestLegalKeyCount`.
 */
export const MIN_KEY_COUNT = 1;
export const MAX_KEY_COUNT = 18;

export function isLegalKeyCount(keyCount: number): boolean {
  return Number.isInteger(keyCount) && keyCount >= MIN_KEY_COUNT && keyCount <= MAX_KEY_COUNT;
}

/**
 * The legal osu!mania key count closest to `keyCount`. Ties go down, so a
 * 19-key chart becomes 18-key rather than "20".
 */
export function nearestLegalKeyCount(keyCount: number): number {
  if (!Number.isFinite(keyCount)) return MIN_KEY_COUNT;
  return Math.min(MAX_KEY_COUNT, Math.max(MIN_KEY_COUNT, Math.round(keyCount)));
}
