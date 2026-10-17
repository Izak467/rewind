import { describe, expect, it } from 'vitest';
import { judgeByContent, judgeByName } from '../src/data/detect';
import { importFiles, inputFromBytes, MemorySink } from '../src/data/importer';
import { normalizePlay, offlineTimestampToMs, platformGroup } from '../src/data/normalize';
import { HANDMADE } from './fixtures/handmade';

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe('hand-made plays (known answers)', () => {
  for (const { name, raw, expect: want } of HANDMADE) {
    it(name, () => {
      const p = normalizePlay(structuredClone(raw))!;
      expect(p.start).toBe(want.start);
      expect(p.startSource).toBe(want.startSource);
      expect(p.kind).toBe(want.kind);
      expect(p.platformGroup).toBe(want.platformGroup);
    });
  }

  it('drops exactly the rows marked duplicate when imported together', async () => {
    const sink = new MemorySink();
    const r = await importFiles([inputFromBytes('Streaming_History_Audio_hand.json', enc(HANDMADE.map((h) => h.raw)))], sink);
    const dupes = HANDMADE.filter((h) => h.expect.duplicate).length;
    expect(r.duplicates).toBe(dupes);
    expect(r.added).toBe(HANDMADE.length - dupes);
    expect(sink.plays.size).toBe(HANDMADE.length - dupes);
  });

  it('never stores ip_addr', async () => {
    const sink = new MemorySink();
    await importFiles([inputFromBytes('Streaming_History_Audio_hand.json', enc(HANDMADE.map((h) => h.raw)))], sink);
    const stored = JSON.stringify([...sink.plays.values()]);
    expect(stored).not.toMatch(/203\.0\.113|198\.51\.100|ip_addr/);
  });

  it('maps ZZ to an unknown country and keeps flags', () => {
    const byNum = (n: string) => HANDMADE.find((h) => h.name.startsWith(n + ' '))!.raw;
    expect(normalizePlay(structuredClone(byNum('16')))!.country).toBeNull();
    const p = normalizePlay(structuredClone(byNum('17')))!;
    expect([p.incognito, p.shuffle, p.skipped]).toEqual([true, true, true]);
  });
});

describe('offline_timestamp units', () => {
  it('reads seconds and milliseconds', () => {
    expect(offlineTimestampToMs(1714593600)).toBe(1714593600000);
    expect(offlineTimestampToMs(1714593600123)).toBe(1714593600123);
    expect(offlineTimestampToMs(0)).toBeNull();
    expect(offlineTimestampToMs(null)).toBeNull();
  });
});

describe('platform groups', () => {
  it.each([
    ['iOS 15.4.1 (iPhone13,4)', 'iOS'], ['ios', 'iOS'], ['osx', 'Desktop'], ['windows', 'Desktop'],
    ['OS X 10.10.5 [x86 8]', 'Desktop'], ['not_applicable', 'Other'], [null, 'Other'],
    ['Android OS 9 API 28 (samsung, SM-G960U)', 'Android'], ['android_tv', 'TV'], ['Sonos Play:1', 'Speaker'],
    ['PlayStation 4', 'Console'], ['web_player windows 10;chrome', 'Web'],
    // Shapes seen in a real export (serials replaced):
    ['Partner google cast_tv;Chromecast;;2.0.0-000-x--1.40.1', 'TV'],
    ['Partner android_tv Amazon;AFTXXXX;0000;;tpapi', 'TV'],
    ['Partner amazon_salmon Amazon;Echo_Dot;0000;;tpapi', 'Speaker'],
    ['Partner google cast_voice;Google_Home_Mini;;2.2.2-x--1.42.1', 'Speaker'],
    ['Partner spotify web_player', 'Web'], ['unknown', 'Other'],
  ])('%s → %s', (raw, group) => expect(platformGroup(raw)).toBe(group));
});

describe('file recognition', () => {
  it('judges by name first', () => {
    expect(judgeByName('x/Streaming_History_Video_2024.json').kind).toBe('extended-video');
    expect(judgeByName('x/Streaming_History_Audio_2024_1.json').kind).toBe('inspect');
    expect(judgeByName('x/Userdata.json').kind).toBe('private-skipped');
    expect(judgeByName('x/Payments.json').kind).toBe('private-skipped');
    expect(judgeByName('x/Identifiers.json').kind).toBe('private-skipped');
    expect(judgeByName('x/Wrapped2025.json')).toEqual({ kind: 'account-extra', part: 'Wrapped' });
    expect(judgeByName('x/ReadMeFirst.pdf').kind).toBe('not-json');
    expect(judgeByName('renamed-by-user.json').kind).toBe('inspect');
  });

  it('judges by contents, not names', () => {
    expect(judgeByContent(HANDMADE.map((h) => h.raw))).toBe('extended-audio');
    expect(judgeByContent([{ endTime: '2025-01-01 10:00', artistName: 'a', trackName: 't', msPlayed: 1 }])).toBe('account-streaming');
    expect(judgeByContent([{ name: 'x' }])).toBe('unrelated');
    expect(judgeByContent({ playlists: [] })).toBe('unrelated');
    expect(judgeByContent([])).toBe('unrelated');
  });
});
