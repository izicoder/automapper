import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import {
  INNER_SEPARATOR,
  isInside,
  jobsFromDiscovery,
  safeName,
  settingsOf,
  type ConversionJob,
  type JobKind,
} from "../cli/jobs.js";
import type { CliOptions } from "../cli/options.js";
import type { Chart } from "../ir/types.js";
import { fileNameFor, setFileName, setSettingsHash, settingsHashOf } from "../osu/naming.js";
import {
  ARCHIVE_STATE_FILE,
  archiveStamp,
  isArchiveProcessed,
  readArchiveState,
  settingsFingerprint,
} from "../package/archive.js";
import { discover, type Discovery } from "../package/layout.js";
import { loadStepManiaSong } from "../parsers/stepmania.js";
import { CONVERTER_VERSION } from "../version.js";
import { peekArchive, type ArchiveSong } from "./archive-scan.js";

/** One chart as the left panel shows it, before any conversion happens. */
export interface ScannedChart {
  name: string;
  stepType: string;
  keyCount: number;
  notes: number;
}

export type ScanOrigin = "input" | "drop";

export interface ScannedSong {
  id: string;
  kind: JobKind;
  label: string;
  pack?: string;
  origin: ScanOrigin;
  /** Archive this song lives in, when it is not a folder on disk. */
  archive?: string;
  title?: string;
  artist?: string;
  charts: ScannedChart[];
  /** Set when the folder cannot become a song; the reason is shown instead. */
  error?: string;
  warnings: string[];
  /** The .osz these options would write, and whether OUTPUT/ already holds it. */
  expectedOsz?: string;
  converted: boolean;
}

export interface ScannedArchive {
  id: string;
  label: string;
  origin: ScanOrigin;
  /** True when the archive was already unpacked with these settings. */
  converted: boolean;
  /** Songs the archive holds, counted without unpacking it. */
  songCount: number;
  /** Set when the zip cannot be read at all. */
  error?: string;
}

export interface ScannedIgnored {
  label: string;
  reason: string;
}

export interface ScanResult {
  songs: ScannedSong[];
  archives: ScannedArchive[];
  ignored: ScannedIgnored[];
  /** Total songs that would be written, for the progress bar. */
  total: number;
}

export interface ScanOptions {
  inputDir: string;
  outputDir: string;
  /** Staging folder for dropped items, or null when nothing was dropped. */
  stageDir: string | null;
  /** Options the marks are computed for; the form sends its current state. */
  options: CliOptions;
}

/**
 * Everything the left panel lists: songs from INPUT/ plus songs staged from a
 * drop, grouped by pack, and the archives that will be unpacked on convert.
 *
 * Songs are parsed here so key counts are known before converting, and the
 * expected .osz name is hashed with the same code the writer uses, so a row
 * can show whether OUTPUT/ already holds this exact result (spec 7).
 */
export function scan(options: ScanOptions): { result: ScanResult; jobs: ConversionJob[] } {
  const sources: { discovery: Discovery; origin: ScanOrigin }[] = [
    { discovery: discover(options.inputDir), origin: "input" },
  ];
  if (options.stageDir !== null) {
    sources.push({ discovery: discover(options.stageDir), origin: "drop" });
  }

  const settings = settingsOf(options.options);
  const statePath = join(options.outputDir, ARCHIVE_STATE_FILE);
  const archiveState = readArchiveState(statePath);

  const result: ScanResult = { songs: [], archives: [], ignored: [], total: 0 };
  const jobs: ConversionJob[] = [];

  for (const { discovery, origin } of sources) {
    const sourceJobs = jobsFromDiscovery(discovery);
    jobs.push(
      ...sourceJobs.map((job) =>
        origin === "drop" && job.kind === "archive" ? { ...job, transient: true } : job,
      ),
    );

    for (const job of sourceJobs) {
      if (job.kind === "archive") {
        const contents = peekArchive(job.id, {
          ...(options.options.assumeKeys === undefined
            ? {}
            : { assumeKeys: options.options.assumeKeys }),
        });

        result.archives.push({
          id: job.id,
          label: job.label,
          origin,
          converted: isArchiveProcessed(archiveState, job.id, {
            ...archiveStamp(job.id),
            settings: settingsFingerprint(settings, CONVERTER_VERSION),
          }),
          songCount: contents.songs.length,
          ...(contents.error === undefined ? {} : { error: contents.error }),
        });

        for (const song of contents.songs) {
          result.songs.push(archiveSong(job, song, origin, options, settings));
        }
        for (const entry of contents.ignored) {
          result.ignored.push({ label: `${job.label}: ${entry}`, reason: "too deeply nested" });
        }
        continue;
      }

      const song = scanSong(job, origin, options, settings);
      result.songs.push(song);
      result.total += 1;
    }

    for (const archive of discovery.unsupportedArchives) {
      result.ignored.push({ label: basename(archive), reason: "only .zip archives are unpacked" });
    }
    for (const path of discovery.skipped) {
      result.ignored.push({ label: basename(path), reason: "not a chart file or song folder" });
    }
  }

  return { result, jobs };
}

