import type { Chart, Song } from "../ir/types.js";
import { nearestLegalKeyCount } from "../keys.js";
import type { Logger } from "../log.js";
import { automapChart } from "../transform/automap.js";
import type { CliOptions } from "./options.js";

/** Source difficulties plus one automapped difficulty per requested key count. */
export function buildCharts(
  song: Song,
  options: CliOptions,
  logger: Logger,
  label: string,
): Chart[] {
  // A source key count outside osu!mania's range is mapped to the nearest
  // legal one; the input chart itself is always accepted (spec section 5).
  const charts: Chart[] = [];
  for (const chart of song.charts) {
    const legal = nearestLegalKeyCount(chart.keyCount);
    if (legal === chart.keyCount) {
      charts.push(chart);
      continue;
    }

    const result = automapChart(chart, legal);
    for (const warning of result.warnings) logger.warn(`${chart.meta.name}: ${warning}`, label);
    logger.warn(
      `${chart.meta.name}: ${chart.keyCount}K is not an osu!mania key count, mapped to ${legal}K`,
      label,
    );
    charts.push(result.chart);
  }

  // One difficulty per key count and name (osu! names difficulties by that
  // pair). A chart the source already has wins over an automapped twin, and
  // two sources landing on the same count and name keep only the first.
  const sources = [...charts];
  const taken = new Set(charts.map((chart) => `${chart.keyCount}|${chart.meta.name}`));

  for (const target of options.keys) {
    for (const chart of sources) {
      if (target === chart.keyCount) continue; // identity conversion is the source chart

      const key = `${target}|${chart.meta.name}`;
      if (taken.has(key)) {
        logger.warn(
          `${chart.meta.name}: ${target}K version already exists, automapped one skipped`,
          label,
        );
        continue;
      }

      const result = automapChart(chart, target);
      for (const warning of result.warnings) {
        logger.warn(`${chart.meta.name}: ${warning}`, label);
      }
      taken.add(key);
      charts.push(result.chart);
    }
  }

  return charts;
}
