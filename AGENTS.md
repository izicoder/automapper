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
- `npm run build` — emit JavaScript to `dist/`.
- `npm run convert` — run the CLI from source with `tsx`.
- `npm run convert:built` — run the compiled CLI from `dist/`.
- `npm run convert -- --keys 4,10,18` — CLI flags go after `--`.
- `npm run convert -- --force` — unpack and convert archives again.

## Testing

`npm test` covers timing and offsets (1 ms tolerance), per-chart `.ssc`
timing, note mapping, the written `.osu` structure, naming and idempotence,
pack discovery, encodings, CLI end to end, and the automapper across 1K-18K.

Importing a generated `.osz` into osu! is a manual check; the writer is
verified against the real file format instead (field counts, types, x
positions, ordering).

## Archives in INPUT/

Dropping `.zip` files straight into `INPUT/` works like dropping folders:
each one is unpacked into a temporary folder, converted, and the temporary
copy is deleted, so no unpacked duplicates are left behind.

- `OUTPUT/.archive-state.json` stores size, modification time and a settings
  fingerprint per archive. A re-run skips archives that are unchanged, so
  adding a new pack only processes the new one.
- A replaced archive (different size or mtime) and changed settings both
  count as new; `--force` reprocesses everything.
- Only `.zip` is supported. `.7z`, `.rar` and friends are reported and
  ignored; nested archives are not unpacked.
- `INPUT/` itself is never written to; archive contents live in the OS temp
  folder only while converting.

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
  cli/            Command-line entry point.
    options.ts    Argument parsing and the usage text.
    index.ts      run(): discovery -> parse -> package, one log line per event.
test/             Vitest tests (`*.test.ts`) plus committed fixtures.
  fixtures/songs/ One folder per source-edge fixture: offsets, BPM change and
                  stop, note types, per-chart .ssc timing, audio fallback,
                  unknown step type, Shift-JIS encoding, 7K source.
  fixtures/packs/ One pack fixture: two same-title songs (collision), plus a
                  missing-audio song and a bad-encoding song to prove a pack
                  keeps going.
  osu-format.ts   Tiny .osu reader used by the writer and package tests.
  temp.ts         Scratch folders for tests (under the temp directory).
INPUT/            Everything to convert. Never modified by the tool. Git-ignored.
OUTPUT/           Everything the tool produces. Git-ignored.
```

`.gitattributes` marks the Shift-JIS and bad-encoding fixtures as `-text` so
git never rewrites their bytes.

## Status

Spec v1 is done; see `SPEC.txt` section 0 and the tests. Remaining work is
listed in `SPEC.txt` (BMS/keysounds, .dwi, UI).

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

Not done yet: BMS input and keysounds, .dwi input, UI (all spec v1.1).
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