function scanSong(
  job: ConversionJob,
  origin: ScanOrigin,
  scanOptions: ScanOptions,
  settings: Record<string, unknown>,
): ScannedSong {
  const base = {
    id: job.id,
    kind: job.kind,
    label: job.label,
    origin,
    converted: false,
    ...(job.pack === undefined ? {} : { pack: job.pack }),
  };

  const outcome = loadStepManiaSong(job.directory, {
    ...(scanOptions.options.assumeKeys === undefined
      ? {}
      : { assumeKeys: scanOptions.options.assumeKeys }),
    ...(job.chartFile === undefined ? {} : { chartFile: job.chartFile }),
  });

  if (outcome.song === null) {
    return {
      ...base,
      charts: [],
      warnings: outcome.warnings,
      error: outcome.reason ?? "cannot be converted",
    };
  }

  const expectedOsz = setFileName(outcome.song, setSettingsHash(outcome.song, settings));
  const outputDir =
    job.pack === undefined ? scanOptions.outputDir : join(scanOptions.outputDir, safeName(job.pack));

  return {
    ...base,
    title: outcome.song.metadata.title,
    artist: outcome.song.metadata.artist,
    charts: outcome.song.charts.map(summarise),
    warnings: outcome.warnings,
    expectedOsz,
    converted: existsSync(join(outputDir, expectedOsz)),
  };
}

function summarise(chart: Chart): ScannedChart {
  return {
    name: chart.meta.name,
    stepType: chart.meta.stepType,
    keyCount: chart.keyCount,
    notes: chart.notes.length,
  };
}

/**
 * A song that lives inside an archive. Its id carries the song folder inside
 * the zip, so one song can be converted without unpacking the rest.
 * The expected .osz name uses the same hash code as the writer.
 */
function archiveSong(
  job: ConversionJob,
  song: ArchiveSong,
  origin: ScanOrigin,
  scanOptions: ScanOptions,
  settings: Record<string, unknown>,
): ScannedSong {
  const base = {
    id: `${job.id}${INNER_SEPARATOR}${song.inner}`,
    kind: song.pack === undefined ? ("song" as const) : ("pack-song" as const),
    label: song.label,
    origin,
    archive: job.id,
    converted: false,
    ...(song.pack === undefined ? {} : { pack: song.pack }),
  };

  if (song.error !== undefined || song.charts.length === 0) {
    return {
      ...base,
      charts: [],
      warnings: song.warnings,
      error: song.error ?? "cannot be converted",
    };
  }

  const expectedOsz = fileNameFor(
    song.artist ?? "",
    song.title ?? "",
    settingsHashOf(
      {
        title: song.title ?? "",
        artist: song.artist ?? "",
        chartTexts: song.charts.map((chart) => chart.sourceText),
      },
      settings,
    ),
  );
  const outputDir =
    song.pack === undefined ? scanOptions.outputDir : join(scanOptions.outputDir, safeName(song.pack));

  return {
    ...base,
    title: song.title,
    artist: song.artist,
    charts: song.charts.map((chart) => ({
      name: chart.name,
      stepType: chart.stepType,
      keyCount: chart.keyCount,
      notes: chart.notes,
    })),
    warnings: song.warnings,
    expectedOsz,
    converted: existsSync(join(outputDir, expectedOsz)),
  };
}

/** True when a job belongs to the drop staging folder. */
export function isDropped(job: ConversionJob, stageDir: string | null): boolean {
  return stageDir !== null && isInside(job.id, stageDir);
}
