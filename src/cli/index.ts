import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { Logger } from "../log.js";
import { discover, type SongEntry } from "../package/layout.js";
import { packageSong } from "../package/osz.js";
import { chartSettingsHash, setFileName, setSettingsHash } from "../osu/naming.js";
import { ensureInputDir, ensureOutputDir } from "../paths.js";
import { loadStepManiaSong } from "../parsers/stepmania.js";
import type { Chart, Song } from "../ir/types.js";
import { automapChart } from "../transform/automap.js";
import { nearestLegalKeyCount } from "../keys.js";
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

  const settings: Record<string, unknown> = {
    keys: options.keys,
    minHoldBeats: options.minHoldBeats,
    stopEmulation: options.stopEmulation,
    rollAsTaps: options.rollAsTaps,
    rollTapBeats: options.rollTapBeats,
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

  try {
    const charts = buildCharts(song, options, logger, entry.label);
    const outputPath = join(outputDir, setFileName(song, setSettingsHash(song, settings)));

    const written = packageSong(song, charts, {
      creator: song.metadata.credit ?? "converted",
      audioFileName: song.assets.audio,
      minHoldBeats: options.minHoldBeats,
      rollAsTaps: options.rollAsTaps,
      rollTapBeats: options.rollTapBeats,
      stopEmulation: options.stopEmulation,
      outputPath,
      hashForChart: (chart) => chartSettingsHash(song, chart, settings),
    });

    for (const version of written.versions) logger.info(`${version} -> ${outputPath}`, entry.label);
    return { converted: 1, failed: 0 };
  } catch (error) {
    // One broken song must never abort a pack (spec section 5).
    logger.error(`skipped: ${(error as Error).message}`, entry.label);
    return { converted: 0, failed: 1 };
  }
}

/** Source difficulties plus one automapped difficulty per requested key count. */
export function buildCharts(
  song: Song,
  options: CliOptions,
  logger: Logger,
  label: string,
): Chart[] {
  // A source key count outside osu!mania's range is mapped to the nearest
  // legal one; the input chart itself is always accepted (spec section 5).
  const charts: Chart[] = [];
  for (const chart of song.charts) {
    const legal = nearestLegalKeyCount(chart.keyCount);
    if (legal === chart.keyCount) {
      charts.push(chart);
      continue;
    }

    const result = automapChart(chart, legal);
    for (const warning of result.warnings) logger.warn(`${chart.meta.name}: ${warning}`, label);
    logger.warn(
      `${chart.meta.name}: ${chart.keyCount}K is not an osu!mania key count, mapped to ${legal}K`,
      label,
    );
    charts.push(result.chart);
  }

  for (const target of options.keys) {
    for (const chart of charts) {
      if (target === chart.keyCount) continue; // identity conversion is the source chart
      const result = automapChart(chart, target);
      for (const warning of result.warnings) {
        logger.warn(`${chart.meta.name}: ${warning}`, label);
      }
      charts.push(result.chart);
    }
  }

  return charts;
}

/** Turns an automapper warning into a log line without losing the chart name. */
export function logAutomapWarnings(
  warnings: readonly string[],
  chartName: string,
  logger: Logger,
  context?: string,
): void {
  for (const warning of warnings) logger.warn(`${chartName}: ${warning}`, context);
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "pack";
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
