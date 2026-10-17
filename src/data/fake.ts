// Fake Spotify exports: exact schema, several years, realistic habits, plus every quirk seen in
// real exports (SPEC 3.5) and a set of deliberately broken files. Fully deterministic per seed.
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { RawPlay } from './types';

// ---------- seeded randomness ----------
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    /** Index drawn from cumulative weights. */
    weighted: (cum: number[]) => {
      const r = next() * cum[cum.length - 1];
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
      return lo;
    },
  };
}
type Rng = ReturnType<typeof rng>;

// ---------- a fake music world ----------
const ADJ = ['Velvet', 'Paper', 'Neon', 'Hollow', 'Golden', 'Static', 'Midnight', 'Copper', 'Silent', 'Electric', 'Wild', 'Glass', 'Crimson', 'Lunar', 'Rusty', 'Northern', 'Faded', 'Brave', 'Sugar', 'Iron'];
const NOUN = ['Lanterns', 'Rivers', 'Harbor', 'Engines', 'Wolves', 'Gardens', 'Signals', 'Ghosts', 'Mirrors', 'Satellites', 'Foxes', 'Parade', 'Season', 'Choir', 'Highway', 'Orchard', 'Machines', 'Tides', 'Kings', 'Atlas'];
const WORD = ['Night', 'Drive', 'Home', 'Fire', 'Summer', 'Echo', 'Gravity', 'Rain', 'Heart', 'Motion', 'Signal', 'Blue', 'Gold', 'Dream', 'Shadow', 'Light', 'Weather', 'Run', 'Bloom', 'Static', 'Ocean', 'Youth', 'Stay', 'Fever'];

interface FakeTrack { uri: string; name: string; album: string; artist: string; ms: number; }
interface FakeArtist { name: string; tracks: FakeTrack[]; }

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const fakeId = (r: Rng) => Array.from({ length: 22 }, () => B62[r.int(0, 61)]).join('');

function makeWorld(r: Rng, artistCount: number): FakeArtist[] {
  const used = new Set<string>();
  const artists: FakeArtist[] = [];
  while (artists.length < artistCount) {
    let name = r.chance(0.6) ? `The ${r.pick(ADJ)} ${r.pick(NOUN)}` : `${r.pick(ADJ)} ${r.pick(NOUN)}`;
    if (used.has(name)) name = `${name} ${r.int(2, 99)}`;
    used.add(name);
    const tracks: FakeTrack[] = [];
    const albums = r.int(1, 4);
    for (let a = 0; a < albums; a++) {
      const album = r.chance(0.2) ? `${r.pick(WORD)} ${r.pick(WORD)} (Deluxe Edition)` : `${r.pick(WORD)} ${r.pick(NOUN)}`;
      for (let t = r.int(4, 12); t > 0; t--) {
        const tn = r.chance(0.15) ? `${r.pick(WORD)} (feat. ${r.pick(ADJ)} ${r.pick(NOUN)})` : `${r.pick(WORD)} ${r.pick(WORD)}`;
        tracks.push({ uri: `spotify:track:${fakeId(r)}`, name: tn, album, artist: name, ms: r.int(120_000, 360_000) });
      }
    }
    artists.push({ name, tracks });
  }
  return artists;
}

// ---------- habits ----------
// Hour-of-day weights: commute bump, evening peak, some late nights.
const HOUR_W = [3, 2, 1, 0.5, 0.3, 0.5, 2, 5, 7, 5, 4, 4, 5, 5, 4, 5, 6, 8, 9, 9, 8, 7, 6, 4];
const HOUR_CUM = HOUR_W.reduce<number[]>((acc, w) => (acc.push((acc.at(-1) ?? 0) + w), acc), []);

const OLD_PLATFORMS = ['iOS 12.1.2 (iPhone9,2)', 'iOS 13.3.1 (iPhone9,1)', 'iOS 14.4.2 (iPhone13,4)', 'iOS 15.4.1 (iPhone13,4)', 'OS X 10.14.6 [x86 8]', 'Android OS 9 API 28 (samsung, SM-G960U)', 'web_player osx 10.15.7;chrome 96.0.4664.110;desktop', 'windows'];
const NEW_PLATFORMS = ['ios', 'ios', 'ios', 'ios', 'osx', 'windows', 'android', 'not_applicable'];

export interface FakeOptions {
  seed?: number;
  startYear?: number;
  years?: number;
  /** Roughly how many plays per year. */
  playsPerYear?: number;
  artists?: number;
}

