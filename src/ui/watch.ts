import { watch, type FSWatcher } from "node:fs";

/**
 * Calls `onChange` once after a burst of file changes under any of `dirs`.
 * Used so the UI follows INPUT/ and the drop folder without a rescan button
 * (spec section 7).
 *
 * Recursive watching needs Node 22 on Windows and Linux; a folder that cannot
 * be watched is simply ignored, since a missing watcher must never break the
 * server.
 */
export function watchForChanges(
  dirs: readonly string[],
  onChange: () => void,
  delayMs = 300,
): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, delayMs);
    timer.unref?.();
  };

  for (const dir of dirs) {
    try {
      const watcher = watch(dir, { recursive: true }, fire);
      // A removed or renamed folder ends the watch; the next scan notices.
      watcher.on("error", () => watcher.close());
      watchers.push(watcher);
    } catch {
      // Not watchable here: the UI still updates after a conversion.
    }
  }

  return () => {
    if (timer !== null) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
