import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { accountZip, brokenInputs, extendedZip, generatePlays, PRIVATE_SENTINEL, splitIntoFiles } from '../src/data/fake';
import { importFiles, inputFromBytes, MemorySink } from '../src/data/importer';
import { playId } from '../src/data/normalize';

const plays = generatePlays({ seed: 7, years: 3, playsPerYear: 6000, artists: 120 });
/** Distinct plays: identical rows (minus ip_addr) count once. */
const distinct = new Set(plays.map((p) => playId({ ...p }))).size;

describe('fake generator', () => {
  it('produces several years with the real quirks', () => {
    expect(plays.length).toBeGreaterThan(10_000);
    const years = new Set(plays.map((p) => p.ts.slice(0, 4)));
    expect(years.size).toBeGreaterThanOrEqual(3);
    // offline sync batches: many rows share one ts
    const perTs = new Map<string, number>();
    for (const p of plays) perTs.set(p.ts, (perTs.get(p.ts) ?? 0) + 1);
    expect(Math.max(...perTs.values())).toBeGreaterThan(3);
    // mixed offline_timestamp units
    const offs = plays.map((p) => p.offline_timestamp).filter((v): v is number => v != null);
    expect(offs.some((v) => v > 1e11)).toBe(true);
    expect(offs.some((v) => v < 1e11)).toBe(true);
    // byte-identical duplicates exist
    expect(distinct).toBeLessThan(plays.length);
  });

  it('is deterministic for a seed', () => {
    const again = generatePlays({ seed: 7, years: 3, playsPerYear: 6000, artists: 120 });
    expect(again.length).toBe(plays.length);
    expect(again[123]).toEqual(plays[123]);
  });

  it('splits files like Spotify (by year, size-capped, _n suffix)', () => {
    const files = splitIntoFiles(plays, 4000);
    expect(Object.keys(files).some((n) => /_\d+\.json$/.test(n))).toBe(true);
    expect(Object.values(files).every((rows) => rows.length <= 4000)).toBe(true);
    expect(Object.values(files).reduce((n, rows) => n + rows.length, 0)).toBe(plays.length);
  });
});

describe('importing', () => {
  it('imports a Spotify-shaped zip: every distinct play once, video and pdf ignored', async () => {
    const sink = new MemorySink();
    const r = await importFiles([inputFromBytes('my_spotify_data.zip', extendedZip(plays, 4000))], sink);
    expect(r.hasExtended).toBe(true);
    expect(r.added).toBe(distinct);
    expect(r.duplicates).toBe(plays.length - distinct);
    expect(sink.plays.size).toBe(distinct);
    expect(r.files.some((f) => f.kind === 'extended-video')).toBe(true);
    expect(r.files.some((f) => f.path.endsWith('.pdf') && f.kind === 'unrelated')).toBe(true);
    expect(r.firstTs).toBe(plays[0].ts);
    expect(r.lastTs).toBe(plays.at(-1)!.ts);
  });

  it('re-importing the same export adds nothing', async () => {
    const sink = new MemorySink();
    const zip = extendedZip(plays, 4000);
    await importFiles([inputFromBytes('a.zip', zip)], sink);
    const r = await importFiles([inputFromBytes('a.zip', zip)], sink);
    expect(r.added).toBe(0);
    expect(r.duplicates).toBe(plays.length);
  });

  it('merging a newer, overlapping export adds only the new plays', async () => {
    const sink = new MemorySink();
    const cut = Math.floor(plays.length * 0.7);
    await importFiles([inputFromBytes('old.zip', extendedZip(plays.slice(0, cut), 4000))], sink);
    const r = await importFiles([inputFromBytes('my_spotify_data (1).zip', extendedZip(plays, 4000))], sink);
    expect(sink.plays.size).toBe(distinct);
    expect(r.added + r.duplicates).toBe(plays.length);
  });

  it('accepts loose JSON files (already unzipped) and folder paths', async () => {
    const sink = new MemorySink();
    const files = Object.entries(splitIntoFiles(plays, 4000)).map(([name, rows]) =>
      inputFromBytes(`Spotify Extended Streaming History/${name}`, strToU8(JSON.stringify(rows))));
    const r = await importFiles(files, sink);
    expect(r.added).toBe(distinct);
  });

  it('accepts a zip inside a zip, at any folder depth', async () => {
    const sink = new MemorySink();
    const r = await importFiles([inputFromBytes('nested.zip', brokenInputs(plays)['nested.zip'])], sink);
    expect(r.hasExtended).toBe(true);
    expect(r.added).toBeGreaterThan(0);
  });

  it('handles both exports dropped together', async () => {
    const sink = new MemorySink();
    const r = await importFiles([
      inputFromBytes('my_spotify_data.zip', accountZip(plays)),
      inputFromBytes('my_spotify_data (1).zip', extendedZip(plays, 4000)),
    ], sink);
    expect(r.hasExtended).toBe(true);
    expect(r.hasAccount).toBe(true);
    expect(r.accountParts).toEqual(expect.arrayContaining(['Wrapped', 'Playlists', 'Library', 'Inferences', 'Searches', 'Listening (past year)']));
    expect(r.problem).toBeUndefined();
    expect(sink.plays.size).toBe(distinct);
  });
});

