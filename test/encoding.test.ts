import { describe, expect, it } from "vitest";

import { decodeChartBytes } from "../src/parsers/encoding.js";

function utf16be(text: string): Buffer {
  const le = Buffer.from(text, "utf16le");
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1]!;
    be[i + 1] = le[i]!;
  }
  return be;
}

describe("chart encoding detection (spec section 5)", () => {
  it("reads plain UTF-8 without a warning", () => {
    const decoded = decodeChartBytes(Buffer.from("#TITLE:Test;", "utf8"), "song.sm");
    expect(decoded.text).toBe("#TITLE:Test;");
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.warning).toBeUndefined();
  });

  it("drops a UTF-8 BOM", () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("#TITLE:Test;", "utf8")]);
    const decoded = decodeChartBytes(buffer, "song.sm");
    expect(decoded.text).toBe("#TITLE:Test;");
    expect(decoded.encoding).toBe("utf-8-bom");
  });

  it("reads UTF-16LE and UTF-16BE with a BOM", () => {
    const le = decodeChartBytes(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("#TITLE:Test;", "utf16le")]),
      "song.sm",
    );
    expect(le.text).toBe("#TITLE:Test;");
    expect(le.encoding).toBe("utf-16le");

    const be = decodeChartBytes(
      Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be("#TITLE:Test;")]),
      "song.sm",
    );
    expect(be.text).toBe("#TITLE:Test;");
    expect(be.encoding).toBe("utf-16be");
  });

  it("falls back to Shift-JIS and says so", () => {
    // "#TITLE:テスト;" in Shift-JIS.
    const buffer = Buffer.from([
      0x23, 0x54, 0x49, 0x54, 0x4c, 0x45, 0x3a, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x3b,
    ]);
    const decoded = decodeChartBytes(buffer, "song.sm");
    expect(decoded.text).toBe("#TITLE:テスト;");
    expect(decoded.encoding).toBe("shift_jis");
    expect(decoded.warning).toContain("decoded as Shift-JIS");
  });

  it("falls back to latin-1 and says so", () => {
    const buffer = Buffer.from("#TITLE:Caf\xe9;", "latin1");
    const decoded = decodeChartBytes(buffer, "song.sm");
    expect(decoded.text).toBe("#TITLE:Café;");
    expect(decoded.encoding).toBe("latin1");
    expect(decoded.warning).toContain("decoded as latin-1");
  });
});
