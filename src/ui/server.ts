import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { runJobs, selectJobs, type ConversionJob } from "../cli/jobs.js";
import {
  argvFromOptions,
  CliError,
  DEFAULT_OPTIONS,
  parseArgs,
  USAGE,
  type CliOptions,
} from "../cli/options.js";
import type { RunDirs } from "../cli/types.js";
import { Logger } from "../log.js";
import { appendToLogFile, prepareLogFile } from "../log-file.js";
import { ensureInputDir, ensureOutputDir } from "../paths.js";
import { openFolder, openUrl } from "./open.js";
import type { WorkerMessage, WorkerRequest } from "./protocol.js";
import { scan, type ScanResult } from "./scan.js";
import { DropStage } from "./stage.js";
import { watchForChanges } from "./watch.js";
import { IN_SEA, isMainModule, readBundled, readBundledText, readFrom } from "../runtime.js";

/** Options as the form sends them: loose, strings allowed, validated below. */
export type FormValues = Record<string, unknown>;

/** Runs a conversion and reports messages as they happen. */
export type ConversionRunner = (
  request: WorkerRequest,
  onMessage: (message: WorkerMessage) => void,
) => Promise<void>;

export interface UiServerOptions {
  input: string;
  output: string;
  /** 0 picks a free port (default). */
  port?: number;
  host?: string;
  /** Open the browser once the server listens. */
  openBrowser?: boolean;
  /** Swappable for tests, which convert in-process. */
  runner?: ConversionRunner;
  /** Fixed staging folder, for tests; otherwise created on the first drop. */
  stageDir?: string;
}