describe('privacy', () => {
  it('never opens private Account-data files (zip)', async () => {
    const sink = new MemorySink();
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    const r = await importFiles([inputFromBytes('my_spotify_data.zip', accountZip(plays))], sink);
    const decoded = decode.mock.calls.map(([b]) => new TextDecoder().decode(b as Uint8Array)).join('');
    decode.mockRestore();
    expect(decoded).not.toContain(PRIVATE_SENTINEL);
    for (const n of ['Userdata.json', 'Payments.json', 'Identifiers.json'])
      expect(r.files.find((f) => f.path.endsWith(n))?.kind).toBe('private-skipped');
  });

  it('never reads a private file picked loose', async () => {
    const read = vi.fn(async () => strToU8(`{"x":"${PRIVATE_SENTINEL}"}`));
    const r = await importFiles([{ path: 'Userdata.json', bytes: read }], new MemorySink());
    expect(read).not.toHaveBeenCalled();
    expect(r.files[0].kind).toBe('private-skipped');
  });
});

describe('upload error cases', () => {
  const bad = brokenInputs(plays);
  const run = (names: (keyof typeof bad)[], extra: Uint8Array[] = []) =>
    importFiles([...names.map((n) => inputFromBytes(n, bad[n])), ...extra.map((b, i) => inputFromBytes(`good${i}.zip`, b))], new MemorySink());

  it('a truncated JSON is skipped and named, the rest still imports', async () => {
    const r = await run(['truncated.json'], [extendedZip(plays.slice(0, 1000))]);
    const t = r.files.find((f) => f.path === 'truncated.json')!;
    expect(t.kind).toBe('broken');
    expect(t.problem).toMatch(/isn't valid JSON/);
    expect(r.added).toBeGreaterThan(0);
    expect(r.problem).toBeUndefined();
  });

  it('non-Spotify JSON and an empty array are reported as unrelated', async () => {
    const r = await run(['not-spotify.json', 'empty.json']);
    expect(r.files.map((f) => f.kind)).toEqual(['unrelated', 'unrelated']);
    expect(r.problem).toMatch(/couldn't find any Spotify listening history/);
  });

  it('an unrelated zip is rejected with a clear message', async () => {
    const r = await run(['unrelated.zip']);
    expect(r.hasExtended).toBe(false);
    expect(r.problem).toMatch(/couldn't find any Spotify listening history/);
  });

  it('a damaged zip is named as damaged', async () => {
    const r = await run(['corrupt.zip']);
    expect(r.files[0].kind).toBe('broken');
    expect(r.files[0].problem).toMatch(/damaged or incomplete/);
    expect(r.problem).toMatch(/None of these files could be read/);
  });

  it('a file named .zip that is not a zip', async () => {
    const r = await run(['fake.zip']);
    expect(r.files[0].problem).toMatch(/isn't a working zip/);
  });

  it('Account data alone explains what is missing', async () => {
    const r = await importFiles([inputFromBytes('my_spotify_data.zip', accountZip(plays))], new MemorySink());
    expect(r.hasExtended).toBe(false);
    expect(r.hasAccount).toBe(true);
    expect(r.problem).toMatch(/Account data/);
  });

  it('nothing at all', async () => {
    const r = await importFiles([], new MemorySink());
    expect(r.problem).toBeDefined();
  });

  it('macOS junk files inside zips are invisible', async () => {
    const zip = zipSync({ '__MACOSX/._x.json': strToU8('junk'), '.DS_Store': strToU8('junk') });
    const r = await importFiles([inputFromBytes('mac.zip', zip)], new MemorySink());
    expect(r.files).toEqual([]);
  });
});

describe('performance', () => {
  it('parses 250k plays quickly (target: under 10 s on a mid-range phone)', async () => {
    const big = generatePlays({ seed: 3, years: 10, playsPerYear: 25_000, artists: 3000 });
    expect(big.length).toBeGreaterThan(200_000);
    const zip = extendedZip(big);
    const t = performance.now();
    const r = await importFiles([inputFromBytes('big.zip', zip)], new MemorySink());
    const secs = (performance.now() - t) / 1000;
    console.log(`imported ${r.plays} plays in ${secs.toFixed(2)} s`);
    expect(secs).toBeLessThan(10);
  });
});
