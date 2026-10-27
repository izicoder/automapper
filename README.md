# automapper

StepMania (`.sm`/`.ssc`) to osu!mania converter with key-count automapping.

Drop songs, packs, or `.zip` archives of them into `INPUT/`, run the
converter, take the `.osz` files from `OUTPUT/`. Archives are unpacked into a
temporary folder and deleted again; a re-run skips archives that did not
change (`--force` reprocesses them).

```
npm install
npm run convert                   # convert everything in INPUT/
npm run convert -- --keys 4,10,18 # add automapped difficulties
```

Options: `--keys <list>` (1-18), `--min-hold-beats <n>`, `--roll-taps`,
`--roll-subdivision <n>`, `--stop-emulation`, `--seed <n>`, `--verbose`.

Source charts may use any key count; the output is always mapped to a legal
osu!mania count (1K-18K), using the closest one when the source is outside
that range.

`SPEC.txt` lists the remaining work (BMS/keysounds, `.dwi`, UI) and the rules
that still apply. `AGENTS.md` explains the repository layout.

## License

GNU General Public License v3.0. See `LICENSE`.

The automapper is a TypeScript port of the key-count conversion from
[rizu](https://github.com/semyon422/rizu), also GPL-3.0. See `NOTICE` for the
file-by-file attribution.
