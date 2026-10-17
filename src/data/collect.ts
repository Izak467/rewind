// Walks whatever the user picked (zips, folders, loose JSONs, any mix) and yields the JSON
// files inside, one at a time, so a big export never sits in memory all at once.
import { unzipSync } from 'fflate';

export interface InputFile {
  /** Display path, including any zip names it was found inside. */
  path: string;
  /** Lazily produce the bytes; called only for files we decide to open. */
  bytes: () => Promise<Uint8Array>;
}

export interface Entry {
  path: string;
  /** Only call after deciding, by name, that this file may be opened. */
  read: () => Promise<Uint8Array>;
}

export type CollectEvent =
  | { type: 'entry'; entry: Entry }
  | { type: 'broken'; path: string; problem: string }
  | { type: 'ignored'; path: string };

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05);
const isMacJunk = (p: string) => /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._/.test(p) || /\.DS_Store$/.test(p);

/** List a zip's entries without decompressing them. */
function listZip(zip: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(zip, { filter: (f) => { names.push(f.name); return false; } });
  return names;
}

/** Decompress exactly one entry. Re-scanning the directory each time is cheap. */
function readZipEntry(zip: Uint8Array, name: string): Uint8Array {
  const out = unzipSync(zip, { filter: (f) => f.name === name });
  const data = out[name];
  if (!data) throw new Error('entry vanished');
  return data;
}

function* walkZip(zip: Uint8Array, prefix: string, depth: number): Generator<CollectEvent> {
  let names: string[];
  try {
    names = listZip(zip);
  } catch {
    yield { type: 'broken', path: prefix, problem: "This zip file is damaged or incomplete. Try downloading it again from Spotify's email." };
    return;
  }
  for (const name of names) {
    if (name.endsWith('/') || isMacJunk(name)) continue;
    const path = `${prefix}/${name}`;
    if (/\.zip$/i.test(name)) {
      if (depth >= 3) { yield { type: 'ignored', path }; continue; }
      let inner: Uint8Array;
      try { inner = readZipEntry(zip, name); } catch {
        yield { type: 'broken', path, problem: 'A zip inside the upload could not be opened.' };
        continue;
      }
      yield* walkZip(inner, path, depth + 1);
      continue;
    }
    if (!/\.json$/i.test(name)) { yield { type: 'ignored', path }; continue; }
    yield { type: 'entry', entry: { path, read: async () => readZipEntry(zip, name) } };
  }
}

/** Yields every JSON file across all inputs, opening zips (nested up to 3 deep) along the way. */
export async function* collect(inputs: InputFile[]): AsyncGenerator<CollectEvent> {
  for (const input of inputs) {
    if (isMacJunk(input.path)) continue;
    const lower = input.path.toLowerCase();
    if (lower.endsWith('.json')) {
      // Loose JSON: nothing is read until the caller decides, by name, that it may be opened.
      yield { type: 'entry', entry: { path: input.path, read: input.bytes } };
      continue;
    }
    let bytes: Uint8Array;
    try { bytes = await input.bytes(); } catch {
      yield { type: 'broken', path: input.path, problem: 'This file could not be read from your device.' };
      continue;
    }
    if (isZip(bytes)) { yield* walkZip(bytes, input.path, 0); continue; }
    if (lower.endsWith('.zip')) {
      yield { type: 'broken', path: input.path, problem: "This file is named .zip but isn't a working zip. It may not have finished downloading." };
      continue;
    }
    yield { type: 'ignored', path: input.path };
  }
}
