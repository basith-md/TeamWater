import type { MeshMessage, MeshState, Role, Telemetry } from './types';

export const roleNodes = (role: Role) => role === 'boss'
  ? { src: 'node0', dst: 'node4' } : { src: 'node4', dst: 'node0' };

export function deliveryLabel(message: MeshMessage): string {
  if (message.status === 'failed') return 'Failed';
  if (message.integrity === 'verified' && message.receiptConfirmed) return 'Delivered';
  if (message.status === 'receipt_unconfirmed') return 'Receiver verified · receipt unconfirmed';
  if (message.integrity === 'verified') return 'Receiver verified · receipt pending';
  if (message.status === 'delivered') return 'ACK received';
  if (message.status === 'reassembled') return 'Reassembled · unverified';
  return message.status === 'sending' ? 'Sending' : 'In transit';
}

export function deriveTelemetry(state: MeshState, messageId?: string): Telemetry {
  const base = { bitRate: state.config.bitRate, rangeMeters: state.config.rangeMeters, lossRate: state.config.lossRate };
  if (!state.capabilities.packetEvents) return {
    ...base, transmittedBytes: null, receivedBytes: null, droppedPackets: null,
    retries: null, latencyMs: null, observedLossRate: null,
  };
  const events = state.events.filter(e => !messageId || e.messageId === messageId);
  const tx = events.filter(e => e.kind === 'packet_tx');
  const drops = events.filter(e => e.kind === 'packet_dropped');
  const messages = Object.values(state.messages).filter(m => !messageId || m.id === messageId);
  if (state.mode === 'live') {
    const total = (field: 'radioBytes' | 'lostPackets' | 'retries') => messages.length && messages.every(m => m[field] !== undefined)
      ? messages.reduce((sum, m) => sum + m[field]!, 0) : null;
    const received = events.filter(e => e.kind === 'packet_rx');
    return {
      ...base, transmittedBytes: total('radioBytes'), droppedPackets: total('lostPackets'), retries: total('retries'),
      receivedBytes: state.eventHistoryComplete && received.every(e => e.bytes !== null) ? received.reduce((sum, e) => sum + e.bytes!, 0) : null,
      latencyMs: null,
      observedLossRate: state.eventHistoryComplete && tx.length ? drops.length / tx.length : null,
    };
  }
  const completed = messages.filter(m => m.completedAt !== undefined && m.createdAt !== null);
  return {
    ...base,
    transmittedBytes: tx.reduce((sum, e) => sum + (e.bytes ?? 0), 0),
    receivedBytes: events.filter(e => e.kind === 'packet_rx').reduce((sum, e) => sum + (e.bytes ?? 0), 0),
    droppedPackets: drops.length,
    retries: events.filter(e => e.kind === 'packet_retry').length,
    latencyMs: completed.length ? completed.reduce((sum, m) => sum + m.completedAt! - m.createdAt!, 0) / completed.length : null,
    observedLossRate: tx.length ? drops.length / tx.length : null,
  };
}
