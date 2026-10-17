// Turns a raw Spotify row into a Play. Every rule here is described in SPEC 3.1 and 3.5.
import type { Play, PlatformGroup, PlayKind, RawPlay } from './types';

/** Fields that identify the person or their network. Dropped the moment a row is read. */
const PRIVATE_FIELDS = ['ip_addr', 'ip_addr_decrypted', 'user_agent_decrypted', 'username'];

export function stripPrivate(row: Record<string, unknown>): Record<string, unknown> {
  for (const f of PRIVATE_FIELDS) delete row[f];
  return row;
}

/** offline_timestamp is epoch seconds in some rows and epoch ms in others. */
export function offlineTimestampToMs(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v > 1e11 ? v : v * 1000;
}

const MAX_OFFLINE_LAG_MS = 60 * 24 * 3600 * 1000; // plays sync within weeks, not years

/**
 * Start time of a play. `ts` is when the play ENDED. offline_timestamp, when present and
 * plausible, is when it started (and for offline plays it's the only real time we have).
 */
export function playStart(row: RawPlay, endMs: number): { start: number; source: Play['startSource'] } {
  const off = offlineTimestampToMs(row.offline_timestamp);
  if (off != null && off <= endMs + 1000 && endMs - off <= MAX_OFFLINE_LAG_MS) {
    return { start: off, source: 'offline_timestamp' };
  }
  return { start: endMs - Math.max(0, row.ms_played || 0), source: 'ts_minus_ms' };
}

export function playKind(row: RawPlay): PlayKind {
  if (row.spotify_track_uri) return 'music';
  if (row.spotify_episode_uri) return 'podcast';
  if (row.audiobook_uri || row.audiobook_chapter_uri) return 'audiobook';
  if (row.master_metadata_track_name) return 'music';
  return 'unknown';
}

export function platformGroup(raw: string | null | undefined): PlatformGroup {
  const p = (raw ?? '').toLowerCase();
  if (!p || p === 'not_applicable') return 'Other';
  if (p.includes('carplay') || p.includes('android_auto') || p.includes('android auto') || p.includes('car thing') || p.includes('tesla')) return 'Car';
  if (p.startsWith('ios') || p.includes('iphone') || p.includes('ipad')) return 'iOS';
  // TVs and speakers before Web: "Chromecast" contains "chrome", cast strings mention versions, etc.
  if (p.includes('cast_tv') || p.includes('chromecast') || p.includes('android_tv') || p.includes('fire tv') || p.includes('roku') || p.includes('smart_tv') || p.includes('apple tv') || p.includes('tvos')) return 'TV';
  if (p.includes('android') && (p.includes('tv') || p.includes('bravia'))) return 'TV';
  if (p.includes('cast_voice') || p.includes('echo') || p.includes('alexa') || p.includes('amazon_salmon') || p.includes('google_home') || p.includes('sonos') || p.includes('homepod')) return 'Speaker';
  if (p.includes('android')) return 'Android';
  if (p.includes('web') || p.includes('chrome') || p.includes('firefox') || p.includes('safari')) return 'Web';
  if (p.startsWith('os x') || p === 'osx' || p.includes('macos') || p.startsWith('windows') || p.includes('linux')) return 'Desktop';
  if (p.includes('sonos') || p.includes('echo') || p.includes('alexa') || p.includes('google_home') || p.includes('cast') || p.includes('speaker') || p.includes('homepod')) return 'Speaker';
  if (p.includes('playstation') || p.includes('ps4') || p.includes('ps5') || p.includes('xbox')) return 'Console';
  if (p.includes('tv') || p.includes('roku') || p.includes('samsung_tv') || p.includes('webos') || p.includes('tizen')) return 'TV';
  return 'Other';
}

/** cyrb53: fast 53-bit string hash. Collisions are negligible at a few million rows. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Dedup key: the whole row minus private fields, with keys in a fixed order. */
export function playId(row: Record<string, unknown>): string {
  const keys = Object.keys(row).filter((k) => !PRIVATE_FIELDS.includes(k)).sort();
  let s = '';
  for (const k of keys) s += k + '\u0001' + JSON.stringify(row[k] ?? null) + '\u0002';
  return hash53(s);
}

export function normalizePlay(input: Record<string, unknown>): Play | null {
  const row = stripPrivate(input) as RawPlay;
  if (typeof row.ts !== 'string') return null;
  const end = Date.parse(row.ts);
  if (!Number.isFinite(end)) return null;
  const ms = Number.isFinite(row.ms_played) ? Math.max(0, row.ms_played) : 0;
  const { start, source } = playStart(row, end);
  const kind = playKind(row);
  return {
    id: playId(row),
    start,
    end,
    startSource: source,
    ms,
    kind,
    uri: row.spotify_track_uri ?? row.spotify_episode_uri ?? row.audiobook_chapter_uri ?? row.audiobook_uri ?? null,
    track: row.master_metadata_track_name ?? row.episode_name ?? row.audiobook_chapter_title ?? null,
    artist: row.master_metadata_album_artist_name ?? null,
    album: row.master_metadata_album_album_name ?? null,
    show: row.episode_show_name ?? row.audiobook_title ?? null,
    platform: row.platform ?? 'unknown',
    platformGroup: platformGroup(row.platform),
    country: row.conn_country && row.conn_country !== 'ZZ' ? row.conn_country : null,
    reasonStart: row.reason_start ?? null,
    reasonEnd: row.reason_end ?? null,
    shuffle: row.shuffle === true,
    skipped: row.skipped === true,
    offline: row.offline === true,
    incognito: row.incognito_mode === true,
  };
}
