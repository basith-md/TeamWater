import type { MeshEvent, MeshMessage, MeshNode, MeshState, Scenario } from './types';

// Authored demo fixture geometry and timings; this is not a mesh simulator.
const nodes: MeshNode[] = [
  { id: 'node0', name: 'Boss · Base camp', x: 60, y: 240, color: '#ed6a29', online: true },
  { id: 'node1', name: 'North relay', x: 165, y: 120, color: '#9aab89', online: true },
  { id: 'node2', name: 'Playa relay', x: 285, y: 240, color: '#9aab89', online: true },
  { id: 'node3', name: 'Art relay', x: 390, y: 110, color: '#9aab89', online: true },
  { id: 'node4', name: 'Employee · Burning Man', x: 510, y: 235, color: '#ed6a29', online: true },
  { id: 'node5', name: 'Temple relay', x: 275, y: 50, color: '#9aab89', online: true },
];
const links = [
  { from: 'node0', to: 'node1' }, { from: 'node1', to: 'node2' },
  { from: 'node2', to: 'node3' }, { from: 'node3', to: 'node4' },
  { from: 'node1', to: 'node5' }, { from: 'node5', to: 'node3' },
];
export function initialState(mode: MeshState['mode'], endpoint: string, scenario: Scenario = 'clean', playbackSpeed = 1): MeshState {
  const fixtureNodes = mode === 'replay' ? nodes.map(n => ({ ...n, online: scenario !== 'outage' || n.id !== 'node2' })) : [];
  return {
    mode, endpoint, scenario, connection: mode === 'replay' ? 'connected' : 'disconnected',
    nodes: fixtureNodes, ai: null,
    links: mode === 'replay' ? links.filter(e => fixtureNodes.find(n => n.id === e.from)?.online && fixtureNodes.find(n => n.id === e.to)?.online) : [],
    messages: {}, events: [], config: { bitRate: mode === 'replay' ? 5000 : null, lossRate: mode === 'replay' ? scenario === 'lossy' ? 0.2 : 0 : null, rangeMeters: mode === 'replay' ? 180 : null, playbackSpeed },
    capabilities: { packetEvents: mode === 'replay', controls: mode === 'replay', verifiedContent: mode === 'replay' }, error: null,
  };
}
export interface TraceStep { delay: number; event?: Omit<MeshEvent, 'id' | 'sequence' | 'at'>; patch?: Partial<MeshMessage> }
export function authorTrace(message: MeshMessage, scenario: Scenario, bytes: number): TraceStep[] {
  const forward = scenario === 'outage' ? ['node0', 'node1', 'node5', 'node3', 'node4'] : ['node0', 'node1', 'node2', 'node3', 'node4'];
  const path = message.src === 'node0' ? forward : [...forward].reverse();
  const steps: TraceStep[] = [];
  let offset = 0;
  const event = (delay: number, kind: MeshEvent['kind'], from: string, to: string, chunk: number, packetBytes: number, patch?: Partial<MeshMessage>) => steps.push({ delay, event: { messageId: message.id, kind, from, to, packetId: `${message.id}:chunk${chunk}`, bytes: packetBytes, detail: 'Authored demo replay' }, patch });
  const control = (base: number, label: string, size: number, chunk: number) => {
    const reverse = [...path].reverse();
    for (let hop = 0; hop < reverse.length - 1; hop++) {
      for (const [kind, delay] of [['packet_tx', 12], ['packet_rx', 24]] as const) {
        steps.push({ delay: base + hop * 24 + delay, event: {
          messageId: message.id, kind, from: reverse[hop], to: reverse[hop + 1],
          packetId: `${message.id}:${label}${chunk}`, bytes: size, detail: `Authored demo replay · ${label}`,
        } });
      }
    }
  };
  if (scenario === 'outage') steps.push({ delay: 0, event: { messageId: message.id, kind: 'route_changed', from: message.src, to: message.dst, packetId: `${message.id}:route`, bytes: 0, detail: 'Authored demo replay · Playa relay offline; route via Temple relay' }, patch: { route: path } });
  for (let chunk = 0; chunk < message.totalChunks; chunk++) {
    const size = Math.min(120, bytes - chunk * 120);
    event(offset, 'packet_enqueued', path[0], path[1], chunk, size);
    for (let hop = 0; hop < path.length - 1; hop++) {
      event(offset + 60, 'packet_tx', path[hop], path[hop + 1], chunk, size, { status: 'in_transit' });
      if (scenario === 'lossy' && hop === 1 && chunk === 0) {
        event(offset + 180, 'packet_dropped', path[hop], path[hop + 1], chunk, size);
        event(offset + 480, 'packet_retry', path[hop], path[hop + 1], chunk, size);
        offset += 600;
        event(offset + 60, 'packet_tx', path[hop], path[hop + 1], chunk, size);
      }
      event(offset + 300, 'packet_rx', path[hop], path[hop + 1], chunk, size, { route: path.slice(0, hop + 2), ...(hop === path.length - 2 ? { received: chunk + 1, status: chunk + 1 === message.totalChunks ? 'reassembled' : 'in_transit' } : {}) });
      offset += 360;
    }
    control(offset, 'ACK', 12, chunk);
    event(offset + 120, 'chunk_ack', path[1], message.src, chunk, 0, { acked: chunk + 1 });
    offset += 180;
  }
  control(offset - 60, 'receipt', 24, message.totalChunks - 1);
  event(offset + 60, 'receipt_verified', path[1], message.src, message.totalChunks - 1, 0, { status: 'delivered', integrity: 'verified', receiptConfirmed: true, etaSeconds: 0 });
  return steps.sort((a, b) => a.delay - b.delay);
}
