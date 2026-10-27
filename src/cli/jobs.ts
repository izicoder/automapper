import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { Logger } from "../log.js";
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
import { discover, type Discovery } from "../package/layout.js";
import { packageSong } from "../package/osz.js";
import { chartSettingsHash, setFileName, setSettingsHash } from "../osu/naming.js";
import { loadStepManiaSong } from "../parsers/stepmania.js";
import { CONVERTER_VERSION } from "../version.js";
import { buildCharts } from "./charts.js";
import type { CliOptions } from "./options.js";
import type { RunDirs, RunProgress, RunResult } from "./types.js";

export type JobKind = "song" | "pack-song" | "loose" | "archive";

/**
 * One unit of work: a song folder, a song inside a pack, a loose chart file or
 * an archive. The CLI runs every job it finds, the UI runs the selected ones.
 * Jobs are plain data so they can be handed to a worker thread.
 */
export interface ConversionJob {
  /** Stable id for selection: the absolute path of the song folder or file. */
  id: string;
  kind: JobKind;
  label: string;
  /** Pack folder name when the song lives inside a pack. */
  pack?: string;
  /** Song folder (loose files: the folder holding the chart). */
  directory: string;
  /** Set for loose chart files, which are one-file songs (spec section 5). */
  chartFile?: string;
  /** Logged before the job runs: the pack header line. */
  prelude?: string;
  /**
   * A dropped archive: always converted, and no entry is kept in the archive
   * state file, since its staged path disappears with the staging folder.
   */
  transient?: boolean;
  /**
   * For archives: only convert these songs (folders inside the zip, forward
   * slashes). Undefined converts the whole archive.
   */
  songs?: string[];
}

/**
 * Turns a discovery result into the ordered job list the CLI has always run:
 * songs, then pack songs, then loose files, then archives.
 */
export function jobsFromDiscovery(
  discovery: Discovery,
  options: { transientRoot?: string } = {},
): ConversionJob[] {
  const jobs: ConversionJob[] = [];

  for (const song of discovery.songs) {
    jobs.push({
      id: song.directory,
      kind: "song",
      label: song.label,
      directory: song.directory,
    });
  }

  for (const pack of discovery.packs) {
    pack.songs.forEach((song, index) => {
      jobs.push({
        id: song.directory,
        kind: "pack-song",
        label: song.label,
        pack: pack.label,
        directory: song.directory,
        ...(index === 0 ? { prelude: `pack ${pack.label}: ${pack.songs.length} songs` } : {}),
      });
    });
  }

  for (const file of discovery.loose) {
    jobs.push({
      id: file,
      kind: "loose",
      label: basename(file),
      directory: dirname(file),
      chartFile: basename(file),
    });
  }

  const transientRoot = options.transientRoot;
  for (const archive of discovery.archives) {
    jobs.push({
      id: archive,
      kind: "archive",
      label: basename(archive),
      directory: dirname(archive),
      ...(transientRoot !== undefined && isInside(archive, transientRoot)
        ? { transient: true }
        : {}),
    });
  }

  return jobs;
}

/** Separates an archive path from a song folder inside it. */
export const INNER_SEPARATOR = "::";

/**
 * Picks the jobs a selection refers to. Plain ids select one job; an id of the
 * form `archive::song/folder` selects a single song inside an archive, which
 * still unpacks the archive only once (spec 7).
 */
export function selectJobs(
  jobs: readonly ConversionJob[],
  ids: readonly string[],
): ConversionJob[] {
  if (ids.length === 0) return [...jobs];

  const wanted = new Set(ids);
  const innerByArchive = new Map<string, string[]>();

  for (const id of ids) {
    const split = id.indexOf(INNER_SEPARATOR);
    if (split <= 0) continue;
    const archive = id.slice(0, split);
    const inner = id.slice(split + INNER_SEPARATOR.length);
    const list = innerByArchive.get(archive);
    if (list === undefined) innerByArchive.set(archive, [inner]);
    else if (!list.includes(inner)) list.push(inner);
  }

  const picked: ConversionJob[] = [];
  for (const job of jobs) {
    if (wanted.has(job.id)) {
      picked.push(job);
      continue;
    }
    const songs = innerByArchive.get(job.id);
    if (songs !== undefined) picked.push({ ...job, songs });
  }
  return picked;
}

/** Converts every job once, reporting progress after each one. */
export function runJobs(
  jobs: readonly ConversionJob[],
  options: CliOptions,
  dirs: RunDirs,
  logger: Logger,
  onProgress?: (progress: RunProgress) => void,
): RunResult {
  let converted = 0;
  let failed = 0;

  for (const [index, job] of jobs.entries()) {
    if (job.prelude !== undefined) logger.info(job.prelude);

    const result = convertJob(job, options, dirs, logger);
    converted += result.converted;
    failed += result.failed;

    onProgress?.({ converted, failed, done: index + 1, total: jobs.length });
  }

  return { converted, failed };
}

export function convertJob(
  job: ConversionJob,
  options: CliOptions,
  dirs: RunDirs,
  logger: Logger,
): RunResult {
  if (job.kind === "archive") return convertArchiveJob(job, options, dirs, logger);

  const outputDir = job.pack === undefined ? dirs.output : join(dirs.output, safeName(job.pack));
  return convertSong(job, outputDir, options, logger);
}

