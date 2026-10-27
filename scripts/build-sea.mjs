import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Builds the single executable released to users: one .exe with the program,
 * the UI page and the conversion worker inside it (Node single executable
 * application). Nothing has to be installed to run it.
 *
 *   node scripts/build-sea.mjs
 *
 * Output: build/automapper.exe
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = join(root, "build");

rmSync(buildDir, { recursive: true, force: true });
mkdirSync(buildDir, { recursive: true });

/** One self-contained JavaScript file, CommonJS because SEA runs CJS. */
async function bundle(entry, output) {
  await build({
    entryPoints: [join(root, entry)],
    outfile: join(buildDir, output),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    // import.meta.url is only read in paths the packaged build skips.
    logOverride: { "empty-import-meta": "silent" },
  });
  return join(buildDir, output);
}

const program = await bundle("src/sea-main.ts", "automapper.cjs");
const worker = await bundle("src/ui/worker.ts", "worker.cjs");

const pageDir = join(root, "src", "ui", "page");
const assets = {};
for (const name of readdirSync(pageDir)) {
  assets[`page/${name}`] = join(pageDir, name);
}
assets["worker.cjs"] = worker;

const config = join(buildDir, "sea-config.json");
writeFileSync(
  config,
  JSON.stringify(
    {
      main: program,
      output: join(buildDir, "automapper.exe"),
      assets,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);

execFileSync(process.execPath, ["--build-sea", config], { stdio: "inherit" });

const exe = join(buildDir, "automapper.exe");
const size = (await import("node:fs")).statSync(exe).size;
process.stdout.write(`built ${exe} (${Math.round(size / 1024 / 1024)} MB)\n`);
