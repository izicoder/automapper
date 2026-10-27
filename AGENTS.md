# AGENTS.md

## What this is

A universal osu!mania converter and automapper. It reads rhythm-game charts
(StepMania `.sm`/`.ssc` first, BMS family later), turns them into an internal
representation (IR), optionally remaps the key count, and writes osu!mania
beatmaps packed as `.osz`.

The full requirements live in `SPEC.txt`. **`SPEC.txt` is read-only.** Never
edit it unless the owner explicitly asks. This file only records how the
repository is laid out and how to work in it.

## Commands

- `npm install` — install dependencies (Node 22+).
- `npm run typecheck` — `tsc --noEmit`, must be clean before any commit.
- `npm test` — run the vitest suite once (`npm run test:watch` to watch).
- `npm run build` — emit JavaScript to `dist/`.
- `npm run convert` — run the CLI from source with `tsx`.
- `npm run convert:built` — run the compiled CLI from `dist/`.

## Layout

```
src/
  paths.ts        App directory resolution: INPUT/ and OUTPUT/ sit next to the
                  program (never process.cwd()). All paths use `path`.
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
  transform/      Automapper (key count N -> M). Not written yet.
  osu/            Beatmap writer. Never knows about source formats.
  package/        .osz / folder layout. Not written yet.
  cli/            Command-line entry point. Not written yet.
test/             Vitest tests (`*.test.ts`) plus committed fixtures.
INPUT/            Everything to convert. Never modified by the tool. Git-ignored.
OUTPUT/           Everything the tool produces. Git-ignored.
```

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax`. Type-only imports use `import type`.
- Internal module imports use explicit `.js` extensions (NodeNext ESM).
- Beats are exact rationals (`ir/beat.ts`). Never compare beats as floats.
- Absolute ms is computed once from the tempo map at full precision; rounding
  to integer ms happens only in the writer, per note.
- A bad song is skipped with a log line; it never aborts a pack.
- Every parser guess (encoding, audio fallback, skipped chart) goes into
  `Song.warnings` and gets logged.
- Fixtures are small hand-written charts committed under `test/fixtures/`.
  `INPUT/`, `OUTPUT/`, `dist/`, `node_modules/` and `*.zip`/`*.osz` are
  git-ignored.

## Git

- Small, meaningful commits; never leave work uncommitted at the end of a task.
- Typecheck and tests must pass before committing.
- Keep this file in step with the structure in the same commit that changes it.