// Writes fake Spotify exports (and broken files) to a folder, for manual and browser testing.
// Usage: npm run fake -- <out dir> [plays per year]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { accountZip, brokenInputs, extendedZip, generatePlays } from '../src/data/fake';

const out = process.argv[2];
if (!out) { console.error('Pass an output folder.'); process.exit(1); }
const perYear = Number(process.argv[3] ?? 20_000);
mkdirSync(out, { recursive: true });

const plays = generatePlays({ seed: 11, startYear: 2017, years: 9.5, playsPerYear: perYear, artists: 2500 });
writeFileSync(join(out, 'fake_extended.zip'), extendedZip(plays));
writeFileSync(join(out, 'fake_extended_older.zip'), extendedZip(plays.slice(0, Math.floor(plays.length * 0.7))));
writeFileSync(join(out, 'fake_account.zip'), accountZip(plays));
for (const [name, bytes] of Object.entries(brokenInputs(plays))) writeFileSync(join(out, `broken_${name}`), bytes);
console.log(`wrote ${plays.length} fake plays and test files to ${out}`);