/** Generate a realistic list of raw plays, sorted by `ts`. */
export function generatePlays(opts: FakeOptions = {}): RawPlay[] {
  const { seed = 1, startYear = 2019, years = 4, playsPerYear = 15_000, artists: artistCount = 300 } = opts;
  const r = rng(seed);
  const world = makeWorld(r, artistCount);
  // Zipf-like artist popularity.
  const artistCum = world.reduce<number[]>((acc, _a, i) => (acc.push((acc.at(-1) ?? 0) + 1 / Math.pow(i + 1, 1.1)), acc), []);
  const plays: RawPlay[] = [];
  const start = Date.UTC(startYear, 0, 1);
  const days = Math.round(years * 365.25);
  const sessionsPerDay = playsPerYear / 365 / 14;
  // A quiet stretch with no plays at all (real exports have multi-month gaps).
  const gapStart = r.int(60, 200), gapEnd = gapStart + r.int(30, 90);
  const tripStart = r.int(300, Math.max(301, days - 30));

  for (let d = 0; d < days; d++) {
    if (d >= gapStart && d < gapEnd) continue;
    const dayMs = start + d * 864e5;
    const year = new Date(dayMs).getUTCFullYear();
    const weekend = [0, 6].includes(new Date(dayMs).getUTCDay());
    const country = d >= tripStart && d < tripStart + 9 ? 'IT' : 'US';
    // A month-long obsession artist, rotating.
    const obsession = world[Math.floor(rng(seed + Math.floor(d / 30)).next() * Math.min(60, world.length))];
    const nSessions = Math.max(0, Math.round(sessionsPerDay * (weekend ? 1.3 : 1) * (0.4 + r.next() * 1.2)));
    for (let s = 0; s < nSessions; s++) {
      const offline = r.chance(0.04);
      const platform = year >= 2023 ? r.pick(NEW_PLATFORMS) : r.pick(OLD_PLATFORMS);
      const shuffle = r.chance(0.82);
      let t = dayMs + r.weighted(HOUR_CUM) * 36e5 + r.int(0, 3599) * 1000;
      const length = r.int(3, 30);
      const sessionArtist = r.chance(0.5) ? world[r.weighted(artistCum)] : null;
      let prevEnd = 'clickrow';
      const batch: RawPlay[] = [];
      for (let k = 0; k < length; k++) {
        const artist = r.chance(0.25) ? obsession : sessionArtist ?? world[r.weighted(artistCum)];
        const track = r.pick(artist.tracks);
        const skip = r.chance(0.3);
        const msPlayed = skip ? r.int(0, 40_000) : r.chance(0.08) ? r.int(40_000, track.ms) : track.ms;
        const reasonEnd = skip ? (r.chance(0.9) ? 'fwdbtn' : 'backbtn') : msPlayed < track.ms ? r.pick(['endplay', 'logout', 'unexpected-exit-while-paused']) : 'trackdone';
        const startMs = t;
        const endMs = startMs + msPlayed;
        const offTsMs = startMs;
        // offline_timestamp: only on offline rows before 2023, on nearly every row after. Mostly seconds, sometimes ms.
        const withOffTs = offline || year >= 2023;
        const offTs = withOffTs ? (r.chance(0.12) ? offTsMs : Math.floor(offTsMs / 1000)) : null;
        const isPodcast = r.chance(0.004);
        const isNull = r.chance(0.0005);
        const row: RawPlay = {
          ts: new Date(endMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
          platform,
          ms_played: msPlayed,
          conn_country: r.chance(0.002) ? 'ZZ' : country,
          ip_addr: `198.51.100.${r.int(1, 254)}`, // documentation range; must be stripped on import
          master_metadata_track_name: isPodcast || isNull ? null : track.name,
          master_metadata_album_artist_name: isPodcast || isNull ? null : track.artist,
          master_metadata_album_album_name: isPodcast || isNull ? null : track.album,
          spotify_track_uri: isPodcast || isNull ? null : track.uri,
          episode_name: isPodcast ? `Episode ${r.int(1, 300)}: ${r.pick(WORD)}` : null,
          episode_show_name: isPodcast ? `The ${r.pick(WORD)} Show` : null,
          spotify_episode_uri: isPodcast ? `spotify:episode:${fakeId(r)}` : null,
          audiobook_title: null, audiobook_uri: null, audiobook_chapter_uri: null, audiobook_chapter_title: null,
          reason_start: k === 0 ? r.pick(['clickrow', 'playbtn', 'appload']) : prevEnd === 'trackdone' ? 'trackdone' : prevEnd,
          reason_end: reasonEnd,
          shuffle,
          skipped: skip && r.chance(0.35),
          offline,
          offline_timestamp: offTs,
          incognito_mode: r.chance(0.001),
        };
        prevEnd = reasonEnd;
        batch.push(row);
        t = endMs + r.int(0, 3000);
      }
      if (offline) {
        // Offline plays get stamped when the phone syncs: every row shares one `ts`.
        const sync = new Date(t + r.int(10, 600) * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        for (const row of batch) row.ts = sync;
        // Replaying the same full-length song inside a batch: same ts, uri and ms, different offline_timestamp.
        if (batch.length > 2 && r.chance(0.5)) {
          const first = batch[0];
          const replay = { ...first, offline_timestamp: (first.offline_timestamp ?? 0) + Math.round(first.ms_played / 1000) + 5 };
          batch.splice(1, 0, replay);
        }
      }
      plays.push(...batch);
      // Rare byte-identical duplicates, as seen in real exports.
      if (r.chance(0.01)) plays.push({ ...batch[0] });
    }
  }
  plays.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return plays;
}

// ---------- packaging like Spotify does ----------
const FOLDER = 'Spotify Extended Streaming History';

/** Split plays into Spotify-style files: by year, max `rowsPerFile` rows, `_1`, `_2` suffixes. */
export function splitIntoFiles(plays: RawPlay[], rowsPerFile = 16_000): Record<string, RawPlay[]> {
  const out: Record<string, RawPlay[]> = {};
  let i = 0;
  while (i < plays.length) {
    const year = plays[i].ts.slice(0, 4);
    let n = 0;
    while (out[`Streaming_History_Audio_${year}${n ? `_${n}` : ''}.json`]) n++;
    const name = `Streaming_History_Audio_${year}${n ? `_${n}` : ''}.json`;
    const chunk: RawPlay[] = [];
    while (i < plays.length && chunk.length < rowsPerFile && (plays[i].ts.slice(0, 4) === year || chunk.length > rowsPerFile * 0.9)) chunk.push(plays[i++]);
    out[name] = chunk;
  }
  return out;
}

const json = (v: unknown) => strToU8(JSON.stringify(v, null, 1));

/** A zip shaped like Spotify's Extended streaming history download. */
export function extendedZip(plays: RawPlay[], rowsPerFile = 16_000): Uint8Array {
  const folder: Zippable = {};
  for (const [name, rows] of Object.entries(splitIntoFiles(plays, rowsPerFile))) folder[name] = json(rows);
  const videoRow = { ...plays[0], spotify_track_uri: null, master_metadata_track_name: null, spotify_episode_uri: 'spotify:episode:VIDEO' };
  folder['Streaming_History_Video_2024.json'] = json([videoRow]);
  folder['ReadMeFirst_ExtendedStreamingHistory.pdf'] = strToU8('%PDF-1.4 fake');
  return zipSync({ [FOLDER]: folder });
}

/** Marker that must never appear in anything we parse; private files contain it. */
export const PRIVATE_SENTINEL = 'PRIVATE-DO-NOT-READ';

/** A zip shaped like the Account data download, including private files we must never open. */
export function accountZip(plays: RawPlay[]): Uint8Array {
  const recent = plays.slice(-2000).filter((p) => p.spotify_track_uri);
  const music = recent.map((p) => ({ endTime: p.ts.slice(0, 16).replace('T', ' '), artistName: p.master_metadata_album_artist_name, trackName: p.master_metadata_track_name, msPlayed: p.ms_played }));
  return zipSync({
    'Spotify Account Data': {
      'StreamingHistory_music_0.json': json(music),
      'Wrapped2025.json': json({ topArtists: { topArtists: [] } }),
      'Playlist1.json': json({ playlists: [] }),
      'YourLibrary.json': json({ tracks: [] }),
      'Inferences.json': json({ inferences: ['1P_Custom_Example'] }),
      'SearchQueries.json': json([]),
      'Userdata.json': strToU8(`{"secret":"${PRIVATE_SENTINEL}"}`),
      'Payments.json': strToU8(`{"card":"${PRIVATE_SENTINEL}"}`),
      'Identifiers.json': strToU8(`{"id":"${PRIVATE_SENTINEL}"}`),
      'ReadMeFirst_AccountData.pdf': strToU8('%PDF-1.4 fake'),
    },
  });
}

/** Deliberately broken or unrelated inputs, for every upload error case. */
export function brokenInputs(plays: RawPlay[]) {
  const good = json(plays.slice(0, 50));
  return {
    'truncated.json': good.slice(0, Math.floor(good.length / 2)),
    'not-spotify.json': json([{ name: 'Alice', score: 3 }, { name: 'Bob', score: 5 }]),
    'empty.json': json([]),
    'unrelated.zip': zipSync({ 'photos/IMG_0001.jpg': new Uint8Array([0xff, 0xd8, 0xff]), 'notes.txt': strToU8('hello') }),
    'corrupt.zip': (() => { const z = extendedZip(plays.slice(0, 500)); return z.slice(0, Math.floor(z.length * 0.6)); })(),
    'fake.zip': strToU8('this is not a zip'),
    'nested.zip': zipSync({ 'Downloads/inner': { 'my_spotify_data.zip': extendedZip(plays.slice(0, 300)) } }),
  };
}
