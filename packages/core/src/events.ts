import type { MeshEvent } from './types';

/** RX/drop sizes are only known when one earlier, unconsumed hop TX unambiguously identifies them. */
export function mergeEvents(previous: MeshEvent[], incoming: MeshEvent[]): MeshEvent[] {
  const bySequence = new Map(previous.map(e => [e.sequence, e]));
  for (const event of incoming) if (!bySequence.has(event.sequence)) bySequence.set(event.sequence, event);
  const events = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
  const pending: MeshEvent[] = [];
  return events.map(event => {
    if (event.kind === 'packet_tx') { pending.push(event); return event; }
    if (event.kind !== 'packet_rx' && event.kind !== 'packet_dropped') return event;
    const matches = pending.filter(tx => tx.messageId === event.messageId && tx.from === event.from && tx.to === event.to && tx.packetKind === event.packetKind && (event.chunk === undefined || tx.chunk === event.chunk));
    for (const match of matches) pending.splice(pending.indexOf(match), 1);
    if (event.bytes !== null || matches.length !== 1) return event;
    return { ...event, packetId: matches[0].packetId, bytes: matches[0].bytes };
  });
}
