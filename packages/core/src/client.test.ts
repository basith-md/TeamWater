import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from './index';
import type { MeshClient } from './types';
import type { components } from '../../../shared/typescript/api';

class Socket {
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) { Socket.instances.push(this); }
  close() {}
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const legacySnapshot = { nodes: [{ id: 'node0', name: 'Alice', x: 80, y: 300, color: '#007AFF' }, { id: 'node4', name: 'Eve', x: 480, y: 340, color: '#FF2D55' }], connections: { node0: ['node4'], node4: ['node0'] }, messages: { m1: { msg_id: 'm1', src: 'node0', dst: 'node4', total_chunks: 2, received: 2, acked: 2, status: 'delivered', route: ['node0', 'node4'], eta: 0, media_type: 'text', preview: 'Hello', progress: 1, created_at: 1700000000 } } } satisfies components['schemas']['MeshState'];
const wire = (overrides = {}) => ({ type: 'state', ...legacySnapshot, messages: { m1: { ...legacySnapshot.messages.m1, ...overrides } } });
const pipeline = (overrides = {}, events: unknown[] = []) => ({ ...wire({ receiver_status: 'verified', content_url: '/messages/m1/content', metadata: { encoded_bytes: 22, transfer_bytes: 240 }, radio_bytes: 840, retries: 3, lost_packets: 2, airtime_seconds: 7.4, ...overrides }), simulation: { loss_rate: 0.2, bit_rate: 1070, seed: 7, playback_speed: 10, simulation_time: 8, model: 'shared channel, store-and-forward, 50ms overhead per hop' }, events });
const packet = (sequence: number, type: string, extra = {}) => ({ sequence, type, msg_id: 'm1', simulation_time: sequence * 0.1, source: 'node0', destination: 'node4', kind: 1, chunk: 0, ...extra });
let clients: MeshClient[] = [];
function client(mode: 'live' | 'replay' = 'live', endpoint = '/api') {
  expect(core.createMeshClient).toBeTypeOf('function');
  const value = core.createMeshClient({ mode, endpoint }); clients.push(value); return value;
}
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); });
afterEach(() => { clients.forEach(c => c.dispose()); clients = []; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('snapshot truth', () => {
  it('resets live conversation from the returned snapshot while preserving simulator configuration', async () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire({ status: 'in_transit' }));
    const resetSnapshot = { ...wire(), messages: {}, events: [], simulation: { bit_rate: 1000, loss_rate: 0.2, radio_range: 180, playback_speed: 20, simulation_time: 0 }, distance_routing: true };
    const request = vi.fn(async () => Response.json(resetSnapshot)); vi.stubGlobal('fetch', request);
    await c.resetConversation!();
    expect(request).toHaveBeenCalledWith('/api/simulation/reset', expect.objectContaining({ method: 'POST' }));
    expect(c.getSnapshot().messages).toEqual({}); expect(c.getSnapshot().events).toEqual([]);
    expect(c.getSnapshot().nodes.map(n => n.id)).toEqual(['node0', 'node4']);
    expect(c.getSnapshot().config).toMatchObject({ bitRate: 1000, lossRate: 0.2, playbackSpeed: 20 });
    Socket.instances[0].receive(wire());
    expect(c.getSnapshot().messages).toEqual({});
  });

  it('keeps history when conversation reset fails and exposes the error', async () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire());
    vi.stubGlobal('fetch', async () => Response.json({ detail: 'Reset unavailable' }, { status: 503 }));
    await expect(c.resetConversation!()).rejects.toThrow('Reset unavailable');
    expect(c.getSnapshot().messages.m1).toBeDefined();
    expect(c.getSnapshot().error).toBe('Reset unavailable');
  });

  it('ignores a reset response from a superseded endpoint', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { respond = resolve; }));
    const c = client(); c.start();
    const pending = c.resetConversation!();
    c.setMode('live', '/other'); respond(Response.json(wire()));
    await expect(pending).rejects.toThrow(/Session changed/);
    expect(c.getSnapshot().endpoint).toBe('/other'); expect(c.getSnapshot().messages).toEqual({});
  });
  it('reports legacy delivered as ACK received, requiring integrity and a receipt for Delivered', () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire());
    const message = c.getSnapshot().messages.m1;
    expect(core.deliveryLabel(message)).toBe('ACK received');
    expect(message.integrity).toBe('unverified'); expect(message.receiptConfirmed).toBe(false);
    expect(core.deliveryLabel({ ...message, integrity: 'verified', receiptConfirmed: true })).toBe('Delivered');
  });
  it('clamps progress and uses received chunks independently of ACKs', () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire({ received: 50, acked: -3, status: 'in_transit' }));
    expect(c.getSnapshot().messages.m1.received).toBe(2); expect(c.getSnapshot().messages.m1.acked).toBe(0);
  });
  it('does not invent metrics or content from aggregate snapshots', () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire());
    expect(core.deriveTelemetry(c.getSnapshot())).toEqual({ transmittedBytes: null, receivedBytes: null, droppedPackets: null, retries: null, latencyMs: null, observedLossRate: null, bitRate: null, rangeMeters: null, lossRate: null });
    expect(c.getSnapshot().messages.m1.text).toBeUndefined();
  });
  it('replaces snapshots without duplicate links or messages', () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire()); Socket.instances[0].receive(wire());
    expect(Object.keys(c.getSnapshot().messages)).toEqual(['m1']); expect(c.getSnapshot().links).toHaveLength(1);
    Socket.instances[0].receive({ ...wire(), messages: {} }); expect(c.getSnapshot().messages).toEqual({});
  });
  it('rejects malformed snapshots without losing the last valid state', () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire());
    Socket.instances[0].receive({ type: 'state', nodes: null, connections: [], messages: { bad: null } });
    expect(c.getSnapshot().messages.m1.preview).toBe('Hello'); expect(c.getSnapshot().error).toMatch(/snapshot/i);
  });
  it('retains messages with reserved object keys without modifying the record prototype', () => {
    const c = client(); c.start();
    const value = wire();
    const messages = JSON.parse('{"__proto__":{}}'); messages.__proto__ = { ...value.messages.m1, msg_id: '__proto__' };
    Socket.instances[0].receive({ ...value, messages });
    expect(Object.keys(c.getSnapshot().messages)).toEqual(['__proto__']);
  });
  it('accepts the shared schema optional created_at as an unknown timestamp', () => {
    const c = client(); c.start(); Socket.instances[0].receive(wire({ created_at: undefined }));
    expect(c.getSnapshot().messages.m1?.createdAt).toBeNull();
  });
});
describe('live lifecycle and sends', () => {
  it('uses multipart text and surfaces POST failures so drafts can be retained', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/send/text'); const body = init.body as FormData;
      expect(body.get('src')).toBe('node0'); expect(body.get('dst')).toBe('node4'); expect(body.get('text')).toBe('Keep this draft');
      return new Response('offline', { status: 503 });
    });
    const c = client(); await expect(c.sendText('node0', 'node4', 'Keep this draft')).rejects.toThrow(/503/);
    expect(c.getSnapshot().error).toMatch(/503/); expect(c.getSnapshot().messages).toEqual({});
  });
  it('isolates stale sockets and requests after switching modes', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(r => { resolve = r; }));
    const c = client(); c.start(); const old = Socket.instances[0];
    const pending = c.sendText('node0', 'node4', 'stale'); c.setMode('replay');
    old.receive(wire()); resolve(Response.json({ msg_id: 'stale' }));
    await expect(pending).rejects.toThrow(/session/i); expect(c.getSnapshot().messages).toEqual({});
    expect(c.getSnapshot().mode).toBe('replay');
  });
  it('reconnects with a bound and cancels retries when disposed', () => {
    const c = client('live', 'https://example.test'); c.start(); expect(Socket.instances[0].url).toBe('wss://example.test/ws');
    for (let i = 0; i < 6; i++) { Socket.instances.at(-1)?.onclose?.(); vi.runOnlyPendingTimers(); }
    expect(Socket.instances.length).toBeLessThanOrEqual(6); expect(c.getSnapshot().connection).toBe('disconnected');
    c.dispose(); const count = Socket.instances.length; vi.runAllTimers(); expect(Socket.instances).toHaveLength(count);
  });
  it.each([
    ['ws://mesh.test:8000/ws', 'ws://mesh.test:8000/ws', 'http://mesh.test:8000/send/text'],
    ['wss://mesh.test/api/ws', 'wss://mesh.test/api/ws', 'https://mesh.test/api/send/text'],
  ])('supports a WebSocket endpoint %s for HTTP sends', async (endpoint, socketUrl, postUrl) => {
    let posted = '';
    vi.stubGlobal('fetch', async (url: string) => { posted = url; return Response.json({ msg_id: 'accepted', chunks: 1 }); });
    const c = client('live', endpoint); c.start(); expect(Socket.instances[0].url).toBe(socketUrl);
    expect(await c.sendText('node0', 'node4', 'hello')).toBe('accepted'); expect(posted).toBe(postUrl);
  });
  it('surfaces network errors and invalid send responses without optimistic delivery', async () => {
    const c = client(); vi.stubGlobal('fetch', async () => { throw new Error('Network offline'); });
    await expect(c.sendText('node0', 'node4', 'hello')).rejects.toThrow('Network offline');
    vi.stubGlobal('fetch', async () => Response.json({ chunks: 1 }));
    await expect(c.sendText('node0', 'node4', 'hello')).rejects.toThrow('Invalid send response');
    expect(c.getSnapshot().messages).toEqual({});
  });
  it('aborts a stalled request with a recoverable timeout error', async () => {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const c = client(); const sending = c.sendText('node0', 'node4', 'Keep this');
    const assertion = expect(sending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(15000); await assertion;
    expect(c.getSnapshot().error).toMatch(/timed out/i); expect(c.getSnapshot().messages).toEqual({});
  });
  it('rejects send responses missing required shared schema chunk count', async () => {
    const c = client(); vi.stubGlobal('fetch', async () => Response.json({ msg_id: 'incomplete' }));
    await expect(c.sendText('node0', 'node4', 'hello')).rejects.toThrow('Invalid send response');
  });
});
describe('authored replay traces', () => {
  it('starts ready without auto-sending and sends custom content through a verified trace', async () => {
    const c = client('replay'); c.start(); expect(c.getSnapshot().messages).toEqual({});
    const id = await c.sendText('node0', 'node4', 'Meet at camp'); expect(c.getSnapshot().messages[id].status).toBe('sending');
    vi.runAllTimers(); const message = c.getSnapshot().messages[id];
    expect(message.text).toBe('Meet at camp'); expect(core.deliveryLabel(message)).toBe('Delivered');
    expect(message.route).toEqual(['node0', 'node1', 'node2', 'node3', 'node4']);
    expect(core.deriveTelemetry(c.getSnapshot(), id)).toMatchObject({ droppedPackets: 0, retries: 0, observedLossRate: 0, latencyMs: 1680 });
  });
  it('derives loss and retry counts from an authored dropped packet and its retry', async () => {
    const c = client('replay'); c.setScenario('lossy'); const id = await c.sendText('node0', 'node4', 'Test loss'); vi.runAllTimers();
    expect(core.deriveTelemetry(c.getSnapshot(), id)).toMatchObject({ droppedPackets: 1, retries: 1 });
    expect(c.getSnapshot().events.filter(e => e.kind === 'packet_dropped')).toHaveLength(1);
    expect(core.deliveryLabel(c.getSnapshot().messages[id])).toBe('Delivered');
  });
  it('reroutes an outage over connected online relays and records the route change', async () => {
    const c = client('replay'); c.setScenario('outage'); const id = await c.sendText('node0', 'node4', 'Help'); vi.runAllTimers();
    const state = c.getSnapshot(); const message = state.messages[id]; expect(core.deliveryLabel(message)).toBe('Delivered');
    expect(message.route).toEqual(['node0', 'node1', 'node5', 'node3', 'node4']); expect(state.nodes.find(n => n.id === 'node2')?.online).toBe(false);
    expect(state.events.some(e => e.kind === 'route_changed')).toBe(true);
    for (const event of state.events.filter(e => e.kind === 'packet_tx')) {
      expect(state.links.some(l => (l.from === event.from && l.to === event.to) || (l.from === event.to && l.to === event.from))).toBe(true);
    }
  });
  it('reset cancels callbacks and selected telemetry does not leak other messages', async () => {
    const c = client('replay'); await c.sendText('node0', 'node4', 'Old'); c.reset(); vi.runAllTimers();
    expect(c.getSnapshot().messages).toEqual({}); expect(c.getSnapshot().events).toEqual([]);
    const id = await c.sendText('node0', 'node4', 'New'); vi.runAllTimers();
    expect(core.deriveTelemetry(c.getSnapshot(), 'missing').transmittedBytes).toBe(0);
    expect(core.deriveTelemetry(c.getSnapshot(), id).transmittedBytes).toBeGreaterThan(0);
  });
  it('maps roles and sends replay media with clearly sample previews', async () => {
    const c = client('replay'); expect(core.roleNodes('employee')).toEqual({ src: 'node4', dst: 'node0' });
    const id = await c.sendMedia('node4', 'node0', 'voice', { uri: '', name: 'sample', type: 'audio/wav' }); vi.runAllTimers();
    expect(c.getSnapshot().messages[id].preview).toMatch(/sample/i); expect(core.deliveryLabel(c.getSnapshot().messages[id])).toBe('Delivered');
  });
  it('runs on native engines without TextEncoder and sizes UTF-8 text correctly', async () => {
    vi.stubGlobal('TextEncoder', undefined);
    const c = client('replay'); const id = await c.sendText('node0', 'node4', '🌵'.repeat(31)); vi.runAllTimers();
    expect(c.getSnapshot().messages[id].totalChunks).toBe(2);
    expect(core.deriveTelemetry(c.getSnapshot(), id).transmittedBytes).toBe(688);
  });
  it('playback speed changes presentation timing without rewriting authored trace latency', async () => {
    const c = client('replay'); c.setPlaybackSpeed(4); const id = await c.sendText('node0', 'node4', 'Quick');
    vi.advanceTimersByTime(420);
    expect(core.deliveryLabel(c.getSnapshot().messages[id])).toBe('Delivered');
    expect(core.deriveTelemetry(c.getSnapshot(), id).latencyMs).toBe(1680);
  });
  it('accounts for per-hop ACK and receipt traffic with explicitly illustrative fixture settings', async () => {
    const c = client('replay'); const id = await c.sendText('node0', 'node4', 'A'); vi.runAllTimers();
    expect(core.deriveTelemetry(c.getSnapshot(), id)).toMatchObject({ transmittedBytes: 148, receivedBytes: 148, bitRate: 5000, rangeMeters: 180, lossRate: 0 });
    c.setScenario('lossy'); expect(c.getSnapshot().config.lossRate).toBe(0.2);
  });
});

