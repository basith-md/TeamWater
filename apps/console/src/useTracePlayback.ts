import { useEffect, useRef, useState } from 'react';
import type { MeshEvent } from '@teamwater/core';

interface Playback {
  key: string; lastSequence: number; current: MeshEvent | null; queue: MeshEvent[];
  skipped: number; observed: number; serial: number;
}
const empty = (key: string, serial = 0): Playback => ({ key, lastSequence: -Infinity, current: null, queue: [], skipped: 0, observed: 0, serial });

/** Presentation timing only. Every queued hop comes from an observed packet_tx. */
export function useTracePlayback(events: MeshEvent[], key: string) {
  const model = useRef<Playback>(empty(key));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [view, setView] = useState({ current: null as MeshEvent | null, queued: 0, skipped: 0, observed: 0, serial: 0 });
  const publish = () => {
    const current = model.current;
    setView({ current: current.current, queued: current.queue.length, skipped: current.skipped, observed: current.observed, serial: current.serial });
  };
  const clearTimer = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const advance = (run: Playback) => {
    if (run !== model.current) return;
    run.current = run.queue.shift() ?? null;
    if (run.current) {
      run.serial++;
      timer.current = setTimeout(() => { timer.current = null; advance(run); }, 600);
    }
    publish();
  };
  const consume = (restart = false) => {
    let changed = false;
    if (restart || model.current.key !== key || (!events.length && model.current.observed > 0)) {
      clearTimer(); model.current = empty(key, model.current.serial); changed = true;
    }
    const run = model.current;
    for (const event of events.filter(event => event.kind === 'packet_tx').sort((a, b) => a.sequence - b.sequence)) {
      if (event.sequence <= run.lastSequence) continue;
      run.lastSequence = event.sequence;
      run.observed++;
      if (run.queue.length + (run.current ? 1 : 0) < 200) run.queue.push(event);
      else run.skipped++;
      changed = true;
    }
    if (!run.current && run.queue.length) { advance(run); return; }
    // React may clean up and re-run effects while preserving the current hop.
    if (run.current && timer.current === null) timer.current = setTimeout(() => { timer.current = null; advance(run); }, 600);
    if (changed) publish();
  };
  useEffect(() => { consume(); }, [events, key]);
  useEffect(() => () => clearTimer(), []);
  return { ...view, replay: () => consume(true) };
}
