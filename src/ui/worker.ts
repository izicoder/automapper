import { parentPort, workerData } from "node:worker_threads";

import { runJobs } from "../cli/jobs.js";
import { parseArgs } from "../cli/options.js";
import { Logger } from "../log.js";
import type { WorkerMessage, WorkerRequest } from "./protocol.js";

/**
 * Runs one conversion off the main thread so the page keeps answering while a
 * big INPUT/ converts, and streams every log line back as it happens (spec 7).
 *
 * This module is only ever loaded as a worker; `parentPort` is null otherwise.
 */
if (parentPort !== null) {
  const port = parentPort;
  const request = workerData as WorkerRequest;

  try {
    const options = parseArgs(request.argv);
    const logger = new Logger(options.verbose ? "debug" : "info", (line) =>
      port.postMessage({ type: "log", line } satisfies WorkerMessage),
    );

    const result = runJobs(request.jobs, options, request.dirs, logger, (progress) => {
      port.postMessage({ type: "progress", ...progress } satisfies WorkerMessage);
    });

    port.postMessage({ type: "done", ...result } satisfies WorkerMessage);
  } catch (error) {
    port.postMessage({
      type: "error",
      message: (error as Error).message,
    } satisfies WorkerMessage);
  }
}
