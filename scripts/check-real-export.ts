// Runs the real import pipeline on the real export, in memory, and prints a summary.
// Usage: npm run check-real -- "<path to my_spotify_data.zip or the unzipped folder>"
// Output goes to the terminal only. Never commit it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { importFiles, inputFromBytes, MemorySink } from '../src/data/importer';

const target = process.argv[2];
if (!target) { console.error('Pass the export zip or folder.'); process.exit(1); }

const inputs = statSync(target).isDirectory()
  ? readdirSync(target).map((f) => inputFromBytes(`${target.split('/').pop()}/${f}`, readFileSync(join(target, f))))
  : [inputFromBytes(target.split('/').pop()!, readFileSync(target))];

const sink = new MemorySink();
const t = performance.now();
const r = await importFiles(inputs, sink);
const secs = ((performance.now() - t) / 1000).toFixed(2);

const byKind: Record<string, number> = {};
for (const f of r.files) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
console.log(`imported in ${secs} s`);
console.log(`files by kind: ${JSON.stringify(byKind)}`);
console.log(`rows ${r.plays} · added ${r.added} · duplicates ${r.duplicates} · span ${r.firstTs} → ${r.lastTs}`);
if (r.problem) console.log(`problem: ${r.problem}`);
for (const f of r.files.filter((f) => f.kind === 'broken')) console.log(`BROKEN ${f.path}: ${f.problem}`);

// Sanity checks on the start-time rule.
const plays = [...sink.plays.values()];
let fromOffline = 0, startAfterEnd = 0, bigLag = 0, hourShift = 0;
for (const p of plays) {
  if (p.startSource === 'offline_timestamp') fromOffline++;
  if (p.start > p.end + 1000) startAfterEnd++;
  if (p.end - p.start > 6 * 3600e3) bigLag++;
  if (new Date(p.start).getHours() !== new Date(p.end).getHours()) hourShift++;
}
const pct = (n: number) => ((100 * n) / plays.length).toFixed(1) + '%';
console.log(`start from offline_timestamp: ${pct(fromOffline)} · start after end: ${startAfterEnd} · start > 6h before end: ${pct(bigLag)}`);
console.log(`plays whose local hour differs between start and end: ${pct(hourShift)} (the heatmap error we avoid)`);
const groups: Record<string, number> = {};
for (const p of plays) groups[p.platformGroup] = (groups[p.platformGroup] ?? 0) + 1;
console.log(`platform groups: ${JSON.stringify(groups)}`);
const kinds: Record<string, number> = {};
for (const p of plays) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
console.log(`kinds: ${JSON.stringify(kinds)}`);
console.log(`ip_addr stored anywhere: ${JSON.stringify(plays).includes('ip_addr')}`);
