// Decides what a file is. Private Account-data files are recognized by NAME and never opened.
import type { FileKind } from './types';

const baseName = (path: string) => path.split('/').pop() ?? path;

/**
 * Account-data files we must never read (SPEC 3.2): payment, user data, identity,
 * location, voice, messages, customer service. Matched on the file name alone.
 */
const PRIVATE_NAME = /payment|userdata|user_data|identity|identifiers|location|voice|message|customer|support|address|family|duo|facebook|marquee|ads|connected|devices|login/i;

/** Account-data files we do use (bonus features). */
const ACCOUNT_EXTRA: { re: RegExp; part: string }[] = [
  { re: /^wrapped.*\.json$/i, part: 'Wrapped' },
  { re: /^playlist.*\.json$/i, part: 'Playlists' },
  { re: /^yourlibrary.*\.json$/i, part: 'Library' },
  { re: /^inferences.*\.json$/i, part: 'Inferences' },
  { re: /^searchqueries.*\.json$/i, part: 'Searches' },
];

export type NameVerdict =
  | { kind: 'private-skipped' }
  | { kind: 'extended-video' }
  | { kind: 'account-extra'; part: string }
  | { kind: 'not-json' }
  | { kind: 'inspect' }; // open it and look at the contents

/** First pass, by name only. Decides whether a file may be opened at all. */
export function judgeByName(path: string): NameVerdict {
  const name = baseName(path);
  if (!/\.json$/i.test(name)) return { kind: 'not-json' };
  // Video files have the exact same fields as audio files, so only the name tells them apart.
  if (/streaming_history_video/i.test(name)) return { kind: 'extended-video' };
  if (/streaming_?history/i.test(name)) return { kind: 'inspect' };
  for (const { re, part } of ACCOUNT_EXTRA) if (re.test(name)) return { kind: 'account-extra', part };
  if (PRIVATE_NAME.test(name)) return { kind: 'private-skipped' };
  return { kind: 'inspect' };
}

const EXTENDED_KEYS = ['ts', 'ms_played', 'master_metadata_track_name', 'spotify_track_uri'];
const ACCOUNT_MUSIC_KEYS = ['endTime', 'artistName', 'trackName', 'msPlayed'];
const ACCOUNT_PODCAST_KEYS = ['endTime', 'podcastName', 'episodeName', 'msPlayed'];

const hasKeys = (o: unknown, keys: string[]) =>
  typeof o === 'object' && o !== null && keys.every((k) => k in (o as object));

/** Second pass, by contents. `data` is the parsed JSON. */
export function judgeByContent(data: unknown): Extract<FileKind, 'extended-audio' | 'account-streaming' | 'unrelated'> {
  if (!Array.isArray(data)) return 'unrelated';
  if (data.length === 0) return 'unrelated';
  // Check a few rows, not just the first, in case the first is odd.
  const sample = data.slice(0, 5);
  if (sample.every((r) => hasKeys(r, EXTENDED_KEYS))) return 'extended-audio';
  if (sample.every((r) => hasKeys(r, ACCOUNT_MUSIC_KEYS) || hasKeys(r, ACCOUNT_PODCAST_KEYS))) return 'account-streaming';
  return 'unrelated';
}

/** Name fragments used to report which parts of the Account data were found. */
export function accountPartFor(path: string): string | null {
  const name = baseName(path);
  if (/streaminghistory_?music/i.test(name)) return 'Listening (past year)';
  if (/streaminghistory_?podcast/i.test(name)) return 'Podcasts (past year)';
  for (const { re, part } of ACCOUNT_EXTRA) if (re.test(name)) return part;
  return null;
}
