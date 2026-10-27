/**
 * StepMania's MSD tag format: #TAG:value;, repeated. Values may span lines and
 * may contain ':' (note data does not, radar values do not, but authors add
 * colons inside #TITLE occasionally), so the scanner only splits on the first
 * ':' and stops at the first ';'.
 */
export interface MsdTag {
  key: string;
  value: string;
}

/** Removes full-line comments. Inline '//' is left alone: it can appear in titles. */
function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

export function parseMsd(rawText: string): MsdTag[] {
  const text = stripLineComments(rawText);
  const tags: MsdTag[] = [];
  let index = 0;

  while (index < text.length) {
    const hash = text.indexOf("#", index);
    if (hash < 0) break;
    index = hash + 1;

    const colon = text.indexOf(":", index);
    const semicolon = text.indexOf(";", index);
    if (semicolon >= 0 && (colon < 0 || semicolon < colon)) {
      // Tag without value, e.g. "#FOO;" -- keep it, some files use flags.
      const flagKey = text.slice(index, semicolon).trim().toUpperCase();
      if (flagKey.length > 0) tags.push({ key: flagKey, value: "" });
      index = semicolon + 1;
      continue;
    }
    if (colon < 0) break;

    const key = text.slice(index, colon).trim().toUpperCase();
    const end = text.indexOf(";", colon + 1);
    const valueEnd = end < 0 ? text.length : end;
    if (key.length > 0) tags.push({ key, value: text.slice(colon + 1, valueEnd) });
    index = end < 0 ? text.length : end + 1;
  }

  return tags;
}

/** First value for a key, trimmed. */
export function tagValue(tags: readonly MsdTag[], key: string): string | undefined {
  return tags.find((tag) => tag.key === key)?.value.trim();
}

export function allTagValues(tags: readonly MsdTag[], key: string): string[] {
  return tags.filter((tag) => tag.key === key).map((tag) => tag.value);
}
