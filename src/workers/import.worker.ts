// Background worker: parsing and saving happen here so the screen never freezes.
import * as Comlink from 'comlink';
import { dexieSink } from '../data/db';
import { importFiles } from '../data/importer';
import type { ImportReport, Progress } from '../data/types';

const api = {
  async import(files: File[], onProgress: (p: Progress) => void): Promise<ImportReport> {
    const inputs = files.map((f) => ({
      // webkitRelativePath keeps folder structure for folder uploads on desktop.
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      bytes: async () => new Uint8Array(await f.arrayBuffer()),
    }));
    return importFiles(inputs, dexieSink(), onProgress);
  },
};

export type ImportWorkerApi = typeof api;
Comlink.expose(api);
