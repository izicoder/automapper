/** How many songs a run converted and how many it skipped. */
export interface RunResult {
  converted: number;
  failed: number;
}

/** Where to read from and write to; defaults to INPUT/ and OUTPUT/ (spec 2.4-2.5). */
export interface RunDirs {
  input: string;
  output: string;
}

/** Progress of one run, reported after every job. */
export interface RunProgress extends RunResult {
  done: number;
  total: number;
}
