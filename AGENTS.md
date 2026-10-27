# AGENTS.md

## What this is

A universal osu!mania converter and automapper. It reads rhythm-game charts
(StepMania `.sm`/`.ssc` first, BMS family later), turns them into an internal
representation (IR), optionally remaps the key count, and writes osu!mania
beatmaps packed as `.osz`.

The repository has finished spec v1 (StepMania + automapper, 1K-18K).
`SPEC.txt` now lists only the remaining work (BMS/keysounds, `.dwi`, UI) plus
the rules that still apply. **`SPEC.txt` is read-only.** Never edit it unless
the owner explicitly asks; when a spec item is finished, remove it from the
spec in the same commit that finishes it. This file records how the
repository is laid out and how to work in it.

## Commands

- `npm install` — install dependencies (Node 22+).
- `npm run typecheck` — `tsc --noEmit`, must be clean before any commit.
- `npm test` — run the vitest suite once (`npm run test:watch` to watch).
- `npm run build` — emit JavaScript to `dist/` and copy the UI page into it.
- `npm run ui` — build, serve the UI on 127.0.0.1 and open the browser.
- `launch.bat` — same thing for a double-click: installs, builds, opens the UI.
- `npm run convert` — run the CLI from source with `tsx`.
- `npm run convert:built` — run the compiled CLI from `dist/`.
- `npm run convert -- --keys 4,10,18` — CLI flags go after `--`.
- `npm run convert -- --force` — unpack and convert archives again.
- `npm run build:exe` — bundle everything into `build/automapper.exe` (Node 26
  `--build-sea`); the asset the releases ship.
- `scripts/make-release.ps1 -Version 1.0.0` — zip `build/automapper.exe`,
  `LICENSE`, `NOTICE`, `README.txt` and an empty `INPUT/`/`OUTPUT/` into
  `release/`, plus `SHA256SUMS.txt`.

## Testing

`npm test` covers timing and offsets (1 ms tolerance), per-chart `.ssc`
timing, note mapping, the written `.osu` structure, naming and idempotence,
pack discovery, encodings, CLI end to end, the automapper across 1K-18K, and
the UI's discovery, drop staging, output marks, archive contents and HTTP
endpoints.

Importing a generated `.osz` into osu! is a manual check; the writer is
verified against the real file format instead (field counts, types, x
positions, ordering). The release workflow also converts a fixture with the
packaged `.exe`, which covers the SEA paths that `npm test` cannot reach.

## UI

`npm run ui` (or `launch.bat`) serves a local page on 127.0.0.1, random port,
loopback only, and opens it in the browser. Layout is the one in spec section
7: options on top, discovered charts on the left, log on the right.

- The page is plain HTML/CSS/JS in `src/ui/page/`, copied into `dist/` by
  `scripts/copy-ui-page.mjs` (tsc only emits JavaScript).
- The form is turned into argv with `argvFromOptions` and validated by
  `parseArgs`, so the UI and the CLI cannot drift. The same argv is shown in
  the top bar and handed to the worker.
- The list updates itself: `src/ui/watch.ts` follows INPUT/ and the drop
  staging folder, and the server pushes a fresh scan over SSE. A conversion
  refreshes the list the same way. There is no rescan button, and the page
  rescans on its own when an option changes.
- Discovery (`src/ui/scan.ts`) lists INPUT/ and the drop staging folder, with
  per-chart key counts. A row is marked "in OUTPUT" when the .osz name that
  `setSettingsHash`/`setFileName` would produce already exists. Real ones are
  green; automapped targets are amber (up) or violet (down).
- Songs inside a `.zip` are listed under that archive without unpacking it.
  `src/ui/archive-scan.ts` inflates only the chart entries (audio stays packed)
  and caches the result per archive stamp. A listed song has its own id
  (`archive::song/folder`, or `archive::chart.sm` at the root), so it can be
  converted on its own; the archive is still unpacked once per run
  (`selectJobs`/`relativeTo` in `src/cli/jobs.ts`), and the folder rows inside
  an archive collapse with the archive.
