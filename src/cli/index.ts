import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "../log.js";
import { discover, type SongEntry } from "../package/layout.js";
import { packageSong } from "../package/osz.js";
import { setFileName, setSettingsHash } from "../osu/naming.js";
import { ensureInputDir, ensureOutputDir } from "../paths.js";
import { loadStepManiaSong } from "../parsers/stepmania.js";
import { CliError, parseArgs, USAGE, type CliOptions } from "./options.js";

export interface RunResult {
  converted: number;
  failed: number;
}

/** Where to read from and write to; defaults to INPUT/ and OUTPUT/ (spec 2.4-2.5). */
export interface RunDirs {
  input: string;
  output: string;
}

/**
 * Converts everything in INPUT/ into OUTPUT/ (spec sections 2 and 11).
 * One bad song is skipped with a log line; it never aborts a pack.
 */
export function run(
  argv: readonly string[],
  logger: Logger,
  dirs: RunDirs = { input: ensureInputDir(), output: ensureOutputDir() },
): RunResult {
  let options: CliOptions;
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

  const inputDir = dirs.input;
  const outputDir = dirs.output;
  mkdirSync(outputDir, { recursive: true });
  const discovery = discover(inputDir);

  warnAboutUnimplementedOptions(options, logger);

  const settings: Record<string, unknown> = {
    keys: options.keys,
    minHoldBeats: options.minHoldBeats,
    stopEmulation: options.stopEmulation,
    rollAsTaps: options.rollAsTaps,
    seed: options.seed,
  };

  let converted = 0;
  let failed = 0;

  for (const song of discovery.songs) {
    const result = convertSong(song, outputDir, settings, options, logger);
    converted += result.converted;
    failed += result.failed;
  }

  for (const pack of discovery.packs) {
    const packDir = join(outputDir, safeName(pack.label));
    mkdirSync(packDir, { recursive: true });
    logger.info(`pack ${pack.label}: ${pack.songs.length} songs`);

    for (const song of pack.songs) {
      const result = convertSong(song, packDir, settings, options, logger);
      converted += result.converted;
      failed += result.failed;
    }
  }

  if (discovery.loose.length > 0) {
    logger.warn(`${discovery.loose.length} loose chart files ignored: put each song in its own folder`);
  }

  logger.info(`${converted} songs converted, ${failed} skipped`);
  return { converted, failed };
}

function convertSong(
  entry: SongEntry,
  outputDir: string,
  settings: Record<string, unknown>,
  options: CliOptions,
  logger: Logger,
): RunResult {
  const outcome = loadStepManiaSong(entry.directory);
  for (const warning of outcome.warnings) logger.warn(warning, entry.label);

  if (outcome.song === null) {
    logger.error(`skipped: ${outcome.reason}`, entry.label);
    return { converted: 0, failed: 1 };
  }

  const song = outcome.song;
  const setHash = setSettingsHash(song, settings);
  const outputPath = join(outputDir, setFileName(song, setHash));

  const written = packageSong(song, {
    versionHash: setHash,
    creator: song.metadata.credit ?? "converted",
    audioFileName: song.assets.audio,
    minHoldBeats: options.minHoldBeats,
    outputPath,
  });

  for (const version of written.versions) logger.info(`${version} -> ${outputPath}`, entry.label);
  return { converted: 1, failed: 0 };
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "pack";
}

/**
 * Options the spec requires but that are not wired up yet. Saying so out loud
 * is better than accepting a flag and silently doing nothing with it.
 */
function warnAboutUnimplementedOptions(options: CliOptions, logger: Logger): void {
  if (options.keys.length > 0) {
    logger.warn("--keys is not implemented yet, converting at the source key count");
  }
  if (options.stopEmulation) {
    logger.warn("--stop-emulation is not implemented yet, stops only shift note times");
  }
  if (options.rollAsTaps) {
    logger.warn("--roll-taps is not implemented yet, rolls become holds");
  }
}

/** Entry point: runs the conversion and sets the exit code (spec section 11). */
export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const logger = new Logger();
  const result = run(argv, logger);
  return result.failed > 0 && result.converted === 0 ? 1 : 0;
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  process.exitCode = main();
}