function convertSong(
  job: ConversionJob,
  outputDir: string,
  options: CliOptions,
  logger: Logger,
): RunResult {
  const outcome = loadStepManiaSong(job.directory, {
    assumeKeys: options.assumeKeys,
    ...(job.chartFile === undefined ? {} : { chartFile: job.chartFile }),
  });
  for (const warning of outcome.warnings) logger.warn(warning, job.label);

  if (outcome.song === null) {
    logger.error(`skipped: ${outcome.reason}`, job.label);
    return { converted: 0, failed: 1 };
  }

  const song = outcome.song;

  try {
    const charts = buildCharts(song, options, logger, job.label);
    const settings = settingsOf(options);
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

    for (const version of written.versions) {
      logger.info(`${version} -> ${outputPath}`, job.label);
    }
    return { converted: 1, failed: 0 };
  } catch (error) {
    // One broken song must never abort a pack (spec section 5).
    logger.error(`skipped: ${(error as Error).message}`, job.label);
    return { converted: 0, failed: 1 };
  }
}

/**
 * Unpacks one archive, converts its contents and removes the unpacked copy.
 * Archives already converted with the same settings are skipped, so adding a
 * new pack does not reprocess the old ones.
 */
function convertArchiveJob(
  job: ConversionJob,
  options: CliOptions,
  dirs: RunDirs,
  logger: Logger,
): RunResult {
  const statePath = join(dirs.output, ARCHIVE_STATE_FILE);
  const stamp: ArchiveStamp = {
    ...archiveStamp(job.id),
    settings: settingsFingerprint(settingsOf(options), CONVERTER_VERSION),
  };
  const state = readArchiveState(statePath);

  if (!options.force && !job.transient && isArchiveProcessed(state, job.id, stamp)) {
    logger.info("archive already converted, skipping", job.label);
    return { converted: 0, failed: 0 };
  }

  const unpackDir = mkdtempSync(join(tmpdir(), "automapper-unpack-"));
  try {
    logger.info("unpacking archive", job.label);
    const extracted = extractZip(job.id, unpackDir);
    for (const entry of extracted.skipped) {
      logger.warn(`skipped unsafe archive entry: ${entry}`, job.label);
    }

    const discovery = discover(unpackDir);
    if (discovery.archives.length > 0) {
      logger.warn(
        `${discovery.archives.length} nested archive(s) ignored: unpack them into INPUT/`,
        job.label,
      );
    }
    if (discovery.unsupportedArchives.length > 0) {
      logger.warn(
        `${discovery.unsupportedArchives.length} unsupported archive(s) ignored: only .zip is supported`,
        job.label,
      );
    }
    if (
      discovery.songs.length === 0 &&
      discovery.packs.length === 0 &&
      discovery.loose.length === 0
    ) {
      logger.warn("archive has no songs", job.label);
    }

    // Archives inside archives are ignored (spec section 5).
    const innerJobs = jobsFromDiscovery(discovery).filter((inner) => inner.kind !== "archive");
    const selected =
      job.songs === undefined
        ? innerJobs
        : innerJobs.filter((inner) => job.songs!.includes(relativeTo(unpackDir, inner)));
    if (job.songs !== undefined && selected.length < innerJobs.length) {
      logger.info(
        `partial selection: ${selected.length} of ${innerJobs.length} songs`,
        job.label,
      );
    }
    const result = runJobs(selected, options, dirs, logger);

    // Only an archive whose songs all ran counts as unpacked, so a partly
    // converted zip is processed again instead of being skipped (spec 7).
    const complete = job.songs === undefined || selected.length === innerJobs.length;
    if (!job.transient && complete) {
      state[job.id] = stamp;
      writeArchiveState(statePath, state);
    }
    return result;
  } catch (error) {
    logger.error(`archive failed: ${(error as Error).message}`, job.label);
    return { converted: 0, failed: 1 };
  } finally {
    rmSync(unpackDir, { recursive: true, force: true });
  }
}

/** Everything that ends up in the content hashes (spec section 7). */
export function settingsOf(options: CliOptions): Record<string, unknown> {
  return {
    keys: options.keys,
    minHoldBeats: options.minHoldBeats,
    stopEmulation: options.stopEmulation,
    rollAsTaps: options.rollAsTaps,
    rollTapBeats: options.rollTapBeats,
    assumeKeys: options.assumeKeys,
    seed: options.seed,
  };
}

/** Pack output folder names, with the characters Windows rejects removed. */
export function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "pack";
}

/** True when `path` sits inside `root` (used to spot staged files). */
export function isInside(path: string, root: string): boolean {
  const normalise = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalise(path).startsWith(`${normalise(root)}/`);
}

/** A song's folder inside an unpacked archive, with forward slashes. */
export function relativeTo(root: string, job: ConversionJob): string {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const path =
    job.chartFile === undefined ? job.directory : `${job.directory}/${job.chartFile}`;
  const normalised = path.replace(/\\/g, "/");
  return normalised.startsWith(`${base}/`) ? normalised.slice(base.length + 1) : normalised;
}
