# automapper

StepMania (`.sm`/`.ssc`) to osu!mania converter with key-count automapping.

## Download (no install)

Grab `automapper-<version>-win-x64.zip` from
[Releases](https://github.com/izicoder/automapper/releases), extract it
anywhere and double-click `automapper.exe`. Node.js, the converter and the web
page are all inside that one file; nothing else has to be installed.

- Double-click `automapper.exe` for the local web UI.
- `automapper.exe convert` converts `INPUT\` into `OUTPUT\` without the UI.
- `automapper.exe --help` shows the options.

## From source

```
npm install
npm run convert                   # convert everything in INPUT/
npm run convert -- --keys 4,10,18 # add automapped difficulties
npm run ui                        # local web page on 127.0.0.1
npm run build:exe                 # build/automapper.exe (needs Node 26)
```

`launch.bat` does the source route for a double-click: install, build, open
the UI.

Options: `--keys <list>` (1-18), `--min-hold-beats <n>`, `--roll-taps`,
`--roll-subdivision <n>`, `--stop-emulation`, `--seed <n>`, `--verbose`.

Source charts may use any key count; the output is always mapped to a legal
osu!mania count (1K-18K), using the closest one when the source is outside
that range.

## Web UI

`npm run ui` serves one local page (loopback only) and opens it in the
browser. It lists what `INPUT/` holds — song folders, packs, loose charts and
the songs inside each `.zip`, with source key counts and the key counts they
would be automapped to — and it follows the folder while it runs. Entries are
selected individually or all at once, conversion runs in a worker thread, and
the log streams line by line. Dropped files are staged in the OS temp folder,
converted to `OUTPUT/`, and never copied into `INPUT/`. Every shown line is
also appended to `automapper.log` next to the program.

## Docs

`SPEC.txt` lists the remaining work (BMS/keysounds, `.dwi`) and the rules that
still apply. `AGENTS.md` explains the repository layout and how to work in it.

## Releasing

`.github/workflows/release.yml` builds and publishes a release whenever the
version in `package.json` has no tag yet. Bump the version, push to `master`,
and the workflow typechecks, tests, builds the single executable, converts a
fixture with it, and attaches
`automapper-<version>-win-x64.zip` plus `SHA256SUMS.txt`. A new major number
is titled "major release". Commits without a version bump publish nothing;
`workflow_dispatch` with `force` rebuilds and replaces the assets.

## License

GNU General Public License v3.0. See `LICENSE`.

The automapper is a TypeScript port of the key-count conversion from
[rizu](https://github.com/semyon422/rizu), also GPL-3.0. See `NOTICE` for the
file-by-file attribution.
