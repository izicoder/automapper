import { MAX_KEY_COUNT, MIN_KEY_COUNT } from "../keys.js";

export interface CliOptions {
  /** Target key counts, empty means "convert only". */
  keys: number[];
  /** Holds shorter than this in beats become taps. */
  minHoldBeats: number;
  /** Emulates stops with near-zero SV lines (spec section 6). */
  stopEmulation: boolean;
  /** Rolls become a series of taps (spec section 8). */
  rollAsTaps: boolean;
  /** Distance between those taps, in beats. */
  rollTapBeats: number;
  /** Key count for charts with an unknown step type, or undefined to skip them. */
  assumeKeys?: number;
  /** Re-unpack archives that were already converted. */
  force: boolean;
  seed: number;
  verbose: boolean;
  help: boolean;
}

export const DEFAULT_OPTIONS: CliOptions = {
  keys: [],
  minHoldBeats: 1 / 32,
  stopEmulation: false,
  rollAsTaps: false,
  rollTapBeats: 0.25,
  force: false,
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
      case "--roll-subdivision":
        options.rollTapBeats = parseNumber(next(), arg);
        if (!(options.rollTapBeats > 0)) throw new CliError(`${arg} must be greater than 0`);
        break;
      case "--assume-keys": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < MIN_KEY_COUNT || value > MAX_KEY_COUNT) {
          throw new CliError(
            `${arg} needs a whole number from ${MIN_KEY_COUNT} to ${MAX_KEY_COUNT}`,
          );
        }
        options.assumeKeys = value;
        break;
      }
      case "--stop-emulation":
        options.stopEmulation = true;
        break;
      case "--roll-taps":
        options.rollAsTaps = true;
        break;
      case "--force":
        options.force = true;
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

/** osu!mania key counts, from 1K to 18K (10K+ are dual-stage / Co-Op). */
function parseKeys(text: string): number[] {
  const keys: number[] = [];

  for (const part of text.split(",")) {
    const value = Number(part.trim());
    if (!Number.isInteger(value) || value < MIN_KEY_COUNT || value > MAX_KEY_COUNT) {
      throw new CliError(
        `--keys needs whole numbers from ${MIN_KEY_COUNT} to ${MAX_KEY_COUNT}, got "${part.trim()}"`,
      );
    }
    keys.push(value);
  }

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
  --keys <list>           also generate automapped difficulties, 1 to 18 keys
                          (e.g. 4 or 2,10,18)
  --assume-keys <n>       key count for charts with an unknown step type
  --force                 unpack and convert archives again, even if unchanged
  --min-hold-beats <n>    holds shorter than n beats become taps (default 0.03125)
  --roll-taps             split rolls into a series of taps
  --roll-subdivision <n>  distance between those taps in beats (default 0.25)
  --stop-emulation        emulate stops with a near-zero SV line
  --seed <n>              automapper seed, part of the output hash
  --verbose, -v           show debug lines
  --help, -h              show this help

Everything in INPUT/ is converted into OUTPUT/, both next to the program.`;
