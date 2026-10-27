export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Small logger with the same shape everywhere: one line per event, source
 * context first. Keeping it dependency free makes the CLI output stable for
 * tests and for reading over a long pack conversion.
 */
export class Logger {
  private readonly counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };

  constructor(
    private readonly minLevel: LogLevel = "info",
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {}

  debug(message: string, context?: string): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: string): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: string): void {
    this.emit("warn", message, context);
  }

  error(message: string, context?: string): void {
    this.emit("error", message, context);
  }

  count(level: LogLevel): number {
    return this.counts[level];
  }

  private emit(level: LogLevel, message: string, context?: string): void {
    this.counts[level] += 1;
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const prefix = context ? `[${context}] ` : "";
    this.sink(`${level.toUpperCase().padEnd(5)} ${prefix}${message}`);
  }
}

/** Collector used by tests: keeps every line and exposes the counts. */
export function createTestLogger(minLevel: LogLevel = "debug"): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = new Logger(minLevel, (line) => lines.push(line));
  return { logger, lines };
}
