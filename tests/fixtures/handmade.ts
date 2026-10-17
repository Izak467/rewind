// About 20 hand-written plays whose correct answers are worked out by hand in the comments.
import type { RawPlay } from '../../src/data/types';

const base: RawPlay = {
  ts: '2020-03-01T12:00:00Z', platform: 'iOS 13.3.1 (iPhone9,1)', ms_played: 200_000, conn_country: 'US',
  ip_addr: '203.0.113.7',
  master_metadata_track_name: 'Song A', master_metadata_album_artist_name: 'Artist One', master_metadata_album_album_name: 'Album X',
  spotify_track_uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA',
  episode_name: null, episode_show_name: null, spotify_episode_uri: null,
  audiobook_title: null, audiobook_uri: null, audiobook_chapter_uri: null, audiobook_chapter_title: null,
  reason_start: 'clickrow', reason_end: 'trackdone', shuffle: false, skipped: false,
  offline: false, offline_timestamp: null, incognito_mode: false,
};
const row = (over: Partial<RawPlay>): RawPlay => ({ ...base, ...over });
const ms = (iso: string) => Date.parse(iso);

export interface Expected {
  start: number;
  startSource: 'offline_timestamp' | 'ts_minus_ms';
  kind: string;
  platformGroup: string;
  /** true if this row should be dropped as a duplicate of an earlier one */
  duplicate?: boolean;
}

