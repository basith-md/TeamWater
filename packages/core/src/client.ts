import type { MediaAsset, MeshClient, MeshMessage, MeshState, Mode, Scenario } from './types';
import { authorTrace, initialState } from './replay';
import { normalizeSnapshot } from './snapshot';
import { mergeEvents } from './events';
import type { BackendImageResponse, BackendMediaRequest, BackendTextRequest, LegacySendResponse } from './backend-types';

function urls(endpoint: string) {
  const base = endpoint.trim().replace(/\/+$/, '').replace(/\/ws$/, '');
  const http = base.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  const absolute = new URL(`${http}/ws`, typeof location !== 'undefined' ? location.href : 'http://localhost:8000');
  absolute.protocol = absolute.protocol === 'https:' ? 'wss:' : 'ws:';
  return { http, ws: absolute.toString() };
}

function utf8Size(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function createMeshClient(options: { mode?: Mode; endpoint?: string } = {}): MeshClient {
  let state = initialState(options.mode ?? 'replay', options.endpoint ?? '/api');
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const requests = new Set<AbortController>();
  let socket: WebSocket | null = null;
  let generation = 0; let started = false; let disposed = false; let attempts = 0; let messageSequence = 0;
  let contentGeneration = 0; let lastSequence = 0; let lastSimulationTime: number | null = null;
  const contentJobs = new Map<string, { path: string; attempts: number; busy: boolean; exhausted: boolean; error: string | null }>();
  const emit = (patch: Partial<MeshState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  function contentError(messages = state.messages): string | null {
    const jobs = Object.keys(messages).map(id => contentJobs.get(id)).filter(job => job?.error);
    return jobs.find(job => job?.exhausted)?.error ?? jobs[0]?.error ?? null;
  }
  function schedule(callback: () => void, delay: number) {
    const session = generation;
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed && session === generation) callback(); }, delay);
    timers.add(timer);
  }
  function cancel() {
    generation++; contentGeneration++; contentJobs.clear(); lastSequence = 0; lastSimulationTime = null;
    timers.forEach(clearTimeout); timers.clear(); requests.forEach(r => r.abort()); requests.clear();
    const old = socket; socket = null; old?.close(); attempts = 0;
  }
  async function loadText(id: string, path: string) {
    let job = contentJobs.get(id);
    if (!job || job.path !== path) { job = { path, attempts: 0, busy: false, exhausted: false, error: null }; contentJobs.set(id, job); }
    if (job.busy || job.exhausted) return;
    job.busy = true; job.attempts++;
    const session = generation; const contentSession = contentGeneration;
    const controller = new AbortController(); requests.add(controller);
    const active = () => !disposed && session === generation && contentSession === contentGeneration;
    const deadline = setTimeout(() => controller.abort(), 15000); timers.add(deadline);
    try {
      const response = await fetch(`${urls(state.endpoint).http}${path}`, { signal: controller.signal });
      if (!active()) return;
      if (!response.ok) throw new Error(`Verified content unavailable (${response.status}).`);
      if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/plain')) throw new Error('Unexpected verified text content type.');
      const text = await response.text();
      const message = state.messages[id];
      if (active() && message?.integrity === 'verified' && message.kind === 'text') {
        job.busy = false; job.error = null;
        emit({ messages: { ...state.messages, [id]: { ...message, text } }, error: contentError() });
      }
    } catch (error) {
      if (active()) {
        const reason = error instanceof Error ? error.message : 'Unable to load verified content.';
        job.exhausted = job.attempts >= 3;
        job.error = job.exhausted
          ? `Verified content failed after 3 attempts. Restart live mode to retry. ${reason}`
          : `Verified content unavailable; retrying (${job.attempts}/3). ${reason}`;
        emit({ error: contentError() });
        if (!job.exhausted) {
          const currentJob = job;
          schedule(() => {
            if (!active() || contentJobs.get(id) !== currentJob) return;
            currentJob.busy = false;
            if (state.messages[id]?.integrity === 'verified' && state.messages[id]?.text === undefined) void loadText(id, path);
          }, job.attempts * 500);
        }
      }
    } finally { clearTimeout(deadline); timers.delete(deadline); requests.delete(controller); }
  }
  function receiveSnapshot(value: unknown) {
    const snapshot = normalizeSnapshot(value);
    const newest = snapshot.events.at(-1)?.sequence ?? 0;
    const restarted = (lastSequence > 0 && newest < lastSequence) || (lastSimulationTime !== null && snapshot.simulationTime !== null && snapshot.simulationTime < lastSimulationTime);
    if (restarted) {
      contentGeneration++; contentJobs.clear(); requests.forEach(controller => controller.abort()); requests.clear();
      lastSequence = 0;
    }
    const previous = restarted ? [] : state.events;
    const merged = mergeEvents(previous, snapshot.events);
    const complete = (restarted ? true : state.eventHistoryComplete ?? true) && merged.every((event, index) => event.sequence === (index ? merged[index - 1].sequence + 1 : 1)) && merged.length <= 2000;
    const messages = snapshot.messages;
    for (const [id, message] of Object.entries(messages)) {
      const old = restarted ? undefined : state.messages[id];
      if (message.integrity === 'verified' && old?.integrity === 'verified' && message.kind === old.kind && message.src === old.src && message.dst === old.dst && message.createdAt === old.createdAt) {
        if (old.text !== undefined) message.text = old.text;
      }
      const path = snapshot.contentPaths[id];
      if (path && message.kind !== 'text') message.mediaUrl = `${urls(state.endpoint).http}${path}`;
    }
    lastSequence = newest; lastSimulationTime = snapshot.simulationTime;
    emit({ nodes: snapshot.nodes, links: snapshot.links, messages, events: merged.slice(-2000), eventHistoryComplete: complete,
      config: { ...state.config, bitRate: snapshot.bitRate, lossRate: snapshot.lossRate, rangeMeters: snapshot.rangeMeters },
      capabilities: { packetEvents: snapshot.packetEvents, controls: false, verifiedContent: snapshot.packetEvents || Object.values(messages).some(m => m.receiverStatus !== undefined) },
      connection: 'connected', error: contentError(messages) });
    for (const [id, path] of Object.entries(snapshot.contentPaths)) if (messages[id].kind === 'text' && messages[id].text === undefined) void loadText(id, path);
  }
  function connect() {
    if (disposed || state.mode !== 'live') return;
    emit({ connection: 'connecting' }); const session = generation;
    try {
      const ws = new WebSocket(urls(state.endpoint).ws); socket = ws;
      const active = () => !disposed && session === generation && socket === ws;
      ws.onopen = () => { if (active()) { attempts = 0; emit({ connection: 'connected', error: contentError() }); } };
      ws.onmessage = event => {
        if (!active()) return;
        try { receiveSnapshot(JSON.parse(String(event.data))); }
        catch { emit({ error: 'Invalid service snapshot; last valid state retained.' }); }
      };
      ws.onerror = () => { if (active()) emit({ connection: 'error', error: 'Unable to connect to mesh service.' }); };
      ws.onclose = () => {
        if (!active()) return; socket = null; emit({ connection: 'disconnected' });
        if (attempts < 5) { const delay = Math.min(1000 * 2 ** attempts++, 8000); schedule(connect, delay); }
        else emit({ error: 'Connection lost. Restart live mode to reconnect.' });
      };
    } catch (error) { emit({ connection: 'error', error: error instanceof Error ? error.message : 'Connection failed' }); }
  }
  async function post(path: string, form: FormData) {
    const session = generation; const contentSession = contentGeneration; const controller = new AbortController(); requests.add(controller);
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    timers.add(deadline);
    try {
      const response = await fetch(`${urls(state.endpoint).http}${path}`, { method: 'POST', body: form, signal: controller.signal });
      if (disposed || session !== generation || contentSession !== contentGeneration) throw new Error('Session changed; send cancelled.');
      if (!response.ok) throw new Error(`Send failed (${response.status}). Try again.`);
      const result: unknown = await response.json();
      if (disposed || session !== generation || contentSession !== contentGeneration) throw new Error('Session changed; send cancelled.');
      if (!result || typeof result !== 'object' || !('msg_id' in result) || typeof result.msg_id !== 'string' || !('chunks' in result) || typeof result.chunks !== 'number' || !Number.isInteger(result.chunks) || result.chunks < 1) throw new Error('Invalid send response.');
      const canonical = { msg_id: result.msg_id, chunks: result.chunks } satisfies LegacySendResponse;
      if (path === '/send/image') {
        if (!('original' in result) || typeof result.original !== 'number' || !Number.isFinite(result.original) || result.original < 0 || !('compressed' in result) || typeof result.compressed !== 'number' || !Number.isFinite(result.compressed) || result.compressed < 0) throw new Error('Invalid send response.');
        const image = { ...canonical, original: result.original, compressed: result.compressed } satisfies Pick<BackendImageResponse, 'msg_id' | 'chunks' | 'original' | 'compressed'>;
        emit({ error: contentError() }); return image.msg_id;
      }
      emit({ error: contentError() }); return canonical.msg_id;
    } catch (error) {
      const issue = disposed || session !== generation || contentSession !== contentGeneration ? new Error('Session changed; send cancelled.') : timedOut ? new Error('Send timed out. Try again.') : error instanceof Error ? error : new Error('Send failed. Try again.');
      if (!disposed && session === generation && contentSession === contentGeneration) emit({ error: issue.message }); throw issue;
    } finally { clearTimeout(deadline); timers.delete(deadline); requests.delete(controller); }
  }
  function replay(src: string, dst: string, kind: MeshMessage['kind'], text?: string): string {
    if (!((src === 'node0' && dst === 'node4') || (src === 'node4' && dst === 'node0'))) throw new Error('Replay supports the boss and employee endpoints.');
    const id = `replay-${++messageSequence}`; const createdAt = Date.now();
    const bytes = kind === 'text' ? utf8Size(text!) : kind === 'image' ? 480 : 360;
    const message: MeshMessage = {
      id, src, dst, kind, preview: kind === 'text' ? text! : kind === 'image' ? 'Demo replay · sample playa image' : 'Demo replay · sample voice note',
      ...(kind === 'text' ? { text } : {}), totalChunks: Math.max(1, Math.ceil(bytes / 120)), received: 0, acked: 0,
      status: 'sending', route: [src], createdAt, etaSeconds: null, integrity: 'unverified', receiptConfirmed: false,
    };
    emit({ messages: { ...state.messages, [id]: message }, error: null });
    const speed = state.config.playbackSpeed;
    for (const step of authorTrace(message, state.scenario, bytes)) schedule(() => {
      const current = state.messages[id]; if (!current) return;
      const events = step.event ? [...state.events, { ...step.event, id: `${id}:event${state.events.length + 1}`, sequence: state.events.length + 1, at: createdAt + step.delay }] : state.events;
      const patch = step.patch ?? {};
      emit({ events, messages: { ...state.messages, [id]: { ...current, ...patch, ...(patch.receiptConfirmed ? { completedAt: createdAt + step.delay } : {}) } } });
    }, step.delay / speed);
    return id;
  }
  function ensureActive() { if (disposed) throw new Error('Client has been disposed.'); }
  const client: MeshClient = {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => { if (started && !disposed) return; disposed = false; started = true; if (state.mode === 'live') connect(); },
    dispose: () => { disposed = true; started = false; cancel(); },
    setMode: (mode, endpoint = state.endpoint) => { cancel(); disposed = false; emit(initialState(mode, endpoint, state.scenario, state.config.playbackSpeed)); if (started && mode === 'live') connect(); },
    setScenario: (scenario: Scenario) => { if (state.mode !== 'replay') return; cancel(); emit(initialState('replay', state.endpoint, scenario, state.config.playbackSpeed)); },
    setPlaybackSpeed: speed => { if (state.mode === 'replay' && Number.isFinite(speed) && speed > 0) emit({ config: { ...state.config, playbackSpeed: Math.max(0.25, Math.min(4, speed)) } }); },
    reset: () => { cancel(); emit(initialState(state.mode, state.endpoint, state.scenario, state.config.playbackSpeed)); if (started && state.mode === 'live') connect(); },
    sendText: async (src, dst, text) => {
      ensureActive(); if (!text.trim()) throw new Error('Enter a message.');
      if (state.mode === 'replay') return replay(src, dst, 'text', text);
      const fields = { src, dst, text } satisfies BackendTextRequest;
      const form = new FormData(); for (const [field, value] of Object.entries(fields)) form.append(field, value); return post('/send/text', form);
    },
    sendMedia: async (src, dst, kind, asset: MediaAsset) => {
      ensureActive(); if (state.mode === 'replay') return replay(src, dst, kind);
      const fields = { src, dst } satisfies Pick<BackendMediaRequest, 'src' | 'dst'>;
      const form = new FormData(); for (const [field, value] of Object.entries(fields)) form.append(field, value);
      if (asset.file) form.append('file', asset.file, asset.name);
      else if (asset.uri) form.append('file', { uri: asset.uri, name: asset.name, type: asset.type } as unknown as Blob);
      else throw new Error('Choose a media file first.');
      return post(`/send/${kind}`, form);
    },
  };
  return client;
}