export interface UiServer {
  url: string;
  port: number;
  /** Current staging folder, or null when nothing was dropped. */
  stageDir(): string | null;
  close(): Promise<void>;
}const PAGE_DIR = IN_SEA ? "" : fileURLToPath(new URL("./page/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * The local UI server (spec section 7): one page, the discovered charts, the
 * CLI options and a streamed log. It binds to loopback only and holds no
 * storage of its own beyond the temporary drop folder.
 */
export function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const dirs: RunDirs = { input: options.input, output: options.output };
  const host = options.host ?? "127.0.0.1";
  const runner = options.runner ?? workerRunner;

  let stage: DropStage | null = null;
  const ownsStage = options.stageDir === undefined;
  if (options.stageDir !== undefined) stage = DropStage.at(options.stageDir);

  const clients = new Set<ServerResponse>();
  let running = false;
  let scanPending = false;
  let lastScan: ScanResult | null = null;
  let lastJobs: ConversionJob[] = [];
  let lastValues: FormValues | undefined;
  const stops: (() => void)[] = [];

  function stageDir(): string | null {
    return stage?.dir ?? null;
  }

  function ensureStage(): DropStage {
    if (stage === null) {
      stage = DropStage.create();
      watch(stage.dir);
    }
    return stage;
  }

  /** Follows a folder so the list updates itself, without a rescan button. */
  function watch(dir: string): void {
    stops.push(
      watchForChanges([dir], () => {
        // A running conversion is already logged and rescanned when it ends.
        if (running) {
          scanPending = true;
          return;
        }
        broadcastScan();
      }),
    );
  }

  function send(event: string, data: unknown): void {
    // Every log line also lands in automapper.log, clients or not.
    if (event === "log") appendToLogFile((data as { line: string }).line);
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(payload);
  }

  function optionsFrom(values: FormValues): CliOptions {
    const number = (key: string, fallback: number): number => {
      const raw = values[key];
      if (raw === undefined || raw === null || raw === "") return fallback;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) throw new CliError(`${key} needs a number`);
      return parsed;
    };
    const flag = (key: string, fallback: boolean): boolean =>
      values[key] === undefined ? fallback : values[key] === true || values[key] === "true";

    const rawKeys = values.keys;
    let keys: number[] = DEFAULT_OPTIONS.keys;
    if (typeof rawKeys === "string") {
      keys = rawKeys.trim() === "" ? [] : rawKeys.split(",").map((part) => Number(part.trim()));
    } else if (Array.isArray(rawKeys)) {
      keys = rawKeys.map((part) => Number(part));
    }

    const rawAssume = values.assumeKeys;
    const assumeKeys =
      rawAssume === undefined || rawAssume === null || rawAssume === ""
        ? undefined
        : Number(rawAssume);

    // The argv built here goes back through parseArgs, so a control can never
    // accept something the CLI would reject (spec 7).
    return {
      keys,
      minHoldBeats: number("minHoldBeats", DEFAULT_OPTIONS.minHoldBeats),
      stopEmulation: flag("stopEmulation", DEFAULT_OPTIONS.stopEmulation),
      rollAsTaps: flag("rollAsTaps", DEFAULT_OPTIONS.rollAsTaps),
      rollTapBeats: number("rollTapBeats", DEFAULT_OPTIONS.rollTapBeats),
      ...(assumeKeys === undefined ? {} : { assumeKeys }),
      force: flag("force", DEFAULT_OPTIONS.force),
      seed: number("seed", DEFAULT_OPTIONS.seed),
      verbose: flag("verbose", DEFAULT_OPTIONS.verbose),
      help: false,
    };
  }

  function currentOptions(values: FormValues | undefined): CliOptions {
    const candidate = optionsFrom(values ?? {});
    // Round-trip through the real parser: same rules, same error messages.
    return parseArgs(argvFromOptions(candidate));
  }

  function scanNow(values: FormValues | undefined): ScanResult {
    lastValues = values ?? lastValues;
    const scanned = scan({
      inputDir: dirs.input,
      outputDir: dirs.output,
      stageDir: stageDir(),
      options: currentOptions(lastValues),
    });
    lastScan = scanned.result;
    lastJobs = scanned.jobs;
    return scanned.result;
  }

  /** Pushes a fresh list to every open page (spec 7: no manual rescan). */
  function broadcastScan(): void {
    try {
      const result = scanNow(lastValues);
      send("scan", { ...result, argv: argvFromOptions(currentOptions(lastValues)) });
    } catch (error) {
      send("log", { line: `ERROR scan failed: ${(error as Error).message}` });
    }
  }

  async function prepareConversion(
    values: FormValues | undefined,
    ids: unknown,
  ): Promise<{ argv: string[]; jobs: ConversionJob[] }> {
    if (running) throw new HttpError(409, "a conversion is already running");

    const parsed = currentOptions(values);
    const argv = argvFromOptions(parsed);

    const selected = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    if (lastScan === null) scanNow(values);

    let jobs = selectJobs(lastJobs, selected);
    if (jobs.length === 0 && selected.length > 0) {
      // The selection outlived the last scan (a drop or a new folder): rescan.
      scanNow(values);
      jobs = selectJobs(lastJobs, selected);
    }
    if (jobs.length === 0) throw new HttpError(400, "nothing to convert");

    running = true;
    return { argv, jobs };
  }

  async function runConversion(argv: string[], jobs: ConversionJob[]): Promise<void> {
    send("status", { running, done: 0, total: jobs.length, converted: 0, failed: 0 });

    let converted = 0;
    let failed = 0;

    try {
      await runner({ argv, dirs, jobs }, (message) => {
        if (message.type === "log") {
          send("log", { line: message.line });
        } else if (message.type === "progress") {
          converted = message.converted;
          failed = message.failed;
          send("status", {
            running,
            done: message.done,
            total: message.total,
            converted,
            failed,
          });
        } else if (message.type === "error") {
          failed += 1;
          send("log", { line: `ERROR ${message.message}` });
        }
      });
    } catch (error) {
      failed += 1;
      send("log", { line: `ERROR ${(error as Error).message}` });
    } finally {
      running = false;
      send("done", { converted, failed, total: jobs.length });
      send("status", { running, done: jobs.length, total: jobs.length, converted, failed });
      // Results just landed in OUTPUT/, and anything changed during the run
      // still has to show up: refresh the list for every open page.
      scanPending = false;
      broadcastScan();
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    const path = decodeURIComponent(url.pathname);

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) {
        return servePage(res, "index.html");
      }
      if (req.method === "GET" && (path === "/app.js" || path === "/style.css")) {
        return servePage(res, path.slice(1));
      }
      if (req.method === "GET" && path === "/api/help") {
        return text(res, 200, USAGE);
      }
      if (req.method === "GET" && path === "/api/events") {
        return openEvents(req, res);
      }
      if (path === "/api/scan") {
        const body = req.method === "POST" ? await readJson(req) : undefined;
        const values = formValues(body);
        const result = scanNow(values);
        return json(res, 200, { ...result, argv: argvFromOptions(currentOptions(values)) });
      }
      if (req.method === "POST" && path === "/api/drop") {
        const relative = url.searchParams.get("path");
        if (relative === null || relative === "") throw new HttpError(400, "drop needs a path");
        try {
          const saved = await ensureStage().save(relative, req);
          return json(res, 200, { path: saved });
        } catch (error) {
          // Anything the path sanitiser refuses is the client's fault.
          throw new HttpError(400, (error as Error).message);
        }
      }
      if (req.method === "POST" && path === "/api/clear-drop") {
        stage?.clear();
        const result = scanNow(lastValues);
        return json(res, 200, result);
      }
      if (req.method === "POST" && path === "/api/convert") {
        const body = (await readJson(req)) as { options?: FormValues; ids?: unknown };
        const prepared = await prepareConversion(body.options, body.ids);
        void runConversion(prepared.argv, prepared.jobs).catch((error: unknown) => {
          running = false;
          send("log", { line: `ERROR ${(error as Error).message}` });
        });
        return json(res, 202, { started: true, jobs: prepared.jobs.length });
      }
      if (req.method === "POST" && path === "/api/open-output") {
        mkdirSync(dirs.output, { recursive: true });
        openFolder(dirs.output);
        return json(res, 200, { opened: dirs.output });
      }
      if (req.method === "POST" && path === "/api/open-input") {
        mkdirSync(dirs.input, { recursive: true });
        openFolder(dirs.input);
        return json(res, 200, { opened: dirs.input });
      }

      return json(res, 404, { error: "not found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof CliError ? 400 : 500;
      const message = (error as Error).message;
      appendToLogFile(`${status >= 500 ? "ERROR" : "WARN "} ${req.method} ${path}: ${message}`);
      return json(res, status, { error: message });
    }
  };

  function openEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.write(`retry: 2000\n\n`);
    res.write(
      `event: hello\ndata: ${JSON.stringify({ running, total: lastScan?.total ?? 0 })}\n\n`,
    );
    clients.add(res);

    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    keepAlive.unref();

    const done = (): void => {
      clearInterval(keepAlive);
      clients.delete(res);
    };
    req.on("close", done);
    res.on("close", done);
  }

  function servePage(res: ServerResponse, name: string): void {
    // The packaged executable carries the page inside itself (spec 7).
    const bundled = readBundled(`page/${name}`);
    if (bundled !== undefined) {
      return sendPage(res, name, bundled);
    }

    const target = join(PAGE_DIR, name);
    if (!target.startsWith(PAGE_DIR.endsWith(sep) ? PAGE_DIR : `${PAGE_DIR}${sep}`)) {
      return json(res, 404, { error: "not found" });
    }
    const body = readFrom(PAGE_DIR, name);
    if (body === undefined) {
      return json(res, 404, { error: `missing page asset ${name}` });
    }
    return sendPage(res, name, body);
  }

  function sendPage(res: ServerResponse, name: string, body: Buffer): void {
    res.writeHead(200, {
      "content-type": MIME[extname(name).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.byteLength,
      "cache-control": "no-store",
    });
    res.end(body);
  }

  const server = createServer((req, res) => {
    void handler(req, res).catch((error: unknown) => {
      json(res, 500, { error: (error as Error).message });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const url = `http://${host}:${port}/`;

      // Follow INPUT/ (and the staging folder) so the list stays current.
      watch(dirs.input);
      if (stage !== null) watch(stage.dir);

      if (options.openBrowser === true) openUrl(url);

      const close = async (): Promise<void> => {
        for (const stop of stops.splice(0)) stop();
        for (const client of clients) client.end();
        clients.clear();
        if (ownsStage) stage?.dispose();
        await new Promise<void>((done) => server.close(() => done()));
      };

      resolve({ url, port, stageDir, close });
    });
  });
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Pulls `{ options: {...} }` out of a request body. */
function formValues(body: unknown): FormValues | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const options = (body as Record<string, unknown>)["options"];
  return options !== null && typeof options === "object" ? (options as FormValues) : undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.byteLength,
    "cache-control": "no-store",
  });
  res.end(payload);
}

