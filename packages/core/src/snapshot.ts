import type { AiRequest, AiStage, AiState, LinkMetric, MeshEvent, MeshLink, MeshMessage, MeshNode, RouteProof } from './types';
import type { BackendMessage, BackendMessageStatus, BackendNode, BackendState } from './backend-types';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const string = (value: unknown): value is string => typeof value === 'string';
const statuses = Object.keys({ sending: true, in_transit: true, delivered: true, failed: true, awaiting_receipt: true, receipt_unconfirmed: true, cancelled: true } satisfies Record<BackendMessageStatus, true>).concat('reassembled');
const num = (v: unknown, d = 0) => (finite(v) ? v : d);
function parseLink(l: unknown): LinkMetric | null {
  if (!object(l) || !string(l.source) || !string(l.destination) || !finite(l.distance) || !finite(l.loss) || !finite(l.etx)) return null;
  return { from: l.source, to: l.destination, distance: l.distance, loss: l.loss, etx: l.etx };
}
function parseProof(p: unknown): RouteProof | undefined {
  if (!object(p) || !Array.isArray(p.chosen) || !p.chosen.every(string) || !Array.isArray(p.alternatives) || !Array.isArray(p.links)) return undefined;
  return {
    metric: string(p.metric) ? p.metric : '', chosen: p.chosen as string[], chosenCost: num(p.chosen_cost), chosenDistance: num(p.chosen_distance),
    candidatesChecked: num(p.candidates_checked), verifiedBy: Array.isArray(p.verified_by) ? p.verified_by.filter(string) : [], optimal: p.optimal === true,
    links: p.links.map(parseLink).filter((l): l is LinkMetric => !!l),
    alternatives: p.alternatives.filter(object).filter(a => Array.isArray(a.path) && a.path.every(string)).map(a => ({ path: a.path as string[], hops: num(a.hops), cost: num(a.cost), distance: num(a.distance), extraCost: num(a.extra_cost) })),
  };
}
const kinds = Object.keys({ text: true, image: true, voice: true, video: true, ai_request: true, ai_response: true } satisfies Record<BackendMessage['media_type'], true>);

const aiStages: AiStage[] = ['waiting_for_gateway', 'to_gateway', 'ai_working', 'answer_arriving', 'answered', 'failed'];
const outcomes = ['ok', 'general', 'blocked', 'over_budget', 'no_grounding', 'error'];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter(string) : [];

/** Water AI state is optional: older services omit it, and a malformed request is skipped, never fatal. */
export function normalizeAi(value: unknown): AiState | null {
  if (!object(value) || !Array.isArray(value.requests)) return null;
  const requests: AiRequest[] = [];
  for (const r of value.requests) {
    if (!object(r) || !string(r.request_id) || !string(r.asker) || !string(r.question) || !aiStages.includes(r.stage as AiStage)) continue;
    const stages = Array.isArray(r.stages) ? r.stages.filter((s): s is { stage: AiStage; at: number } => object(s) && aiStages.includes(s.stage as AiStage) && finite(s.at)) : [];
    requests.push({
      id: r.request_id, asker: r.asker, gateway: string(r.gateway) ? r.gateway : null, question: r.question,
      modelIndex: finite(r.model_index) ? r.model_index : 0, model: string(r.model) ? r.model : '',
      stage: r.stage as AiStage, stages: stages.map(s => ({ stage: s.stage, at: s.at * 1000 })),
      attempts: finite(r.attempts) ? r.attempts : 0,
      requestMessageIds: strings(r.request_msg_ids), answerMessageIds: strings(r.answer_msg_ids),
      answer: string(r.answer) ? r.answer : null,
      outcome: outcomes.includes(r.outcome as string) ? r.outcome as AiRequest['outcome'] : null,
      sources: strings(r.sources), receipt: r.receipt === true,
      error: string(r.error) ? r.error : '', note: string(r.note) ? r.note : '',
      createdAt: finite(r.created_at) ? r.created_at * 1000 : 0,
    });
  }
  return { internetNode: string(value.internet_node) ? value.internet_node : null, connectedNodes: strings(value.connected_nodes), requests };
}

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
      ...(parseProof(m.route_proof) ? { routeProof: parseProof(m.route_proof) } : {}),
      ...(string(m.receiver_status) ? { receiverStatus: m.receiver_status } : {}),
      ...(finite(m.radio_bytes) && m.radio_bytes >= 0 ? { radioBytes: m.radio_bytes } : {}),
      ...(finite(m.lost_packets) && m.lost_packets >= 0 ? { lostPackets: m.lost_packets } : {}),
      ...(finite(m.retries) && m.retries >= 0 ? { retries: m.retries } : {}),
      ...(finite(m.frames_sent) && Number.isInteger(m.frames_sent) && m.frames_sent >= 0 ? { framesSent: m.frames_sent } : {}),
      ...(verified && finite(m.receiver_verified_at) && m.receiver_verified_at >= 0 && Number.isFinite(m.receiver_verified_at * 1000) ? { receiverVerifiedSeconds: m.receiver_verified_at } : {}),
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
  return { nodes, links, messages, contentPaths, events, ai: normalizeAi(value.ai),
    packetEvents: Array.isArray(value.events),
    simulationTime: simulation && finite(simulation.simulation_time) ? simulation.simulation_time : null,
    bitRate: simulation && finite(simulation.bit_rate) && simulation.bit_rate > 0 ? simulation.bit_rate : null,
    lossRate: simulation && finite(simulation.loss_rate) && simulation.loss_rate >= 0 && simulation.loss_rate <= 1 ? simulation.loss_rate : null,
    playbackSpeed: simulation && finite(simulation.playback_speed) && simulation.playback_speed > 0 ? simulation.playback_speed : 1,
    distanceRouting: !!simulation && simulation.distance_routing === true,
    linkMetrics: simulation && Array.isArray(simulation.link_metrics) ? simulation.link_metrics.map(parseLink).filter((l): l is LinkMetric => !!l) : [],
    rangeMeters: simulation && finite(simulation.range_meters) && simulation.range_meters > 0 ? simulation.range_meters : null,
  };
}
