// Phase 0 throwaway: summarize a real Spotify Extended Streaming History export.
// Usage: node scripts/inspect-export.mjs "<path to 'Spotify Extended Streaming History' folder>"
// Prints to stdout only. Never write or commit its output (it describes private data).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Pass the export folder path.');
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const audioFiles = files.filter((f) => f.startsWith('Streaming_History_Audio_'));
const videoFiles = files.filter((f) => f.startsWith('Streaming_History_Video_'));
const otherFiles = files.filter((f) => !audioFiles.includes(f) && !videoFiles.includes(f));

const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const top = (map, n = 40) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '-');

const fieldSeen = new Map(); // field -> rows where key exists
const fieldNull = new Map(); // field -> rows where value null/empty
const platforms = new Map();
const reasonStart = new Map();
const reasonEnd = new Map();
const countries = new Map();
const kinds = new Map();
const perYear = new Map(); // year -> { plays, ms }
const dupKeys = new Set();
let dupes = 0;
const tracks = new Set();
const artists = new Set();
const albums = new Set();
let total = 0;
let totalMs = 0;
let msZero = 0, msUnder30 = 0, msOver2h = 0;
let offlineTrue = 0, offlineTsPresent = 0, offlineTsZero = 0;
const offlineTsSamples = [];
let incognitoTrue = 0, shuffleTrue = 0, skippedTrue = 0, skippedNull = 0;
let minTs = null, maxTs = null;
const samples = [];

console.log('=== FILES ===');
for (const f of audioFiles) {
  const rows = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  let fMin = null, fMax = null;
  for (const r of rows) {
    total++;
    for (const [k, v] of Object.entries(r)) {
      count(fieldSeen, k);
      if (v === null || v === '') count(fieldNull, k);
    }
    const ts = r.ts;
    if (!fMin || ts < fMin) fMin = ts;
    if (!fMax || ts > fMax) fMax = ts;
    const ms = r.ms_played ?? 0;
    totalMs += ms;
    if (ms === 0) msZero++;
    else if (ms < 30000) msUnder30++;
    if (ms > 2 * 3600 * 1000) msOver2h++;
    count(platforms, r.platform);
    count(reasonStart, r.reason_start);
    count(reasonEnd, r.reason_end);
    count(countries, r.conn_country);
    const kind = r.spotify_track_uri ? 'music'
      : r.spotify_episode_uri ? 'podcast'
      : (r.audiobook_uri || r.audiobook_chapter_uri) ? 'audiobook'
      : r.master_metadata_track_name ? 'music (no uri)' : 'unknown (all null)';
    count(kinds, kind);
    const y = ts.slice(0, 4);
    const yr = perYear.get(y) ?? { plays: 0, ms: 0 };
    yr.plays++; yr.ms += ms; perYear.set(y, yr);
    const key = `${ts}|${r.spotify_track_uri ?? r.spotify_episode_uri ?? ''}|${ms}`;
    if (dupKeys.has(key)) dupes++; else dupKeys.add(key);
    if (r.spotify_track_uri) {
      tracks.add(r.spotify_track_uri);
      artists.add(r.master_metadata_album_artist_name);
      albums.add(`${r.master_metadata_album_artist_name}|${r.master_metadata_album_album_name}`);
    }
    if (r.offline === true) offlineTrue++;
    if (r.offline_timestamp != null) {
      offlineTsPresent++;
      if (r.offline_timestamp === 0) offlineTsZero++;
      else if (offlineTsSamples.length < 5 && r.offline) offlineTsSamples.push([ts, r.offline_timestamp]);
    }
    if (r.incognito_mode === true) incognitoTrue++;
    if (r.shuffle === true) shuffleTrue++;
    if (r.skipped === true) skippedTrue++;
    if (r.skipped == null) skippedNull++;
    if (samples.length < 4 && Math.random() < 0.0005) {
      const { ip_addr, ...rest } = r; // drop ip_addr immediately
      samples.push(rest);
    }
  }
  if (!minTs || fMin < minTs) minTs = fMin;
  if (!maxTs || fMax > maxTs) maxTs = fMax;
  console.log(`${f.padEnd(40)} ${String(rows.length).padStart(7)} rows  ${fMin?.slice(0, 10)} → ${fMax?.slice(0, 10)}`);
}

console.log(`\nIgnored video files: ${videoFiles.length} (${videoFiles.join(', ')})`);
if (otherFiles.length) console.log(`Other JSON files: ${otherFiles.join(', ')}`);

console.log('\n=== TOTALS ===');
console.log(`plays: ${total}   span: ${minTs} → ${maxTs}`);
console.log(`hours: ${(totalMs / 3.6e6).toFixed(0)}   unique track URIs: ${tracks.size}   artists: ${artists.size}   albums: ${albums.size}`);
console.log(`exact duplicates (ts|uri|ms): ${dupes}`);
console.log(`ms_played = 0: ${msZero} (${pct(msZero, total)})   1–29.9s: ${msUnder30} (${pct(msUnder30, total)})   > 2h: ${msOver2h}`);
console.log(`streams (>= 30s): ${total - msZero - msUnder30}`);

console.log('\n=== PER YEAR (UTC) ===');
for (const [y, v] of [...perYear].sort()) console.log(`${y}  ${String(v.plays).padStart(7)} plays  ${String(Math.round(v.ms / 60000)).padStart(7)} min`);

console.log('\n=== KIND ===');
for (const [k, v] of top(kinds)) console.log(`${k.padEnd(22)} ${v} (${pct(v, total)})`);

console.log('\n=== FIELDS: present in / null-or-empty rate ===');
for (const [k, v] of [...fieldSeen].sort()) console.log(`${k.padEnd(36)} present ${pct(v, total).padStart(6)}   null ${pct(fieldNull.get(k) ?? 0, total).padStart(6)}`);

console.log('\n=== FLAGS ===');
console.log(`offline=true: ${offlineTrue} (${pct(offlineTrue, total)})   offline_timestamp present: ${offlineTsPresent}, of which 0: ${offlineTsZero}`);
console.log(`offline samples [ts, offline_timestamp]: ${JSON.stringify(offlineTsSamples)}`);
console.log(`incognito: ${incognitoTrue} (${pct(incognitoTrue, total)})   shuffle: ${pct(shuffleTrue, total)}   skipped=true: ${pct(skippedTrue, total)}   skipped null: ${pct(skippedNull, total)}`);

console.log(`\n=== PLATFORMS (${platforms.size} distinct) ===`);
for (const [k, v] of top(platforms, 60)) console.log(`${String(v).padStart(7)}  ${k}`);
console.log(`\n=== reason_start ===`);
for (const [k, v] of top(reasonStart)) console.log(`${String(v).padStart(7)}  ${k}`);
console.log(`\n=== reason_end ===`);
for (const [k, v] of top(reasonEnd)) console.log(`${String(v).padStart(7)}  ${k}`);
console.log(`\n=== conn_country (${countries.size} distinct) ===`);
console.log(top(countries).map(([k, v]) => `${k}:${v}`).join('  '));

console.log('\n=== SAMPLE ROWS (ip_addr removed) ===');
for (const s of samples) console.log(JSON.stringify(s));