function text(res: ServerResponse, status: number, body: string): void {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": payload.byteLength,
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > 1_000_000) throw new HttpError(413, "request too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

/** Default runner: a worker thread, so the page stays responsive (spec 7). */
function workerRunner(
  request: WorkerRequest,
  onMessage: (message: WorkerMessage) => void,
): Promise<void> {
  // In the packaged executable the worker script is an asset, not a file, so
  // it is evaluated in the new thread instead of loaded from disk.
  const bundledWorker = readBundledText("worker.cjs");
  if (bundledWorker !== undefined) {
    return collectMessages(
      new Worker(bundledWorker, { eval: true, workerData: request }),
      onMessage,
    );
  }

  const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
  if (!existsSync(workerPath)) return inlineRunner(request, onMessage);

  return collectMessages(new Worker(workerPath, { workerData: request }), onMessage);
}

/** Resolves when the worker reports done, rejects when it breaks. */
function collectMessages(
  worker: Worker,
  onMessage: (message: WorkerMessage) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    worker.on("message", (message: WorkerMessage) => {
      onMessage(message);
      if (message.type === "done" || message.type === "error") {
        settled = true;
        resolve();
      }
    });
    worker.on("error", (error) => {
      if (!settled) reject(error);
    });
    worker.on("exit", (code) => {
      if (!settled && code !== 0) reject(new Error(`conversion worker exited with code ${code}`));
    });
  });
}

