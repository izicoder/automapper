import type { ConversionJob } from "../cli/jobs.js";
import type { RunDirs, RunResult } from "../cli/types.js";

/** Everything the UI server hands to a conversion worker. */
export interface WorkerRequest {
  /** Command line built from the form, already validated by `parseArgs`. */
  argv: string[];
  dirs: RunDirs;
  jobs: ConversionJob[];
}

/** Worker -> server messages: log lines, progress, the final result. */
export type WorkerMessage =
  | { type: "log"; line: string }
  | ({ type: "progress" } & RunResult & { done: number; total: number })
  | ({ type: "done" } & RunResult)
  | { type: "error"; message: string };