describe('packet/media teammate branch boundary', () => {
  it('consumes published 1.1 counters, range and receiver verification time without a complete trace', () => {
    const published = { ...legacySnapshot, simulation: { loss_rate: 0.2, bit_rate: 1070, seed: 7, playback_speed: 100, simulation_time: 8, model: 'shared channel', fec: true, window_size: 4, range_meters: 250, queue_depth: 0 }, messages: { m1: { ...legacySnapshot.messages.m1, receiver_status: 'verified', status: 'receipt_unconfirmed', frames_sent: 10, lost_packets: 2, radio_bytes: 840, receiver_verified_at: 1.25 } }, events: [packet(200, 'packet_tx', { frame_bytes: 120 })] } satisfies components['schemas']['MeshState'];
    const c = client(); c.start(); Socket.instances[0].receive({ type: 'state', ...published });
    expect(c.getSnapshot().eventHistoryComplete).toBe(false);
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1')).toMatchObject({ observedLossRate: 0.2, rangeMeters: 250, latencyMs: 1250 });
  });
  it('never uses elapsed transfer time as verification latency and rejects invalid published counters', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ receiver_status: 'partial', content_url: null, frames_sent: 10, lost_packets: 2, elapsed_seconds: 8, receiver_verified_at: 1.25 }));
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').latencyMs).toBeNull();
    ws.receive({ ...pipeline({ frames_sent: 1.5, receiver_verified_at: -1, elapsed_seconds: 8 }), simulation: { range_meters: -1 } });
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1')).toMatchObject({ observedLossRate: null, rangeMeters: null, latencyMs: null });
    ws.receive(pipeline({ frames_sent: 1, lost_packets: 2, content_url: null }));
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').observedLossRate).toBeNull();
  });
  it('retains a cancelled published message without claiming it is in transit', () => {
    const c = client(); c.start(); Socket.instances[0].receive(pipeline({ status: 'cancelled', receiver_status: 'partial', content_url: null }));
    expect(c.getSnapshot().messages.m1?.status).toBe('cancelled');
    expect(core.deliveryLabel(c.getSnapshot().messages.m1)).toBe('Cancelled');
  });
  it('retains published media kinds alongside supported text, image and voice messages', () => {
    const c = client(); c.start(); Socket.instances[0].receive(pipeline({ media_type: 'video', content_url: null }));
    expect(c.getSnapshot().messages.m1?.kind).toBe('video');
  });
  it('requires receiver verification and terminal delivered state for Delivered', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ status: 'awaiting_receipt', content_url: null }));
    expect(c.getSnapshot().messages.m1?.integrity).toBe('verified');
    expect(c.getSnapshot().messages.m1.receiptConfirmed).toBe(false);
    expect(core.deliveryLabel(c.getSnapshot().messages.m1)).toMatch(/receipt pending/i);
    ws.receive(pipeline({ status: 'receipt_unconfirmed', content_url: null }));
    expect(core.deliveryLabel(c.getSnapshot().messages.m1)).toMatch(/receipt unconfirmed/i);
    ws.receive(pipeline({ content_url: null })); expect(core.deliveryLabel(c.getSnapshot().messages.m1)).toBe('Delivered');
    ws.receive(pipeline({ receiver_status: 'partial', content_url: null })); expect(core.deliveryLabel(c.getSnapshot().messages.m1)).not.toBe('Delivered');
  });
  it('uses measured message counters and simulation config without inventing latency or range', () => {
    const c = client(); c.start(); Socket.instances[0].receive(pipeline({ content_url: null }, [packet(50, 'packet_tx', { frame_bytes: 230 })]));
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1')).toEqual({ transmittedBytes: 840, receivedBytes: null, droppedPackets: 2, retries: 3, latencyMs: null, observedLossRate: null, bitRate: 1070, rangeMeters: null, lossRate: 0.2 });
  });
  it('reports measured selected-message loss after a late join when captured TX bytes prove its complete transmission history', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ content_url: null, radio_bytes: 0, lost_packets: 0 }, [packet(100, 'packet_tx', { msg_id: 'older', frame_bytes: 64 })]));
    ws.receive(pipeline({ content_url: null, radio_bytes: 294, lost_packets: 1 }, [packet(101, 'packet_tx', { frame_bytes: 230 }), packet(102, 'packet_dropped'), packet(103, 'packet_tx', { frame_bytes: 64 }), packet(104, 'packet_rx')]));
    expect(c.getSnapshot().eventHistoryComplete).toBe(false);
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').observedLossRate).toBe(0.5);
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').latencyMs).toBeNull();
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').rangeMeters).toBeNull();
  });
  it.each([
    [packet(50, 'packet_tx', { frame_bytes: 230 })],
    [packet(50, 'packet_tx', { frame_bytes: 230 }), packet(51, 'packet_tx')],
    [packet(50, 'packet_tx', { frame_bytes: 230 }), packet(51, 'packet_tx', { frame_bytes: 63 })],
  ])('keeps selected-message loss unavailable when transmission bytes cannot prove completeness %#', (...events) => {
    const c = client(); c.start(); Socket.instances[0].receive(pipeline({ content_url: null, radio_bytes: 294, lost_packets: 1 }, events));
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').observedLossRate).toBeNull();
  });
  it('loses selected-message completeness after its transmission events leave the bounded ring', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ content_url: null, radio_bytes: 294, lost_packets: 1 }, [packet(1, 'packet_tx', { frame_bytes: 230 }), packet(2, 'packet_dropped'), packet(3, 'packet_tx', { frame_bytes: 64 }), packet(4, 'packet_rx')]));
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').observedLossRate).toBe(0.5);
    for (let batch = 0; batch < 21; batch++) ws.receive(pipeline({ content_url: null, radio_bytes: 294, lost_packets: 1 }, Array.from({ length: 100 }, (_, i) => packet(batch * 100 + i + 5, 'packet_tx', { msg_id: 'newer', frame_bytes: 64 }))));
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').observedLossRate).toBeNull();
  });
  it('deduplicates rolling events across snapshots and correlates receive byte sizes only with an observed transmission', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ content_url: null }, [packet(1, 'packet_tx', { frame_bytes: 230 })]));
    ws.receive(pipeline({ content_url: null }, [packet(1, 'packet_tx', { frame_bytes: 230 }), packet(2, 'packet_rx')]));
    ws.receive(pipeline({ content_url: null }, [packet(2, 'packet_rx'), packet(3, 'packet_rx', { chunk: 1 })]));
    expect(c.getSnapshot().events.map(e => e.sequence)).toEqual([1, 2, 3]);
    expect(c.getSnapshot().events.map(e => e.bytes)).toEqual([230, 230, null]);
    expect(core.deriveTelemetry(c.getSnapshot(), 'm1').receivedBytes).toBeNull();
  });
  it('clears stale ring history on a backend restart and accepts the new low sequence', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ content_url: null }, [packet(100, 'packet_tx', { frame_bytes: 230 })]));
    ws.receive({ ...pipeline(), messages: {}, events: [], simulation: { ...pipeline().simulation, simulation_time: 0 } });
    expect(c.getSnapshot().events).toEqual([]); expect(c.getSnapshot().messages).toEqual({});
    ws.receive(pipeline({ content_url: null }, [packet(1, 'packet_tx', { frame_bytes: 64 })]));
    expect(c.getSnapshot().events.map(e => e.sequence)).toEqual([1]);
  });
  it('bounds merged event history and marks totals incomplete once history is discarded', () => {
    const c = client(); c.start(); const ws = Socket.instances[0];
    for (let batch = 0; batch < 21; batch++) ws.receive(pipeline({ content_url: null }, Array.from({ length: 100 }, (_, i) => packet(batch * 100 + i + 1, 'packet_tx', { frame_bytes: 64 }))));
    expect(c.getSnapshot().events).toHaveLength(2000); expect(c.getSnapshot().events[0].sequence).toBe(101);
    expect(c.getSnapshot().eventHistoryComplete).toBe(false);
  });
  it('fetches full verified text once and retains it across aggregate updates', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', async (url: string) => { expect(url).toBe('/api/messages/m1/content'); reads++; return new Response('Full reconstructed text', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); });
    const c = client(); c.start(); const ws = Socket.instances[0]; ws.receive(pipeline());
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getSnapshot().messages.m1.text).toBe('Full reconstructed text');
    ws.receive(pipeline()); await vi.advanceTimersByTimeAsync(0);
    expect(c.getSnapshot().messages.m1.text).toBe('Full reconstructed text'); expect(reads).toBe(1);
  });
  it('never fetches unverified content and only exposes safe verified local media paths', async () => {
    let reads = 0; vi.stubGlobal('fetch', async () => { reads++; return new Response('Unsafe'); });
    const c = client('live', 'http://mesh.test:8001'); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({ receiver_status: 'partial', media_type: 'image', content_url: '/messages/m1/content' }));
    expect(c.getSnapshot().messages.m1.mediaUrl).toBeUndefined();
    ws.receive(pipeline({ media_type: 'image', content_url: 'https://other.test/stolen' }));
    expect(c.getSnapshot().messages.m1.mediaUrl).toBeUndefined();
    ws.receive(pipeline({ media_type: 'image' }));
    expect(c.getSnapshot().messages.m1.mediaUrl).toBe('http://mesh.test:8001/messages/m1/content');
    await vi.advanceTimersByTimeAsync(0); expect(reads).toBe(0);
  });
  it('ignores stale verified text fetched before a same-endpoint backend restart', async () => {
    let resolve!: (response: Response) => void; vi.stubGlobal('fetch', () => new Promise<Response>(r => { resolve = r; }));
    const c = client(); c.start(); const ws = Socket.instances[0];
    ws.receive(pipeline({}, [packet(12, 'packet_tx', { frame_bytes: 230 })]));
    ws.receive({ ...pipeline(), messages: {}, events: [], simulation: { ...pipeline().simulation, simulation_time: 0 } });
    expect(resolve).toBeTypeOf('function'); resolve(new Response('Stale verified text')); await vi.advanceTimersByTimeAsync(0);
    expect(c.getSnapshot().messages).toEqual({}); expect(c.getSnapshot().error).toBeNull();
  });
  it('recovers verified text after a transient GET failure without requiring another snapshot', async () => {
    let reads = 0;
    vi.stubGlobal('fetch', async () => ++reads === 1 ? new Response('unavailable', { status: 503 }) : new Response('Recovered verified text', { headers: { 'Content-Type': 'text/plain' } }));
    const c = client(); c.start(); Socket.instances[0].receive(pipeline());
    await vi.advanceTimersByTimeAsync(3000);
    expect(c.getSnapshot().messages.m1.text).toBe('Recovered verified text'); expect(reads).toBe(2); expect(c.getSnapshot().error).toBeNull();
  });
  it.each(['dispose', 'mode switch'] as const)('cancels automatic content retry after %s', async action => {
    let reads = 0; vi.stubGlobal('fetch', async () => { reads++; return new Response('unavailable', { status: 503 }); });
    const c = client(); c.start(); Socket.instances[0].receive(pipeline()); await vi.advanceTimersByTimeAsync(0);
    if (action === 'dispose') c.dispose(); else c.setMode('replay');
    await vi.advanceTimersByTimeAsync(10000); expect(reads).toBe(1);
  });
  it('bounds permanent content failures even when more snapshots arrive and explains recovery', async () => {
    let reads = 0; vi.stubGlobal('fetch', async () => { reads++; throw new Error('Network offline'); });
    const c = client(); c.start(); const ws = Socket.instances[0]; ws.receive(pipeline()); await vi.advanceTimersByTimeAsync(10000);
    expect(reads).toBe(3); expect(c.getSnapshot().error).toMatch(/3 attempts.*restart live/i);
    ws.receive(pipeline()); ws.receive(pipeline()); await vi.advanceTimersByTimeAsync(10000);
    expect(reads).toBe(3); expect(c.getSnapshot().error).toMatch(/restart live/i);
  });
  it('retains one message exhausted content error when another message succeeds without further snapshots', async () => {
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/m1/content') ? new Response('unavailable', { status: 503 }) : new Response('Second verified message', { headers: { 'Content-Type': 'text/plain' } }));
    const c = client(); c.start(); const ws = Socket.instances[0]; ws.receive(pipeline()); await vi.advanceTimersByTimeAsync(10000);
    expect(c.getSnapshot().error).toMatch(/3 attempts/);
    const snapshot = pipeline();
    ws.receive({ ...snapshot, messages: { ...snapshot.messages, m2: { ...snapshot.messages.m1, msg_id: 'm2', content_url: '/messages/m2/content' } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getSnapshot().messages.m2.text).toBe('Second verified message');
    expect(c.getSnapshot().error ?? '').toMatch(/3 attempts.*restart live/i);
    ws.onopen?.(); expect(c.getSnapshot().error ?? '').toMatch(/restart live/i);
    vi.stubGlobal('fetch', async () => Response.json({ msg_id: 'accepted', chunks: 1 }));
    await c.sendText('node0', 'node4', 'Third message');
    expect(c.getSnapshot().error ?? '').toMatch(/restart live/i);
  });
});
