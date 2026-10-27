export interface CliOptions {
  /** Target key counts, empty means "convert only". */
  keys: number[];
  /** Holds shorter than this in beats become taps. */
  minHoldBeats: number;
  /** Emulates stops with a near-zero SV line (spec section 6). */
  stopEmulation: boolean;
  rollAsTaps: boolean;
  seed: number;
  verbose: boolean;
  help: boolean;
}

export const DEFAULT_OPTIONS: CliOptions = {
  keys: [],
  minHoldBeats: 1 / 32,
  stopEmulation: false,
  rollAsTaps: false,
  seed: 0,
  verbose: false,
  help: false,
};

export class CliError extends Error {}

/**
 * Parses the command line (spec section 11). Unknown flags are an error so a
 * typo never silently changes the output.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { ...DEFAULT_OPTIONS, keys: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new CliError(`${arg} needs a value`);
      index += 1;
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--keys":
        options.keys = parseKeys(next());
        break;
      case "--min-hold-beats":
        options.minHoldBeats = parseNumber(next(), arg);
        if (options.minHoldBeats < 0) throw new CliError(`${arg} must not be negative`);
        break;
      case "--stop-emulation":
        options.stopEmulation = true;
        break;
      case "--roll-taps":
        options.rollAsTaps = true;
        break;
      case "--seed":
        options.seed = Math.trunc(parseNumber(next(), arg));
        break;
      case "--verbose":
      case "-v":
        options.verbose = true;
        break;
      default:
        throw new CliError(`unknown option "${arg}"`);
    }
  }

  return options;
}

function parseKeys(text: string): number[] {
  const keys = text
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 18);
  if (keys.length === 0) throw new CliError(`--keys needs a list like 4 or 4,7`);
  return [...new Set(keys)];
}

function parseNumber(text: string, flag: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new CliError(`${flag} needs a number, got "${text}"`);
  return value;
}

export const USAGE = `converter - StepMania to osu!mania

Usage:
  converter [options]

Options:
  --keys <list>         also generate automapped difficulties (e.g. 4,7)
  --min-hold-beats <n>  holds shorter than n beats become taps (default 0.03125)
  --stop-emulation      emulate stops with a near-zero SV line
  --roll-taps           split rolls into a series of taps
  --seed <n>            automapper seed, part of the output hash
  --verbose, -v         show debug lines
  --help, -h            show this help

Everything in INPUT/ is converted into OUTPUT/, both next to the program.`;