import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { jobsFromDiscovery } from "../src/cli/jobs.js";
import { runJobs } from "../src/cli/jobs.js";
import { parseArgs } from "../src/cli/options.js";
import { Logger } from "../src/log.js";
import { discover } from "../src/package/layout.js";
import type { WorkerMessage } from "../src/ui/protocol.js";
import { startUiServer, type ConversionRunner, type UiServer } from "../src/ui/server.js";
import { songFixture } from "./osu-format.js";
import { tempDir } from "./temp.js";

const created: string[] = [];
const servers: UiServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = tempDir("ui-server-");
  created.push(dir);
  return dir;
}

/** The real conversion, run in-process so the test needs no worker build. */
const inlineRunner: ConversionRunner = async (request, onMessage) => {
  const options = parseArgs(request.argv);
  const logger = new Logger(options.verbose ? "debug" : "info", (line) =>
    onMessage({ type: "log", line }),
  );
  const result = runJobs(request.jobs, options, request.dirs, logger, (progress) =>
    onMessage({ type: "progress", ...progress }),
  );
  onMessage({ type: "done", ...result });
};

interface Harness {
  server: UiServer;
  input: string;
  output: string;
  stage: string;
}

async function setup(options: { runner?: ConversionRunner; fixture?: string } = {}): Promise<Harness> {
  const root = scratch();
  const input = join(root, "INPUT");
  const output = join(root, "OUTPUT");
  const stage = join(root, "stage");
  mkdirSync(input, { recursive: true });
  mkdirSync(output, { recursive: true });
  mkdirSync(stage, { recursive: true });

  if (options.fixture !== undefined) {
    cpSync(songFixture(options.fixture), join(input, "Song"), { recursive: true });
  }

  const server = await startUiServer({
    input,
    output,
    stageDir: stage,
    port: 0,
    openBrowser: false,
    runner: options.runner ?? inlineRunner,
  });
  servers.push(server);
  return { server, input, output, stage };
}

async function postJson(
  server: UiServer,
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(new URL(path, server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

async function upload(
  server: UiServer,
  relative: string,
  body: Uint8Array | string,
): Promise<Response> {
  return fetch(new URL(`api/drop?path=${encodeURIComponent(relative)}`, server.url), {
    method: "POST",
    body,
  });
}

async function uploadFolder(server: UiServer, fixture: string, folder: string): Promise<void> {
  for (const name of readdirSync(songFixture(fixture))) {
    const relative = folder.length > 0 ? `${folder}/${name}` : name;
    const response = await upload(server, relative, readFileSync(join(songFixture(fixture), name)));
    expect(response.status).toBe(200);
  }
}

async function waitFor(check: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

function outputFiles(output: string): string[] {
  return readdirSync(output).filter((name) => name !== ".archive-state.json");
}

/** Keeps an SSE connection open and collects everything the server sends. */
async function openStream(server: UiServer): Promise<{ text: () => string; stop: () => Promise<void> }> {
  const events = await fetch(new URL("api/events", server.url));
  const reader = events.body!.getReader();
  const decoder = new TextDecoder();
  let stream = "";

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        stream += decoder.decode(value, { stream: true });
      }
    } catch {
      // Closed by the test.
    }
  })();

  return {
    text: () => stream,
    stop: async () => {
      await reader.cancel().catch(() => undefined);
    },
  };
}

