import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { APP_ROOT } from "./paths.js";

/** Where the CLI and the UI write their log, next to the program. */
export const LOG_FILE = join(APP_ROOT, "automapper.log");

/** Keep one previous log; anything older is dropped. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Rotates an oversized `automapper.log` to `automapper.log.1` once at startup.
 * Everything is appended afterwards, so a crash keeps what was written.
 */
export function prepareLogFile(file: string = LOG_FILE): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      renameSync(file, `${file}.1`);
    }
  } catch {
    // A log that cannot be rotated must never stop a conversion.
  }
}

/**
 * Appends one line with a UTC timestamp. Logging is best effort: a full disk
 * or a locked file never breaks a conversion.
 */
export function appendToLogFile(line: string, file: string = LOG_FILE): void {
  const stamp = new Date().toISOString();
  try {
    appendFileSync(file, `${stamp} ${line}\n`);
  } catch {
    // Ignored on purpose (see above).
  }
}
