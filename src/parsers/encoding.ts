import { isUtf8 } from "node:buffer";
import { readFileSync } from "node:fs";

export interface DecodedText {
  text: string;
  encoding: string;
  /** Set when the file was not clean UTF-8, so the caller can log the guess. */
  warning?: string;
}

/**
 * StepMania files in the wild are UTF-8, Shift-JIS, or latin-1, sometimes with
 * a BOM. Spec section 5 requires that the guess is detected and logged.
 */
export function decodeChartBytes(buffer: Buffer, label: string): DecodedText {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(buffer.subarray(2)), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(buffer.subarray(2)), encoding: "utf-16be" };
  }
  if (isUtf8(buffer)) {
    return { text: buffer.toString("utf8"), encoding: "utf-8" };
  }

  const shiftJis = new TextDecoder("shift_jis").decode(buffer);
  if (!shiftJis.includes("\uFFFD")) {
    return {
      text: shiftJis,
      encoding: "shift_jis",
      warning: `${label}: not valid UTF-8, decoded as Shift-JIS`,
    };
  }

  const latin1 = buffer.toString("latin1");
  return {
    text: latin1,
    encoding: "latin1",
    warning: `${label}: not valid UTF-8 or Shift-JIS, decoded as latin-1`,
  };
}

export function decodeChartFile(path: string): DecodedText {
  return decodeChartBytes(readFileSync(path), path);
}
