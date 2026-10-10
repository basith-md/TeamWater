import type { MeshEvent, MeshLink, MeshMessage, MeshNode } from './types';
import type { BackendMessage, BackendNode, BackendState } from './backend-types';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const string = (value: unknown): value is string => typeof value === 'string';
const statuses = ['sending', 'in_transit', 'reassembled', 'delivered', 'failed', 'awaiting_receipt', 'receipt_unconfirmed'];
const kinds = ['text', 'image', 'voice'];

/** Legacy service snapshots contain aggregate progress only, never verified content. */
export function normalizeSnapshot(value: unknown) {
  if (!object(value) || value.type !== 'state' || !Array.isArray(value.nodes) || !object(value.connections) || !object(value.messages)) throw new Error('Invalid service snapshot');
  const nodes: MeshNode[] = value.nodes.map(n => {
    if (!object(n) || !string(n.id) || !string(n.name) || !finite(n.x) || !finite(n.y) || !string(n.color)) throw new Error('Invalid node in snapshot');
    const canonical = { id: n.id, name: n.name, x: n.x, y: n.y, color: n.color } satisfies BackendNode;
    return { ...canonical, online: typeof n.online === 'boolean' ? n.online : true };
  });
  const ids = new Set(nodes.map(n => n.id));
  if (ids.size !== nodes.length) throw new Error('Duplicate nodes in snapshot');
  const links: MeshLink[] = []; const edges = new Set<string>();
  for (const [from, destinations] of Object.entries(value.connections)) {
    if (!ids.has(from) || !Array.isArray(destinations)) throw new Error('Invalid connections in snapshot');
    for (const to of destinations) {
      if (!string(to) || !ids.has(to)) throw new Error('Invalid connection in snapshot');
      const key = [from, to].sort().join(':');
      if (from !== to && !edges.has(key)) { edges.add(key); links.push({ from, to }); }
    }
  }
  const messages: Record<string, MeshMessage> = Object.create(null);
  const contentPaths: Record<string, string> = Object.create(null);
  for (const [id, m] of Object.entries(value.messages)) {
    if (!object(m) || m.msg_id !== id || !string(m.src) || !string(m.dst) || !finite(m.total_chunks) || m.total_chunks < 1 || !finite(m.received) || !finite(m.acked) || !string(m.status) || !statuses.includes(m.status) || !Array.isArray(m.route) || !m.route.every(string) || !string(m.media_type) || !kinds.includes(m.media_type) || !string(m.preview) || (m.created_at !== undefined && !finite(m.created_at))) throw new Error('Invalid message in snapshot');
    const totalChunks = Math.floor(m.total_chunks);
    const verified = m.receiver_status === 'verified';
    messages[id] = {
      id, src: m.src, dst: m.dst, kind: m.media_type as BackendMessage['media_type'], preview: m.preview,
      totalChunks, received: Math.max(0, Math.min(totalChunks, Math.floor(m.received))),
      acked: Math.max(0, Math.min(totalChunks, Math.floor(m.acked))), status: m.status as MeshMessage['status'],
      route: m.route as BackendState['messages'][string]['route'], createdAt: finite(m.created_at) && Number.isFinite(m.created_at * 1000) ? m.created_at * 1000 : null,
      etaSeconds: finite(m.eta) ? Math.max(0, m.eta) : null,
      integrity: verified ? 'verified' : 'unverified', receiptConfirmed: verified && m.status === 'delivered',
      ...(string(m.receiver_status) ? { receiverStatus: m.receiver_status } : {}),
      ...(finite(m.radio_bytes) && m.radio_bytes >= 0 ? { radioBytes: m.radio_bytes } : {}),
      ...(finite(m.lost_packets) && m.lost_packets >= 0 ? { lostPackets: m.lost_packets } : {}),
      ...(finite(m.retries) && m.retries >= 0 ? { retries: m.retries } : {}),
      ...(finite(m.airtime_seconds) && m.airtime_seconds >= 0 ? { airtimeSeconds: m.airtime_seconds } : {}),
      ...(object(m.metadata) && finite(m.metadata.encoded_bytes) && m.metadata.encoded_bytes >= 0 ? { encodedBytes: m.metadata.encoded_bytes } : {}),
      ...(object(m.metadata) && finite(m.metadata.transfer_bytes) && m.metadata.transfer_bytes >= 0 ? { transferBytes: m.metadata.transfer_bytes } : {}),
    };
    if (verified && /^[a-zA-Z0-9_-]+$/.test(id) && m.content_url === `/messages/${id}/content`) contentPaths[id] = m.content_url;
  }
  const events: MeshEvent[] = [];
  const supported = ['packet_tx', 'packet_rx', 'packet_dropped', 'receipt_verified', 'no_route'];
  if (Array.isArray(value.events)) for (const e of value.events) {
    if (!object(e) || !finite(e.sequence) || e.sequence < 1 || !Number.isInteger(e.sequence) || !string(e.type) || !supported.includes(e.type) || !string(e.msg_id) || !finite(e.simulation_time)) continue;
    events.push({ id: `live:${e.sequence}`, sequence: e.sequence, at: e.simulation_time * 1000, messageId: e.msg_id,
      kind: e.type as MeshEvent['kind'], from: string(e.source) ? e.source : messages[e.msg_id]?.dst ?? '',
      to: string(e.destination) ? e.destination : messages[e.msg_id]?.src ?? '',
      packetId: `${e.msg_id}:${e.kind ?? 'control'}:${e.chunk ?? 'unknown'}:${e.sequence}`,
      bytes: finite(e.frame_bytes) && e.frame_bytes >= 0 ? e.frame_bytes : null,
      ...(finite(e.kind) ? { packetKind: e.kind } : {}), ...(finite(e.chunk) ? { chunk: e.chunk } : {}),
      detail: 'Backend packet trace · simulated channel airtime timestamp',
    });
  }
  const simulation = object(value.simulation) ? value.simulation : null;
  return { nodes, links, messages, contentPaths, events,
    packetEvents: Array.isArray(value.events),
    simulationTime: simulation && finite(simulation.simulation_time) ? simulation.simulation_time : null,
    bitRate: simulation && finite(simulation.bit_rate) && simulation.bit_rate > 0 ? simulation.bit_rate : null,
    lossRate: simulation && finite(simulation.loss_rate) && simulation.loss_rate >= 0 && simulation.loss_rate <= 1 ? simulation.loss_rate : null,
  };
}