describe("UI server (spec section 7)", () => {
  it("serves the page and the CLI help", async () => {
    const { server } = await setup();

    const page = await fetch(new URL("/", server.url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("converter");

    const help = await fetch(new URL("api/help", server.url));
    expect(await help.text()).toContain("Everything in INPUT/");
  });

  it("lists what INPUT/ and a drop hold, side by side", async () => {
    const { server, input, stage } = await setup();
    cpSync(songFixture("zero-offset"), join(input, "Zero Offset"), { recursive: true });
    await uploadFolder(server, "positive-offset", "Dropped");

    const { status, data } = await postJson(server, "api/scan", { options: {} });

    expect(status).toBe(200);
    const songs = data["songs"] as { label: string; origin: string; id: string }[];
    expect(songs.map((song) => `${song.origin}|${song.label}`)).toEqual([
      "input|Zero Offset",
      "drop|Dropped",
    ]);
    expect(songs[1]!.id.startsWith(stage)).toBe(true);
    expect(readdirSync(input)).toEqual(["Zero Offset"]);
  });

  it("converts a dropped song into OUTPUT/ and streams the log", async () => {
    const { server, output } = await setup();
    await uploadFolder(server, "zero-offset", "Dropped Song");

    const scanned = await postJson(server, "api/scan", { options: {} });
    const songs = scanned.data["songs"] as { id: string }[];

    // Listen before starting, so no log line is missed.
    const events = await fetch(new URL("api/events", server.url));
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    let stream = "";
    const reading = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        stream += decoder.decode(value, { stream: true });
        if (stream.includes("event: done")) return;
      }
    })();

    const started = await postJson(server, "api/convert", {
      options: { keys: "4" },
      ids: [songs[0]!.id],
    });
    expect(started.status).toBe(202);

    expect(await waitFor(() => outputFiles(output).some((name) => name.endsWith(".osz")))).toBe(
      true,
    );
    await Promise.race([reading, new Promise((resolve) => setTimeout(resolve, 3000))]);
    await reader.cancel().catch(() => undefined);

    expect(stream).toContain("event: log");
    expect(stream).toContain("event: done");
    expect(stream).toContain('"converted":1');
  });

  it("does not touch INPUT/ when converting a drop", async () => {
    const { server, input } = await setup({ fixture: "positive-offset" });
    const before = readdirSync(input);
    await uploadFolder(server, "zero-offset", "Dropped");

    await postJson(server, "api/convert", { options: {} });
    await waitFor(() => false, 300);

    expect(readdirSync(input)).toEqual(before);
  });

  it("unpacks a dropped archive", async () => {
    const { server, output } = await setup();
    const entries: Record<string, Uint8Array> = {};
    for (const name of readdirSync(songFixture("zero-offset"))) {
      entries[`Zip Song/${name}`] = readFileSync(join(songFixture("zero-offset"), name));
    }

    const response = await upload(server, "pack.zip", zipSync(entries));
    expect(response.status).toBe(200);

    const scanned = await postJson(server, "api/scan", { options: {} });
    const archives = scanned.data["archives"] as { id: string }[];
    expect(archives).toHaveLength(1);

    await postJson(server, "api/convert", { options: {}, ids: [archives[0]!.id] });
    expect(await waitFor(() => outputFiles(output).length === 1)).toBe(true);
    expect(outputFiles(output)[0]).toMatch(/\.osz$/);
  });

  it("rejects options the CLI rejects, with the same message", async () => {
    const { server } = await setup();

    const { status, data } = await postJson(server, "api/scan", { options: { keys: "19" } });

    expect(status).toBe(400);
    expect(String(data["error"])).toContain("1 to 18");
  });

  it("rejects a drop path that escapes the staging folder", async () => {
    const { server } = await setup();

    const response = await upload(server, "../evil.sm", "#TITLE:Evil;");

    expect(response.status).toBe(400);
  });

  it("clears dropped files again", async () => {
    const { server, stage } = await setup();
    await uploadFolder(server, "zero-offset", "Dropped");

    const cleared = await postJson(server, "api/clear-drop", {});

    expect(cleared.data["songs"]).toHaveLength(0);
    expect(readdirSync(stage)).toHaveLength(0);
  });

  it("refuses a second conversion while one is running", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowRunner: ConversionRunner = async (request, onMessage) => {
      await gate;
      await inlineRunner(request, onMessage);
    };

    const { server, output } = await setup({ runner: slowRunner, fixture: "zero-offset" });
    await postJson(server, "api/scan", { options: {} });

    expect((await postJson(server, "api/convert", { options: {} })).status).toBe(202);
    expect((await postJson(server, "api/convert", { options: {} })).status).toBe(409);

    release();
    expect(await waitFor(() => outputFiles(output).length === 1)).toBe(true);
  });

  it("writes nothing to INPUT/ when OUTPUT/ is opened", async () => {
    const { server, input } = await setup({ fixture: "zero-offset" });
    const before = readdirSync(input);

    await postJson(server, "api/open-output", {});

    expect(readdirSync(input)).toEqual(before);
  });

  it("pushes a fresh list after a conversion, without a manual rescan", async () => {
    const { server } = await setup({ fixture: "zero-offset" });
    const stream = await openStream(server);

    await postJson(server, "api/scan", { options: {} });
    await postJson(server, "api/convert", { options: {} });

    expect(await waitFor(() => stream.text().includes('"converted":true'), 6000)).toBe(true);
    await stream.stop();

    expect(stream.text()).toContain("event: scan");
  });

  it("follows INPUT/ while it runs", async () => {
    const { server, input } = await setup();
    const stream = await openStream(server);

    await postJson(server, "api/scan", { options: {} });
    cpSync(songFixture("zero-offset"), join(input, "Added Later"), { recursive: true });

    expect(await waitFor(() => stream.text().includes("Added Later"), 6000)).toBe(true);
    await stream.stop();
  });
});

describe("worker protocol", () => {
  it("reports progress after every job and a final result", async () => {
    const root = scratch();
    const input = join(root, "INPUT");
    const output = join(root, "OUTPUT");
    mkdirSync(input, { recursive: true });
    cpSync(songFixture("zero-offset"), join(input, "Song"), { recursive: true });
    writeFileSync(join(root, "keep.txt"), "");

    const messages: WorkerMessage[] = [];
    await inlineRunner(
      { argv: [], dirs: { input, output }, jobs: jobsFromDiscovery(discover(input)) },
      (message) => messages.push(message),
    );

    expect(messages.some((message) => message.type === "progress")).toBe(true);
    expect(messages.at(-1)).toMatchObject({ type: "done", converted: 1, failed: 0 });
  });
});
