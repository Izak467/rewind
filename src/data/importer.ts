// The import pipeline. Runs inside a Web Worker in the app, and directly in Node for tests.
import { collect, type CollectEvent, type InputFile } from './collect';
import { accountPartFor, judgeByContent, judgeByName } from './detect';
import { normalizePlay } from './normalize';
import type { FileReport, ImportReport, Play, Progress } from './types';

/** Where plays end up. IndexedDB in the app, memory in tests. */
export interface PlaySink {
  existingIds(): Promise<Set<string>>;
  addPlays(plays: Play[]): Promise<void>;
}

const CHUNK = 5000;
const decoder = new TextDecoder();

export async function importFiles(
  inputs: InputFile[],
  sink: PlaySink,
  onProgress: (p: Progress) => void = () => {},
): Promise<ImportReport> {
  onProgress({ step: 'reading', fraction: 0, detail: 'Opening files' });

  // Listing is cheap (zip directories only), so do it first to get real percentages.
  const events: CollectEvent[] = [];
  for await (const ev of collect(inputs)) events.push(ev);

  const seen = await sink.existingIds();
  const report: ImportReport = {
    files: [], added: 0, duplicates: 0, plays: 0,
    hasExtended: false, hasAccount: false, accountParts: [],
  };
  const parts = new Set<string>();
  const entries = events.filter((e) => e.type === 'entry').length || 1;
  let done = 0;

  for (const ev of events) {
    if (ev.type === 'broken') { report.files.push({ path: ev.path, kind: 'broken', problem: ev.problem }); continue; }
    if (ev.type === 'ignored') { report.files.push({ path: ev.path, kind: 'unrelated' }); continue; }

    const { entry } = ev;
    const tick = (step: Progress['step'], within = 0) =>
      onProgress({ step, fraction: Math.min(0.99, (done + within) / entries), detail: entry.path.split('/').pop() });
    tick('reading');

    const byName = judgeByName(entry.path);
    if (byName.kind === 'private-skipped') { report.files.push({ path: entry.path, kind: 'private-skipped' }); done++; continue; }
    if (byName.kind === 'extended-video') { report.files.push({ path: entry.path, kind: 'extended-video' }); done++; continue; }
    if (byName.kind === 'account-extra') {
      // Recognized by name. Its contents are read later, by the feature that uses it.
      report.files.push({ path: entry.path, kind: 'account-extra' });
      parts.add(byName.part); report.hasAccount = true; done++; continue;
    }
    if (byName.kind === 'not-json') { report.files.push({ path: entry.path, kind: 'unrelated' }); done++; continue; }

    let data: unknown;
    try {
      data = JSON.parse(decoder.decode(await entry.read()));
    } catch {
      report.files.push({ path: entry.path, kind: 'broken', problem: "This file isn't valid JSON. It may be cut off or damaged, so it was skipped." });
      done++; continue;
    }

    const kind = judgeByContent(data);
    if (kind === 'account-streaming') {
      report.files.push({ path: entry.path, kind, rows: (data as unknown[]).length });
      report.hasAccount = true;
      const part = accountPartFor(entry.path); if (part) parts.add(part);
      done++; continue;
    }
    if (kind === 'unrelated') { report.files.push({ path: entry.path, kind }); done++; continue; }

    // Extended streaming history.
    const rows = data as Record<string, unknown>[];
    data = null;
    const file: FileReport = { path: entry.path, kind, rows: rows.length, added: 0, duplicates: 0 };
    let batch: Play[] = [];
    for (let i = 0; i < rows.length; i++) {
      const p = normalizePlay(rows[i]);
      if (!p) continue;
      const ts = rows[i].ts as string;
      if (!file.firstTs || ts < file.firstTs) file.firstTs = ts;
      if (!file.lastTs || ts > file.lastTs) file.lastTs = ts;
      if (seen.has(p.id)) { file.duplicates!++; continue; }
      seen.add(p.id);
      batch.push(p);
      if (batch.length >= CHUNK) {
        tick('saving', i / rows.length);
        await sink.addPlays(batch); file.added! += batch.length; batch = [];
      }
    }
    if (batch.length) { await sink.addPlays(batch); file.added! += batch.length; }
    report.files.push(file);
    report.hasExtended = true;
    report.plays += rows.length;
    report.added += file.added!;
    report.duplicates += file.duplicates!;
    if (file.firstTs && (!report.firstTs || file.firstTs < report.firstTs)) report.firstTs = file.firstTs;
    if (file.lastTs && (!report.lastTs || file.lastTs > report.lastTs)) report.lastTs = file.lastTs;
    done++;
  }

  report.accountParts = [...parts];
  if (!report.hasExtended) {
    const broken = report.files.filter((f) => f.kind === 'broken').length;
    report.problem = report.hasAccount
      ? "This is your Account data, which only covers the past year. For your full history, upload the Extended streaming history export. It's a separate email from Spotify."
      : broken
        ? 'None of these files could be read. They may be damaged. Try downloading them again.'
        : "We couldn't find any Spotify listening history in these files. Look for my_spotify_data.zip with Streaming_History_Audio files inside.";
  }
  onProgress({ step: 'done', fraction: 1 });
  return report;
}

/** In-memory sink, for tests and Node scripts. */
export class MemorySink implements PlaySink {
  plays = new Map<string, Play>();
  async existingIds() { return new Set(this.plays.keys()); }
  async addPlays(plays: Play[]) { for (const p of plays) this.plays.set(p.id, p); }
}

/** Wrap a Node buffer or browser File as an InputFile. */
export function inputFromBytes(path: string, bytes: Uint8Array): InputFile {
  return { path, bytes: async () => bytes };
}
