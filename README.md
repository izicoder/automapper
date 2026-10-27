# automapper

StepMania (`.sm`/`.ssc`) to osu!mania converter with key-count automapping.

Drop songs, packs, or `.zip` archives of them into `INPUT/`, convert them, and
take the `.osz` files from `OUTPUT/`. Archives are unpacked into a temporary
folder and deleted again; a re-run skips archives that did not change
(`--force` reprocesses them).

```
npm install
npm run convert                   # convert everything in INPUT/
npm run convert -- --keys 4,10,18 # add automapped difficulties
npm run ui                        # local web page on 127.0.0.1
```

`launch.bat` does the same for a double-click: install, build, open the UI.

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

## License

GNU General Public License v3.0. See `LICENSE`.

The automapper is a TypeScript port of the key-count conversion from
[rizu](https://github.com/semyon422/rizu), also GPL-3.0. See `NOTICE` for the
file-by-file attribution.
