import { mkdirSync } from "node:fs";
import { basename } from "node:path";

import { appendToLogFile, prepareLogFile } from "../log-file.js";
import { Logger } from "../log.js";
import { discover } from "../package/layout.js";
import { ensureInputDir, ensureOutputDir } from "../paths.js";
import { isMainModule } from "../runtime.js";
import { jobsFromDiscovery, runJobs } from "./jobs.js";
import { CliError, parseArgs, USAGE } from "./options.js";
import type { RunDirs, RunResult } from "./types.js";

export type { RunDirs, RunProgress, RunResult } from "./types.js";
export type { CliOptions } from "./options.js";
export { buildCharts } from "./charts.js";

export type { ConversionJob, JobKind } from "./jobs.js";

/**
 * Converts everything in INPUT/ into OUTPUT/ (spec sections 2 and 11).
 * One bad song is skipped with a log line; it never aborts a pack.
 *
 * Zip archives in INPUT/ are unpacked into a temporary folder, converted and
 * removed again. A small state file in OUTPUT/ remembers which archive was
 * already converted with which settings, so a re-run only touches new or
 * changed archives (spec section 7, idempotence).
 */
export function run(
  argv: readonly string[],
  logger: Logger,
  dirs: RunDirs = { input: ensureInputDir(), output: ensureOutputDir() },
): RunResult {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof CliError) {
      logger.error(error.message);
      logger.info(USAGE);
      return { converted: 0, failed: 1 };
    }
    throw error;
  }

  if (options.help) {
    logger.info(USAGE);
    return { converted: 0, failed: 0 };
  }

  mkdirSync(dirs.output, { recursive: true });

  const discovery = discover(dirs.input);
  const result = runJobs(jobsFromDiscovery(discovery), options, dirs, logger);

  for (const archive of discovery.unsupportedArchives) {
    logger.warn(`unsupported archive, unpack it yourself: ${basename(archive)}`);
  }

  logger.info(`${result.converted} songs converted, ${result.failed} skipped`);
  return result;
}

/** Entry point: runs the conversion and sets the exit code (spec section 11). */
export function main(
  argv: readonly string[] = process.argv.slice(2),
  logger?: Logger,
  dirs?: RunDirs,
): number {
  const result = run(argv, logger ?? createCliLogger(), dirs);
  // Any skipped song is a partial failure, and the exit code must say so.
  return result.failed > 0 ? 1 : 0;
}

/**
 * The CLI writes to the terminal and mirrors everything into automapper.log,
 * which survives restarts so errors can be read back later.
 */
function createCliLogger(): Logger {
  prepareLogFile();
  return new Logger("info", (line) => {
    process.stdout.write(`${line}\n`);
    appendToLogFile(line);
  });
}

// Only run when invoked directly, not when imported by tests.
if (isMainModule(import.meta.url)) {
  process.exitCode = main();
}