export const HANDMADE: { name: string; raw: RawPlay; expect: Expected }[] = [
  { name: '1 plain online play: start = ts − ms_played',
    raw: row({}), expect: { start: ms('2020-03-01T12:00:00Z') - 200_000, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS' } },
  { name: '2 offline_timestamp in seconds',
    raw: row({ ts: '2024-05-01T20:03:20Z', platform: 'ios', offline_timestamp: 1714593600 }), // 2024-05-01T20:00:00Z
    expect: { start: ms('2024-05-01T20:00:00Z'), startSource: 'offline_timestamp', kind: 'music', platformGroup: 'iOS' } },
  { name: '3 offline_timestamp in milliseconds',
    raw: row({ ts: '2024-05-01T21:03:20Z', platform: 'osx', offline_timestamp: 1714597200000 }), // 21:00:00Z
    expect: { start: ms('2024-05-01T21:00:00Z'), startSource: 'offline_timestamp', kind: 'music', platformGroup: 'Desktop' } },
  { name: '4a offline batch, first of three sharing one ts',
    raw: row({ ts: '2019-07-04T18:00:00Z', offline: true, offline_timestamp: 1562245200, spotify_track_uri: 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB' }), // 13:00:00Z
    expect: { start: ms('2019-07-04T13:00:00Z'), startSource: 'offline_timestamp', kind: 'music', platformGroup: 'iOS' } },
  { name: '4b offline batch, second',
    raw: row({ ts: '2019-07-04T18:00:00Z', offline: true, offline_timestamp: 1562245400, spotify_track_uri: 'spotify:track:CCCCCCCCCCCCCCCCCCCCCC' }),
    expect: { start: ms('2019-07-04T13:03:20Z'), startSource: 'offline_timestamp', kind: 'music', platformGroup: 'iOS' } },
  { name: '4c offline batch: same song replayed, same ts+uri+ms, different offline_timestamp → NOT a duplicate',
    raw: row({ ts: '2019-07-04T18:00:00Z', offline: true, offline_timestamp: 1562245600, spotify_track_uri: 'spotify:track:CCCCCCCCCCCCCCCCCCCCCC' }),
    expect: { start: ms('2019-07-04T13:06:40Z'), startSource: 'offline_timestamp', kind: 'music', platformGroup: 'iOS' } },
  { name: '5 byte-identical copy of #1 → duplicate',
    raw: row({}), expect: { start: ms('2020-03-01T12:00:00Z') - 200_000, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS', duplicate: true } },
  { name: '6 copy of #1 with a different ip_addr only → still a duplicate (ip is never part of the key)',
    raw: row({ ip_addr: '198.51.100.99' }), expect: { start: ms('2020-03-01T12:00:00Z') - 200_000, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS', duplicate: true } },
  { name: '7 podcast episode',
    raw: row({ ts: '2021-01-10T08:30:00Z', ms_played: 1_800_000, spotify_track_uri: null, master_metadata_track_name: null, master_metadata_album_artist_name: null, master_metadata_album_album_name: null, episode_name: 'Ep 1', episode_show_name: 'A Show', spotify_episode_uri: 'spotify:episode:EEEEEEEEEEEEEEEEEEEEEE' }),
    expect: { start: ms('2021-01-10T08:00:00Z'), startSource: 'ts_minus_ms', kind: 'podcast', platformGroup: 'iOS' } },
  { name: '8 audiobook chapter',
    raw: row({ ts: '2025-02-02T22:00:00Z', ms_played: 600_000, spotify_track_uri: null, master_metadata_track_name: null, master_metadata_album_artist_name: null, master_metadata_album_album_name: null, audiobook_title: 'A Book', audiobook_uri: 'spotify:show:BOOK', audiobook_chapter_uri: 'spotify:episode:CH1', audiobook_chapter_title: 'Chapter 1', platform: 'android' }),
    expect: { start: ms('2025-02-02T21:50:00Z'), startSource: 'ts_minus_ms', kind: 'audiobook', platformGroup: 'Android' } },
  { name: '9 every metadata field null → unknown',
    raw: row({ ts: '2022-06-01T00:00:10Z', ms_played: 10_000, spotify_track_uri: null, master_metadata_track_name: null, master_metadata_album_artist_name: null, master_metadata_album_album_name: null, platform: 'not_applicable' }),
    expect: { start: ms('2022-06-01T00:00:00Z'), startSource: 'ts_minus_ms', kind: 'unknown', platformGroup: 'Other' } },
  { name: '10 offline_timestamp AFTER ts (impossible) → fall back to ts − ms',
    raw: row({ ts: '2024-01-01T10:00:00Z', platform: 'ios', ms_played: 60_000, offline_timestamp: 1704106800 }), // 11:00:00Z, an hour after it ended
    expect: { start: ms('2024-01-01T09:59:00Z'), startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS' } },
  { name: '11 offline_timestamp two years before ts (implausible) → fall back',
    raw: row({ ts: '2024-01-01T10:00:00Z', platform: 'ios', ms_played: 60_000, offline_timestamp: 1640995200 }),
    expect: { start: ms('2024-01-01T09:59:00Z'), startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS' } },
  { name: '12 ms_played = 0 → starts when it ends',
    raw: row({ ts: '2023-03-03T03:03:03Z', ms_played: 0, reason_end: 'fwdbtn', platform: 'windows' }),
    expect: { start: ms('2023-03-03T03:03:03Z'), startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'Desktop' } },
  { name: '13 old Mac platform string',
    raw: row({ ts: '2018-08-08T08:08:08Z', platform: 'OS X 10.14.6 [x86 8]', ms_played: 8_000 }),
    expect: { start: ms('2018-08-08T08:08:00Z'), startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'Desktop' } },
  { name: '14 old Android platform string',
    raw: row({ ts: '2018-08-09T08:00:00Z', platform: 'Android OS 9 API 28 (samsung, SM-G960U)' }),
    expect: { start: ms('2018-08-09T08:00:00Z') - 200_000, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'Android' } },
  { name: '15 web player string (mentions osx, but it is the web player)',
    raw: row({ ts: '2018-08-10T08:00:00Z', platform: 'web_player osx 10.15.7;chrome 96.0.4664.110;desktop' }),
    expect: { start: ms('2018-08-10T08:00:00Z') - 200_000, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'Web' } },
  { name: '16 unknown country ZZ',
    raw: row({ ts: '2020-04-01T12:00:00Z', conn_country: 'ZZ' }),
    expect: { start: ms('2020-04-01T12:00:00Z') - 200_000, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS' } },
  { name: '17 incognito, shuffled, skipped',
    raw: row({ ts: '2020-04-02T12:00:00Z', incognito_mode: true, shuffle: true, skipped: true, ms_played: 5_000, reason_end: 'fwdbtn' }),
    expect: { start: ms('2020-04-02T11:59:55Z'), startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS' } },
  { name: '18 same track, same ts as #1 but different ms_played → different play',
    raw: row({ ms_played: 199_999 }),
    expect: { start: ms('2020-03-01T12:00:00Z') - 199_999, startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'iOS' } },
  { name: '19 CarPlay',
    raw: row({ ts: '2025-07-07T17:00:00Z', platform: 'ios (carplay)', ms_played: 100_000 }),
    expect: { start: ms('2025-07-07T16:58:20Z'), startSource: 'ts_minus_ms', kind: 'music', platformGroup: 'Car' } },
];
