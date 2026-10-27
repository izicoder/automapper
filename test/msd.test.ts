import { describe, expect, it } from "vitest";

import { allTagValues, parseMsd, tagValue } from "../src/parsers/msd.js";

describe("MSD tag scanner", () => {
  it("reads simple tags", () => {
    const tags = parseMsd("#TITLE:Hello;\n#ARTIST:World;\n");
    expect(tagValue(tags, "TITLE")).toBe("Hello");
    expect(tagValue(tags, "ARTIST")).toBe("World");
    expect(tagValue(tags, "MISSING")).toBeUndefined();
  });

  it("keeps colons inside values", () => {
    const tags = parseMsd("#TITLE:Foo: The Bar;");
    expect(tagValue(tags, "TITLE")).toBe("Foo: The Bar");
  });

  it("keeps note data with newlines and colons in one value", () => {
    const tags = parseMsd("#NOTES:\n dance-single:\n :\n Hard:\n 7:\n : data\n1000,\n0001;\n");
    expect(allTagValues(tags, "NOTES")).toHaveLength(1);
    expect(tags[0]!.value).toContain("1000,");
    expect(tags[0]!.value.split(":")).toHaveLength(6);
  });

  it("drops full line comments but keeps inline slashes", () => {
    const tags = parseMsd("// comment\n#TITLE:A // B;\n");
    expect(tagValue(tags, "TITLE")).toBe("A // B");
    expect(tags).toHaveLength(1);
  });

  it("uppercases keys", () => {
    const tags = parseMsd("#title:x;");
    expect(tagValue(tags, "TITLE")).toBe("x");
  });

  it("handles repeated keys in order", () => {
    const tags = parseMsd("#BPMS:0=120;\n#BPMS:4=60;\n");
    expect(allTagValues(tags, "BPMS")).toEqual(["0=120", "4=60"]);
  });
});