/**
 * Fallback for running the server straight from source, where dist/worker.js
 * does not exist. It blocks the event loop, so `npm run ui` (which builds
 * first) is the supported path.
 */
async function inlineRunner(
  request: WorkerRequest,
  onMessage: (message: WorkerMessage) => void,
): Promise<void> {
  const options = parseArgs(request.argv);
  const logger = new Logger(options.verbose ? "debug" : "info", (line) =>
    onMessage({ type: "log", line }),
  );
  const result = runJobs(request.jobs, options, request.dirs, logger, (progress) =>
    onMessage({ type: "progress", ...progress }),
  );
  onMessage({ type: "done", ...result });
}

/** `npm run ui` entry point. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  let port = 0;
  let openBrowser = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "converter UI\n\nUsage:\n  ui [--port <n>] [--no-open]\n\n" +
          "Serves the converter UI on 127.0.0.1 and opens it in the browser.\n" +
          "INPUT/ and OUTPUT/ are the ones next to the program.\n",
      );
      return;
    }
    if (arg === "--port") {
      port = Number(argv[index + 1]);
      index += 1;
      if (!Number.isInteger(port) || port < 0 || port > 65_535) {
        throw new Error("--port needs a whole number from 0 to 65535");
      }
      continue;
    }
    if (arg === "--no-open") {
      openBrowser = false;
      continue;
    }
    throw new Error(`unknown option "${arg}"`);
  }

  const server = await startUiServer({
    input: ensureInputDir(),
    output: ensureOutputDir(),
    port,
    openBrowser,
  });

  prepareLogFile();
  process.stdout.write(`converter UI: ${server.url}\n`);
  process.stdout.write("press Ctrl+C to stop\n");
  appendToLogFile(`INFO  ui listening on ${server.url}`);

  const stop = (): void => {
    appendToLogFile("INFO  ui stopped");
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (isMainModule(import.meta.url)) {
  void main().catch((error: unknown) => {
    const message = (error as Error).message;
    process.stderr.write(`${message}\n`);
    appendToLogFile(`ERROR ui failed to start: ${message}`);
    process.exitCode = 1;
  });
}
