// Phase 1 test harness: upload → background import → on-device storage → report.
// Not the real Get Your Data page (that's Phase 3); this exists to test the pipeline on a phone.
import * as Comlink from 'comlink';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteEverything, requestPersistence, storedSummary } from './data/db';
import type { FileReport, ImportReport, Progress } from './data/types';
import type { ImportWorkerApi } from './workers/import.worker';

type State =
  | { s: 'loading' }
  | { s: 'idle'; stored: number; span?: [number, number] }
  | { s: 'working'; progress: Progress; started: number }
  | { s: 'done'; report: ImportReport; secs: number; stored: number }
  | { s: 'error'; message: string };

const STEP_LABEL: Record<Progress['step'], string> = { reading: 'Reading', organizing: 'Organizing', saving: 'Saving', done: 'Done' };
const KIND_LABEL: Record<FileReport['kind'], string> = {
  'extended-audio': 'Listening history', 'extended-video': 'Video (ignored)', 'account-streaming': 'Account data: listening',
  'account-extra': 'Account data', 'private-skipped': 'Private (never opened)', unrelated: 'Not used', broken: 'Problem',
};

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const short = (path: string) => path.split('/').pop();

export function App() {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [over, setOver] = useState(false);
  const worker = useRef<Comlink.Remote<ImportWorkerApi>>();

  const refresh = useCallback(async () => {
    try {
      setState({ s: 'idle', ...(await storedSummary()) });
    } catch (e) {
      setState({ s: 'error', message: `This browser won't let Rewind save data (${(e as Error).message}). Private browsing blocks storage. Open it in a normal tab.` });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const run = useCallback(async (files: File[]) => {
    if (!files.length) return;
    worker.current ??= Comlink.wrap<ImportWorkerApi>(new Worker(new URL('./workers/import.worker.ts', import.meta.url), { type: 'module' }));
    const started = performance.now();
    setState({ s: 'working', progress: { step: 'reading', fraction: 0 }, started });
    try {
      const report = await worker.current.import(files, Comlink.proxy((progress: Progress) => setState({ s: 'working', progress, started })));
      await requestPersistence();
      const { stored } = await storedSummary();
      setState({ s: 'done', report, secs: (performance.now() - started) / 1000, stored });
    } catch (e) {
      setState({ s: 'error', message: `Import stopped: ${(e as Error).message}` });
    }
  }, []);

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setOver(false); run([...e.dataTransfer.files]); };

  return (
    <main onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <h1>Rewind</h1>
      <p>Phase 1 test page. Your files are read on this device and never uploaded anywhere.</p>

      {state.s === 'loading' && <p>Checking what's saved on this device…</p>}

      {state.s === 'error' && (<>
        <p className="bad">{state.message}</p>
        <button className="btn" onClick={refresh}>Try again</button>
      </>)}

      {(state.s === 'idle' || state.s === 'done') && (<>
        <label className={`drop ${over ? 'over' : ''}`}>
          <input type="file" multiple accept=".zip,.json,application/zip,application/x-zip-compressed,application/json"
            onChange={(e) => { run([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <strong>Choose your Spotify file(s)</strong>
          <p style={{ margin: '8px 0 0' }}>Zipped, unzipped, or individual JSON files all work. On a computer you can drop them here.</p>
        </label>
      </>)}

      {state.s === 'idle' && (
        <>
          <div className="label">Saved on this device</div>
          {state.stored
            ? <><div className="big">{state.stored.toLocaleString()} plays</div><p>{fmtDate(state.span![0])} – {fmtDate(state.span![1])}</p></>
            : <p>Nothing yet.</p>}
        </>
      )}

      {state.s === 'working' && (<>
        <div className="label">{STEP_LABEL[state.progress.step]} · {Math.round(state.progress.fraction * 100)}%</div>
        <div className="bar"><div style={{ width: `${state.progress.fraction * 100}%` }} /></div>
        <p>{state.progress.detail}</p>
      </>)}

      {state.s === 'done' && <Report report={state.report} secs={state.secs} stored={state.stored} />}

      {state.s === 'idle' && state.stored > 0 && (
        <>
          <div className="label">Settings</div>
          <button className="btn" onClick={async () => {
            if (!confirm('Delete every play saved on this device? You can upload again any time.')) return;
            await deleteEverything(); refresh();
          }}>Delete all my data</button>
        </>
      )}
    </main>
  );
}

function Report({ report: r, secs, stored }: { report: ImportReport; secs: number; stored: number }) {
  const shown = r.files.filter((f) => f.kind !== 'unrelated');
  const ignored = r.files.filter((f) => f.kind === 'unrelated');
  return (<>
    <div className="label">Result · {secs.toFixed(1)} s</div>
    {r.problem
      ? <p className="bad">{r.problem}</p>
      : <>
          <div className="big">Added {r.added.toLocaleString()}</div>
          <p>Skipped {r.duplicates.toLocaleString()} duplicates · {stored.toLocaleString()} plays saved in total
            {r.firstTs && <> · {fmtDate(Date.parse(r.firstTs))} – {fmtDate(Date.parse(r.lastTs!))}</>}</p>
        </>}
    {r.hasAccount && <p>Account data found: {r.accountParts.join(', ')}.</p>}
    <div className="label">Files</div>
    {shown.map((f) => (
      <div className="row" key={f.path}>
        <span>{short(f.path)}{f.problem && <><br /><span className="bad">{f.problem}</span></>}</span>
        <span className={f.kind === 'broken' ? 'bad' : ''}>{f.kind === 'extended-audio' ? `${f.added!.toLocaleString()} new` : KIND_LABEL[f.kind]}</span>
      </div>
    ))}
    {ignored.length > 0 && (
      <details><summary>Ignored {ignored.length} unrelated file{ignored.length > 1 ? 's' : ''}</summary>
        {ignored.map((f) => <div className="row" key={f.path}><span>{short(f.path)}</span><span>Not used</span></div>)}
      </details>
    )}
    <p style={{ marginTop: 24 }}><button className="btn" onClick={() => location.reload()}>Done</button></p>
  </>);
}