- Conversion runs in a worker thread (`src/ui/worker.ts`) so the page keeps
  answering; log lines and progress arrive over SSE (`GET /api/events`).
  The server falls back to in-process conversion if `dist/` was not built.
- Dropped files are staged in the OS temp folder (`src/ui/stage.ts`), never
  copied into INPUT/, and converted from there. Converted output always lands
  in OUTPUT/. The staging folder is removed on shutdown, and a bad path is
  rejected instead of written.
- Endpoints: `GET /`, `/app.js`, `/style.css`, `/api/help`, `/api/events`;
  `POST /api/scan`, `/api/drop?path=`, `/api/convert`, `/api/clear-drop`,
  `/api/open-output`, `/api/open-input`.
- One conversion at a time; a second request gets 409.

## automapper.log

Both the CLI and the UI append every log line to `automapper.log` next to the
program (`APP_ROOT`, git-ignored), with a UTC timestamp. It is never truncated
between runs, so errors from an earlier session can still be read. The UI
writes the same lines it streams to the page, plus failed HTTP requests and
start/stop lines. Over 8 MB the file is moved to `automapper.log.1` once, at
startup (one previous file is kept).

Logging is best effort: a log that cannot be written never stops a conversion.

## Archives in INPUT/

Dropping `.zip` files straight into `INPUT/` works like dropping folders:
each one is unpacked into a temporary folder, converted, and the temporary
copy is deleted, so no unpacked duplicates are left behind.

- `OUTPUT/.archive-state.json` stores size, modification time and a settings
  fingerprint per archive. A re-run skips archives that are unchanged, so
  adding a new pack only processes the new one.
- A run that converts only some songs of an archive (a single row picked in the
  UI) does not record the archive as done, so the rest can still be converted
  later. A run that covers every song records it as usual.
- A replaced archive (different size or mtime) and changed settings both
  count as new; `--force` reprocesses everything.
- Only `.zip` is supported. `.7z`, `.rar` and friends are reported and
  ignored; nested archives are not unpacked.
- `INPUT/` itself is never written to; archive contents live in the OS temp
  folder only while converting.

## Packaged executable and releases

Users get one file: `automapper.exe`. It is a Node single executable
application (SEA) plus the code appended to a copy of `node.exe`, so nothing
has to be installed.

- `npm run build:exe` runs `scripts/build-sea.mjs`: esbuild bundles
  `src/sea-main.ts` and `src/ui/worker.ts` into CommonJS, the page files and
  the worker bundle become SEA assets, and `node --build-sea` writes
  `build/automapper.exe`. Needs Node 26 to build; dev work stays on Node 22+.
- `src/sea-main.ts` picks what runs: no argument or `ui` starts the UI,
  `convert` and plain flags go to the CLI.
- Inside the exe `src/runtime.ts` reports `IN_SEA`, `paths.ts` puts INPUT/ and
  OUTPUT/ next to the `.exe`, the page is served from the bundled assets, and
  the conversion worker is evaluated in a thread
  (`new Worker(code, { eval: true, workerData })`) instead of loaded from disk.
  `isMainModule()` is false there, so the module-level auto-run guards stay out
  of the way.
- `scripts/make-release.ps1` puts the exe, `LICENSE`, `NOTICE`, `README.txt`
  and empty `INPUT/`/`OUTPUT/` into `release/automapper-<version>-win-x64.zip`
  and writes `SHA256SUMS.txt`.

`.github/workflows/release.yml` runs on every push to `master` and on demand:

- Typecheck and tests must pass.
- A release is published only when `package.json`'s version has no `v<version>`
  tag. Bumping the version is therefore the "make a release" action; a new
  major number gets the "major release" title. Commits without a bump publish
  nothing.
- Before publishing, it converts a fixture with the built `.exe` and fails if
  no `.osz` appears, so a broken package cannot be released.
- `workflow_dispatch` with `force` rebuilds and replaces the assets of the
  current version's release.

## Layout

