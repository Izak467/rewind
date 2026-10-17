// Shapes of Spotify's export files and of our own normalized records.

/** One row of a Streaming_History_Audio_*.json file, exactly as Spotify writes it. */
export interface RawPlay {
  ts: string;
  platform: string | null;
  ms_played: number;
  conn_country: string | null;
  ip_addr?: string | null;
  master_metadata_track_name: string | null;
  master_metadata_album_artist_name: string | null;
  master_metadata_album_album_name: string | null;
  spotify_track_uri: string | null;
  episode_name: string | null;
  episode_show_name: string | null;
  spotify_episode_uri: string | null;
  audiobook_title?: string | null;
  audiobook_uri?: string | null;
  audiobook_chapter_uri?: string | null;
  audiobook_chapter_title?: string | null;
  reason_start: string | null;
  reason_end: string | null;
  shuffle: boolean | null;
  skipped: boolean | null;
  offline: boolean | null;
  offline_timestamp: number | null;
  incognito_mode: boolean | null;
  [extra: string]: unknown;
}

export type PlayKind = 'music' | 'podcast' | 'audiobook' | 'unknown';

export type PlatformGroup =
  | 'iOS' | 'Android' | 'Desktop' | 'Web' | 'Car' | 'Speaker' | 'TV' | 'Console' | 'Other';

/** A play after normalization. This is what gets stored on the device. */
export interface Play {
  /** Hash of the whole raw row minus private fields. Doubles as the dedup key. */
  id: string;
  /** When the play started, epoch ms (UTC). */
  start: number;
  /** When the play ended, epoch ms (UTC); this is Spotify's `ts`. */
  end: number;
  /** How `start` was derived, kept for debugging and tests. */
  startSource: 'offline_timestamp' | 'ts_minus_ms';
  ms: number;
  kind: PlayKind;
  /** spotify:track / episode / audiobook-chapter URI, if any. */
  uri: string | null;
  track: string | null;
  artist: string | null;
  album: string | null;
  /** Podcast show name or audiobook title. */
  show: string | null;
  platform: string;
  platformGroup: PlatformGroup;
  country: string | null;
  reasonStart: string | null;
  reasonEnd: string | null;
  shuffle: boolean;
  skipped: boolean;
  offline: boolean;
  incognito: boolean;
}

/** What a file turned out to be, judged by its name and contents. */
export type FileKind =
  | 'extended-audio'
  | 'extended-video'      // ignored
  | 'account-streaming'   // StreamingHistory_music_* / _podcast_* (Account data)
  | 'account-extra'       // Wrapped, Playlist, YourLibrary, Inferences, SearchQueries
  | 'private-skipped'     // payment, user data, etc.: never opened
  | 'unrelated'           // not something we use
  | 'broken';             // could not be read or parsed

export interface FileReport {
  /** Path inside the upload, e.g. "my_spotify_data.zip/Spotify Extended Streaming History/x.json". */
  path: string;
  kind: FileKind;
  rows?: number;
  added?: number;
  duplicates?: number;
  firstTs?: string;
  lastTs?: string;
  /** Plain-language problem, for broken files. */
  problem?: string;
}

export interface ImportReport {
  files: FileReport[];
  added: number;
  duplicates: number;
  /** Totals over the extended-audio files only. */
  plays: number;
  firstTs?: string;
  lastTs?: string;
  hasExtended: boolean;
  hasAccount: boolean;
  /** Names of Account data parts found, e.g. ["Wrapped", "Playlists"]. */
  accountParts: string[];
  /** Overall problem when nothing usable was found. */
  problem?: string;
}

export type ProgressStep = 'reading' | 'organizing' | 'saving' | 'done';
export interface Progress {
  step: ProgressStep;
  /** 0–1 */
  fraction: number;
  detail?: string;
}
