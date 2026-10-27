import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { Logger } from "../log.js";
import { discover, type Discovery, type SongEntry } from "../package/layout.js";
import { packageSong } from "../package/osz.js";
import {
  ARCHIVE_STATE_FILE,
  archiveStamp,
  extractZip,
  isArchiveProcessed,
  readArchiveState,
  settingsFingerprint,
  writeArchiveState,
  type ArchiveStamp,
} from "../package/archive.js";
import { chartSettingsHash, setFileName, setSettingsHash } from "../osu/naming.js";
import { ensureInputDir, ensureOutputDir } from "../paths.js";
import { loadStepManiaSong } from "../parsers/stepmania.js";
import type { Chart, Song } from "../ir/types.js";
import { automapChart } from "../transform/automap.js";
import { nearestLegalKeyCount } from "../keys.js";
import { CONVERTER_VERSION } from "../version.js";
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
    assumeKeys: options.assumeKeys,
    seed: options.seed,
  };

  let converted = 0;
  let failed = 0;
  const record = (result: RunResult): void => {
    converted += result.converted;
    failed += result.failed;
  };

  record(convertDiscovery(discovery, outputDir, settings, options, logger));

  for (const archive of discovery.archives) {
    record(convertArchive(archive, outputDir, settings, options, logger));
  }
  for (const archive of discovery.unsupportedArchives) {
    logger.warn(`unsupported archive, unpack it yourself: ${basename(archive)}`);
  }

  logger.info(`${converted} songs converted, ${failed} skipped`);
  return { converted, failed };
}

/** Converts one discovery result: songs, packs and loose chart files. */
function convertDiscovery(
  discovery: Discovery,
  outputDir: string,
  settings: Record<string, unknown>,
  options: CliOptions,
  logger: Logger,
): RunResult {
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

  // Loose chart files in INPUT/ are one-file songs (spec section 5).
  for (const file of discovery.loose) {
    const result = convertSong(
      { directory: dirname(file), label: basename(file) },
      outputDir,
      settings,
      options,
      logger,
      { chartFile: basename(file) },
    );
    converted += result.converted;
    failed += result.failed;
  }

  return { converted, failed };
}

/**
 * Unpacks one archive, converts its contents and removes the unpacked copy.
 * Archives already converted with the same settings are skipped, so adding a
 * new pack does not reprocess the old ones.
 */
function convertArchive(
  archivePath: string,
  outputDir: string,
  settings: Record<string, unknown>,
  options: CliOptions,
  logger: Logger,
): RunResult {
  const label = basename(archivePath);
  const stamp: ArchiveStamp = {
    ...archiveStamp(archivePath),
    settings: settingsFingerprint(settings, CONVERTER_VERSION),
  };
  const statePath = join(outputDir, ARCHIVE_STATE_FILE);
  const state = readArchiveState(statePath);

  if (!options.force && isArchiveProcessed(state, archivePath, stamp)) {
    logger.info("archive already converted, skipping", label);
    return { converted: 0, failed: 0 };
  }

  const unpackDir = mkdtempSync(join(tmpdir(), "automapper-unpack-"));
  try {
    logger.info("unpacking archive", label);
    const extracted = extractZip(archivePath, unpackDir);
    for (const entry of extracted.skipped) {
      logger.warn(`skipped unsafe archive entry: ${entry}`, label);
    }

    const discovery = discover(unpackDir);
    if (discovery.archives.length > 0) {
      logger.warn(
        `${discovery.archives.length} nested archive(s) ignored: unpack them into INPUT/`,
        label,
      );
    }
    if (discovery.unsupportedArchives.length > 0) {
      logger.warn(
        `${discovery.unsupportedArchives.length} unsupported archive(s) ignored: only .zip is supported`,
        label,
      );
    }
    if (
      discovery.songs.length === 0 &&
      discovery.packs.length === 0 &&
      discovery.loose.length === 0
    ) {
      logger.warn("archive has no songs", label);
    }

    const result = convertDiscovery(discovery, outputDir, settings, options, logger);

    state[archivePath] = stamp;
    writeArchiveState(statePath, state);
    return result;
  } catch (error) {
    logger.error(`archive failed: ${(error as Error).message}`, label);
    return { converted: 0, failed: 1 };
  } finally {
    rmSync(unpackDir, { recursive: true, force: true });
  }
}

function convertSong(
  entry: SongEntry,
  outputDir: string,
  settings: Record<string, unknown>,
  options: CliOptions,
  logger: Logger,
  loadOptions: { chartFile?: string } = {},
): RunResult {
  const outcome = loadStepManiaSong(entry.directory, {
    assumeKeys: options.assumeKeys,
    ...loadOptions,
  });
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

  // One difficulty per key count and name (osu! names difficulties by that
  // pair). A chart the source already has wins over an automapped twin, and
  // two sources landing on the same count and name keep only the first.
  const sources = [...charts];
  const taken = new Set(charts.map((chart) => `${chart.keyCount}|${chart.meta.name}`));

  for (const target of options.keys) {
    for (const chart of sources) {
      if (target === chart.keyCount) continue; // identity conversion is the source chart

      const key = `${target}|${chart.meta.name}`;
      if (taken.has(key)) {
        logger.warn(
          `${chart.meta.name}: ${target}K version already exists, automapped one skipped`,
          label,
        );
        continue;
      }

      const result = automapChart(chart, target);
      for (const warning of result.warnings) {
        logger.warn(`${chart.meta.name}: ${warning}`, label);
      }
      taken.add(key);
      charts.push(result.chart);
    }
  }

  return charts;
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "pack";
}

/** Entry point: runs the conversion and sets the exit code (spec section 11). */
export function main(
  argv: readonly string[] = process.argv.slice(2),
  logger: Logger = new Logger(),
  dirs?: RunDirs,
): number {
  const result = run(argv, logger, dirs);
  // Any skipped song is a partial failure, and the exit code must say so.
  return result.failed > 0 ? 1 : 0;
}

// Only run when invoked directly, not when imported by tests.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  process.exitCode = main();
}