```
src/
  paths.ts        App directory resolution: INPUT/ and OUTPUT/ sit next to the
                  program (never process.cwd()). All paths use `path`.
  runtime.ts      IN_SEA / isMainModule / bundled asset lookup for the packaged
                  single executable.
  sea-main.ts     Entry point of the packaged .exe: no args or `ui` starts the
                  UI, `convert` and flags go to the CLI.
  log.ts          Dependency-free logger. One line per event, context first.
  version.ts      CONVERTER_VERSION. Part of every content hash — bump it when
                  output generation changes.
  ir/             Internal representation.
    beat.ts       Exact rational beats ({n, d}, always reduced).
    types.ts      Song / Chart / Note / TempoMap types.
    timing.ts     TimingMap: beats -> absolute ms, computed once, full precision.
  parsers/        One module per source format. Never knows about osu.
    encoding.ts   UTF-8 / BOM / Shift-JIS / latin-1 detection, always logged.
    msd.ts        StepMania `#TAG:value;` scanner.
    chart-types.ts Step step type -> osu key count table.
    steps.ts      StepMania note data (measures, holds, rolls, mines...).
  transform/      Automapper (key count N -> M).
    automap.ts    Public entry: IR chart -> IR chart at the target key count.
    rizu/         Port of rizu vsrg's key conversion (GPL-3.0, see NOTICE).
      preprocess.ts NotePreprocessor: lines, lanes, neighbour links.
      blocks.ts     BlockFinder + NoteBlock: repeated patterns as one unit.
      reduce.ts     N > M: line overlap, note counts, column balance, LN trim.
      expand.ts     N < M: SolutionSeeker + NextUpscaler, lanes without new notes.
      enps.ts       Exponential density used by the line balancer.
  osu/            Beatmap writer. Never knows about source formats.
    writer.ts     Song + chart -> .osu text (timing points, hit objects).
    note-mapping.ts Spec section 8 rules: what becomes a tap, an LN, or nothing.
    naming.ts     Content hashes, difficulty Version strings, .osz file names.
  package/        Output layout and packing.
    layout.ts     Walks INPUT/: song folders, packs, loose files, archives.
    archive.ts    .zip unpacking (zip-slip safe) and the converted-archive state.
    osz.ts        Builds one .osz per song with all difficulties and assets.
  cli/            Command-line entry point and everything the UI shares.
    options.ts    Argument parsing, the usage text, argvFromOptions.
    charts.ts     buildCharts(): source difficulties + automapped ones.
    jobs.ts       Discovery -> ConversionJob[], runJobs(): one song at a time.
    types.ts      RunDirs / RunResult / RunProgress.
    index.ts      run(): discovery -> jobs -> package, one log line per event.
  ui/             Local web UI (spec section 7).
    server.ts     node:http server, endpoints, SSE log stream, one run at a time.
    scan.ts       INPUT/ + dropped songs -> what the left panel lists.
    archive-scan.ts  Songs inside a .zip, read without unpacking it.
    stage.ts      Temporary staging for dropped files, path sanitiser.
    worker.ts     Conversion in a worker thread, streams log lines and progress.
    protocol.ts   Worker request/message types.
    open.ts       Opens a folder or URL in the OS handler.
    page/         index.html, style.css, app.js. No framework, no build step.
test/             Vitest tests (`*.test.ts`) plus committed fixtures.
  fixtures/songs/ One folder per source-edge fixture: offsets, BPM change and
                  stop, note types, per-chart .ssc timing, audio fallback,
                  unknown step type, Shift-JIS encoding, 7K source.
  fixtures/packs/ One pack fixture: two same-title songs (collision), plus a
                  missing-audio song and a bad-encoding song to prove a pack
                  keeps going.
  osu-format.ts   Tiny .osu reader used by the writer and package tests.
  temp.ts         Scratch folders for tests (under the temp directory).
scripts/
  copy-ui-page.mjs Copies src/ui/page into dist/ after tsc.
  build-sea.mjs    Bundles src/sea-main.ts and the worker with esbuild and
                   packs them, plus the page files, into build/automapper.exe.
  make-release.ps1 Stages build/automapper.exe (+ LICENSE, NOTICE, README.txt,
                   empty INPUT/ and OUTPUT/) and zips it into release/.
  smoke-parse.ts   Manual parser scratch script.
