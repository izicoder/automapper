import { loadStepManiaSong } from "../src/parsers/stepmania.js";

const dir = process.argv[2]!;
const outcome = loadStepManiaSong(dir);
console.log("reason:", outcome.reason);
console.log("warnings:", outcome.warnings);
const song = outcome.song;
if (!song) process.exit(0);
console.log("metadata:", JSON.stringify(song.metadata, null, 2));
console.log("assets:", song.assets);
console.log("charts:", song.charts.length);
for (const chart of song.charts) {
  const first = chart.notes[0]!;
  const last = chart.notes[chart.notes.length - 1]!;
  const holds = chart.notes.filter((n) => n.endMs !== undefined).length;
  console.log(
    `  ${chart.keyCount}K ${chart.meta.name} meter=${chart.meta.meter} notes=${chart.notes.length} holds=${holds} ` +
      `first=${first.ms.toFixed(3)} last=${last.ms.toFixed(3)} bpmChanges=${chart.timing.bpm.length}`,
  );
}