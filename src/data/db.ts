// On-device storage (IndexedDB via Dexie). Nothing here ever leaves the device.
//
// Plays are stored in chunks of a few thousand per record, not one record per play: IndexedDB's
// per-record cost made 200k single-play writes take about a minute. The app never queries
// individual plays through IndexedDB (screens read precomputed aggregates, SPEC 3.7), so we lose
// nothing.
import Dexie, { type Table } from 'dexie';
import type { PlaySink } from './importer';
import type { ImportReport, Play } from './types';

export interface PlayChunk { n?: number; plays: Play[]; }
export interface ChunkInfo { n: number; count: number; minStart: number; maxStart: number; }
export interface ImportLog { n?: number; at: number; report: ImportReport; }

export class RewindDB extends Dexie {
  chunks!: Table<PlayChunk, number>;
  chunkInfo!: Table<ChunkInfo, number>;
  imports!: Table<ImportLog, number>;
  constructor() {
    super('rewind');
    this.version(1).stores({ plays: 'id, start', imports: '++n, at' });
    this.version(2).stores({ plays: null, chunks: '++n', chunkInfo: 'n', imports: '++n, at' });
  }
}

export const db = new RewindDB();

export async function* allPlays(database: RewindDB = db): AsyncGenerator<Play[]> {
  const keys = await database.chunks.toCollection().primaryKeys();
  for (const k of keys) {
    const c = await database.chunks.get(k);
    if (c) yield c.plays;
  }
}

export const dexieSink = (database: RewindDB = db): PlaySink => ({
  async existingIds() {
    const ids = new Set<string>();
    for await (const plays of allPlays(database)) for (const p of plays) ids.add(p.id);
    return ids;
  },
  async addPlays(plays) {
    let min = Infinity, max = -Infinity;
    for (const p of plays) { if (p.start < min) min = p.start; if (p.start > max) max = p.start; }
    await database.transaction('rw', database.chunks, database.chunkInfo, async () => {
      const n = await database.chunks.add({ plays });
      await database.chunkInfo.put({ n, count: plays.length, minStart: min, maxStart: max });
    });
  },
});

/** Total stored plays and their date span, without loading the plays themselves. */
export async function storedSummary(database: RewindDB = db): Promise<{ stored: number; span?: [number, number] }> {
  const infos = await database.chunkInfo.toArray();
  const stored = infos.reduce((n, i) => n + i.count, 0);
  if (!stored) return { stored };
  return { stored, span: [Math.min(...infos.map((i) => i.minStart)), Math.max(...infos.map((i) => i.maxStart))] };
}

/** Settings → "Delete all my data". */
export async function deleteEverything(database: RewindDB = db) {
  await database.delete();
  await database.open();
}

/** Ask the browser not to evict our data (helps on iOS Safari). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