.github/workflows/release.yml
                   Typecheck, tests, exe build, smoke conversion and a GitHub
                   release whenever package.json has a version without a tag.
launch.bat        Double-click entry: npm install, build, serve the UI.
INPUT/            Everything to convert. Never modified by the tool. Git-ignored.
OUTPUT/           Everything the tool produces. Git-ignored.
```

`.gitattributes` marks the Shift-JIS and bad-encoding fixtures as `-text` so
git never rewrites their bytes.

## Status

Spec v1 is done, and the UI from v1.1 is done. Remaining work is listed in
`SPEC.txt` (BMS/keysounds, .dwi).

Automapper specifics:

- N > M uses rizu's `Reductor` chain; N < M uses `NextUpscaler`. The identity
  case (N = M) keeps the source chart and is not duplicated.
- Both sides work in whole milliseconds, like rizu and like osu.
- The upscaler spreads existing notes only; it never invents any. A 1K source
  therefore stays in the leftmost column.
- osu!mania key counts run 1K-18K; 10K and above are normally dual-stage or
  Co-Op layouts but use the same `CircleSize`.
- Input charts may sit outside that range: they are automapped to the closest
  legal count and logged. `--keys` only accepts 1K-18K, and every written
  difficulty is legal (`src/keys.ts`, enforced by the writer).

Not done yet: BMS input and keysounds, .dwi input (spec v1.1).
Scratch lanes and rizu's other modifiers are out of scope.

Spec deviations, on purpose:

- Section 10 asks for density, jack-tolerance and chord-limit knobs. rizu's
  conversion has no such parameters, so the port keeps rizu's behaviour
  instead of inventing flags.
- Section 10's "add notes only where density permits" during expansion is not
  done: rizu's upscaler only moves existing notes, which also satisfies the
  "never invent notes" rule.
- Automapped difficulties share one .osz with the source ones; the spec allows
  either layout.

## Licensing

The project is GPL-3.0 (see `LICENSE`). The automapper is a TypeScript port of
rizu vsrg (https://github.com/semyon422/rizu, GPL-3.0); file-by-file mapping
and attribution are in `NOTICE`.

- Keep the attribution in `NOTICE` and the headers of `src/transform/rizu/`
  and `src/transform/automap.ts` when touching that code.
- Do not copy code from rizu modules that are not already ported without
  checking their license and updating `NOTICE`.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax`. Type-only imports use `import type`.
- Internal module imports use explicit `.js` extensions (NodeNext ESM).
- Beats are exact rationals (`ir/beat.ts`). Never compare beats as floats.
- Absolute ms is computed once from the tempo map at full precision; rounding
  to integer ms happens only in the writer, per note.
- A bad song is skipped with a log line; it never aborts a pack.
- One difficulty per key count and name (that pair is the osu! `Version`). A
  folder holding both `.sm` and `.ssc` copies keeps the `.ssc` chart, and an
  automapped chart never takes a name the source already has at that key count.
- Every parser guess (encoding, audio fallback, skipped chart) goes into
  `Song.warnings` and gets logged.
- Fixtures are small hand-written charts committed under `test/fixtures/`.
  Binary-sensitive fixtures (Shift-JIS, bad encoding) are marked `-text` in
  `.gitattributes`; never let an editor rewrite their bytes.
  `INPUT/`, `OUTPUT/`, `dist/`, `node_modules/` and `*.zip`/`*.osz` are
  git-ignored.
- Never commit a converted pack or a source zip; they belong in `INPUT/` or
  `OUTPUT/`, both ignored.
- Archive handling must never write into `INPUT/` and must always delete its
  temporary unpack folder in a `finally`.

## Git

- Small, meaningful commits; never leave work uncommitted at the end of a task.
- Typecheck and tests must pass before committing.
- Keep this file in step with the structure in the same commit that changes it.