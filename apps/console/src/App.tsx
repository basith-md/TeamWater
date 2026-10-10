import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, ChevronRight, CircleHelp, Radio, RotateCcw, Settings2, ShieldCheck, Signal, Waves, X } from 'lucide-react';
import { deliveryLabel, deriveTelemetry, useMesh } from '@teamwater/core';
import type { MeshClient, MeshEvent, MeshMessage, MeshState } from '@teamwater/core';
import { PhoneChat, PhoneIdentity } from '@teamwater/mobile-ui';
import { pickBrowserMedia } from './browserMedia';
import { VerifiedAudio } from './VerifiedAudio';
import { useTracePlayback } from './useTracePlayback';
import { VoiceRecorder } from './VoiceRecorder';
import './styles.css';

const eventLabels: Record<MeshEvent['kind'], string> = {
  packet_enqueued: 'Enqueued', packet_tx: 'Transmitted', packet_rx: 'Received', packet_dropped: 'Dropped',
  packet_retry: 'Retry', chunk_ack: 'Chunk ACK', receipt_verified: 'Verified receipt', route_changed: 'Route changed', no_route: 'No route',
};
const connectionLabels = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', error: 'Connection error' };
const playaNodeLabels: Record<string, string> = {
  node0: 'Malcome · Deep playa', node1: 'Shravanthi · Relay', node2: 'Lucas · Relay',
  node3: 'Dave · Relay', node4: 'Basith · Playa airport', node5: 'Frank · Relay',
};
const camper = (id: string) => (playaNodeLabels[id] ?? id).split(' · ')[0];

function PairPicker({ nodes, a, b, setA, setB }: { nodes: { id: string }[]; a: string; b: string; setA: (id: string) => void; setB: (id: string) => void }) {
  const options = (other: string) => nodes.map(n => <option key={n.id} value={n.id} disabled={n.id === other}>{camper(n.id)} ({n.id})</option>);
  return <div className="pair-picker" role="group" aria-label="Choose phones">
    <label>Left phone<select aria-label="Left phone node" value={a} onChange={e => setA(e.target.value)}>{options(b)}</select></label>
    <label>Right phone<select aria-label="Right phone node" value={b} onChange={e => setB(e.target.value)}>{options(a)}</select></label>
  </div>;
}

function traceTime(at: number, createdAt: number | null | undefined, replay: boolean) {
  if (replay && createdAt == null) return '—';
  const seconds = (at - (replay ? createdAt ?? 0 : 0)) / 1000;
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(3)}s`;
}

function Metric({ name, value, unit, note, icon }: { name: string; value: number | null; unit: string; note: string; icon: React.ReactNode }) {
  return <section className="metric" role="group" aria-label={name}>
    <div className="metric-label">{icon}<span>{name}</span></div>
    <div className={`metric-value ${value === null ? 'unknown' : ''}`}>{value === null ? 'Unavailable' : <>{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}<small>{unit}</small></>}</div>
    <span className="metric-note">{note}</span>
  </section>;
}

function TracePacket({ event, from, to }: { event: MeshEvent; from: { x: number; y: number }; to: { x: number; y: number } }) {
  const motion = useRef<SVGElement>(null);
  const group = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) group.current?.setAttribute('transform', `translate(${to.x},${to.y})`);
    else (motion.current as SVGAnimationElement | null)?.beginElement?.();
  }, []);
  return <g ref={group} className="trace-packet" data-testid="trace-packet" data-event-id={event.id}>
    <circle r="13" fill="#fffaf0" stroke="#f46638" strokeWidth="3"/><circle r="5" fill="#f46638"/>
    <rect x="17" y="-9" width="34" height="18" rx="4" fill="#f46638"/><text x="34" y="3" fill="white" fontSize="9" textAnchor="middle" fontFamily="monospace">#{event.sequence}</text>
    <animateMotion ref={motion} begin="indefinite" dur="0.6s" repeatCount="1" fill="freeze" path={`M${from.x},${from.y} L${to.x},${to.y}`} />
  </g>;
}

export function Topology({ state, message, events }: { state: MeshState; message?: MeshMessage; events: MeshEvent[] }) {
  const xs = state.nodes.map(node => node.x), ys = state.nodes.map(node => node.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1, height = Math.max(...ys) - minY || 1;
  const positions = new Map(state.nodes.map(node => [node.id, { x: 64 + (node.x - minX) / width * 472, y: 72 + (node.y - minY) / height * 170 }]));
  const route = message?.route ?? [];
  const playback = useTracePlayback(events, `${state.mode}:${state.endpoint}:${message?.id ?? 'none'}`);
  const hopFrom = playback.current && positions.get(playback.current.from), hopTo = playback.current && positions.get(playback.current.to);
  return <div className="topology-canvas">
    <div className="map-coordinate">Simulated Mesh Network</div>
    <svg className="mesh-map" viewBox="0 0 600 300" role="img" aria-label="Mesh network topology">
      <defs><pattern id="mesh-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#deddd3" strokeWidth=".6" /></pattern></defs>
      <rect width="600" height="300" fill="url(#mesh-grid)" />
      <g className="map-contours" fill="none" stroke="#dcded3" strokeWidth="1"><path d="M-20 110C85 10 130 70 197 115S380 212 620 34"/><path d="M-20 126C82 26 137 87 201 131S383 228 620 50"/><path d="M-20 142C79 42 144 104 205 147S386 244 620 66"/><path d="M-20 158C76 58 151 121 209 163S389 260 620 82"/><path d="M-20 174C73 74 158 138 213 179S392 276 620 98"/></g>
      {state.links.map(link => {
        const a = positions.get(link.from), b = positions.get(link.to);
        if (!a || !b) return null;
        const active = route.some((id, index) => index < route.length - 1 && ((id === link.from && route[index + 1] === link.to) || (id === link.to && route[index + 1] === link.from)));
        return <line key={`${link.from}-${link.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={active ? 'map-link active' : 'map-link'} />;
      })}
      {state.nodes.map(node => {
        const point = positions.get(node.id)!;
        const endpoint = node.id === 'node0' || node.id === 'node4';
        const label = playaNodeLabels[node.id] ?? `${node.name} · Relay`;
        return <g key={node.id} transform={`translate(${point.x},${point.y})`} className={node.online ? 'map-node' : 'map-node offline'}>
          <circle r="22" className="node-halo" /><circle r="12" className={endpoint ? 'node-point endpoint' : 'node-point'} />
          <circle r="3" fill={node.online ? '#fff' : '#92958e'} />
          <title>{label} · {node.id}</title><text y="38" className="node-name" textAnchor="middle">{label}</text>
          <text y="52" className="node-id" textAnchor="middle">{node.id}{!node.online ? ' · offline' : ''}</text>
        </g>;
      })}
      {!state.nodes.length && <text x="300" y="150" textAnchor="middle" className="empty-map">Waiting for a network snapshot</text>}
      {hopFrom && hopTo && playback.current && <TracePacket key={playback.serial} event={playback.current} from={hopFrom} to={hopTo}/>}
    </svg>
    <div className="map-legend"><span><i className="legend-dot"/>Online node</span><span><i className="legend-line"/>Selected route</span><span className="map-not-scale">Topology · not to scale</span></div>
    <div className="trace-playback"><div className="trace-playback-heading"><strong>Trace playback</strong><button aria-label="Replay selected trace" disabled={!events.some(event => event.kind === 'packet_tx')} onClick={playback.replay}><RotateCcw size={11}/>Replay trace</button></div>
      <div role="status" aria-label="Trace playback status">{playback.current ? <>{playback.current.from} → {playback.current.to} · {playback.queued} {playback.queued === 1 ? 'hop' : 'hops'} queued{(!hopFrom || !hopTo) && ' · coordinates unavailable'}</> : playback.observed ? 'Trace complete' : 'Waiting for observed transmit events'}</div>
      <p>Visual timing only · backend timing stays in the ledger.</p>
      {!!playback.skipped && <p className="trace-limit">{playback.skipped} observed hops not animated (presentation limit).</p>}
    </div>
  </div>;
}

function narrate(message: MeshMessage | undefined, events: MeshEvent[]): { title: string; body: string } {
  if (!message) return { title: 'How this works', body: 'Send a message from either phone. Nothing reaches the other phone instantly: it is squeezed into ~230-byte radio packets, hopped across relay nodes over a slow, lossy radio, and only shown on the far phone once every chunk has arrived and its checksum matches.' };
  const route = message.route.length ? message.route.join(' → ') : 'the mesh';
  const drops = events.filter(e => e.kind === 'packet_dropped').length, retries = events.filter(e => e.kind === 'packet_retry').length;
  const loss = drops || retries ? ` ${drops} packet${drops === 1 ? '' : 's'} got lost on the way and ${retries} ${retries === 1 ? 'was' : 'were'} resent.` : '';
  if (message.status === 'failed') return { title: 'Transfer failed', body: `The mesh could not get every chunk through along ${route}. The receiving phone shows nothing because it never had the full message.${loss}` };
  if (message.integrity === 'verified' && message.status === 'delivered') return { title: 'Delivered and verified', body: `All ${message.totalChunks} chunks arrived over ${route}. The receiver rebuilt the message, its checksum matched, and it sent a signed receipt back, so now (and only now) the phone displays it.${loss}` };
  if (message.status === 'awaiting_receipt' || message.status === 'receipt_unconfirmed') return { title: 'Waiting for the receiver\u2019s proof', body: 'The sender has pushed out every chunk but will not say \u201cdelivered\u201d until the receiver sends back a checksum receipt. Lost receipts are retried.' };
  return { title: 'In transit', body: `Sending ${message.totalChunks} chunks over ${route} at about 1 kbps. ${message.received}/${message.totalChunks} have reached the receiver so far. Each hop waits for an acknowledgment and resends lost packets; the far phone stays blank until all chunks are in and verified.${loss}` };
}

function Narrator({ message, events }: { message: MeshMessage | undefined; events: MeshEvent[] }) {
  const note = narrate(message, events);
  return <div className="narrator" role="status" aria-label="What is happening"><span className="small-label">WHAT&apos;S HAPPENING</span><strong>{note.title}</strong><p>{note.body}</p></div>;
}

export function App({ client }: { client: MeshClient }) {
  const state = useMesh(client);
  const [leftId, setLeftId] = useState('node0');
  const [rightId, setRightId] = useState('node4');
  const left = { src: leftId, dst: rightId, self: camper(leftId), contact: camper(rightId) };
  const right = { src: rightId, dst: leftId, self: camper(rightId), contact: camper(leftId) };
  const isDefaultPair = leftId === 'node0' && rightId === 'node4';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpoint, setEndpoint] = useState(state.endpoint);
  useEffect(() => { client.start(); return () => client.dispose(); }, [client]);
  useEffect(() => {
    if (!settingsOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('.settings-dialog');
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSettingsOpen(false); }
      if (event.key === 'Tab') {
        const controls = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [settingsOpen]);
  const messages = Object.values(state.messages).sort((a, b) => {
    if (a.createdAt === null) return b.createdAt === null ? 0 : 1;
    if (b.createdAt === null) return -1;
    return b.createdAt - a.createdAt;
  });
  const selected = (selectedId && state.messages[selectedId]) || messages[0];
  const events = selected ? state.events.filter(event => event.messageId === selected.id) : [];
  const telemetry = deriveTelemetry(state, selected?.id);
  const replay = state.mode === 'replay';
  const verified = selected?.integrity === 'verified' && selected.receiptConfirmed;
  return <div className="app-shell">
    <header className="topbar">
      <a href="#overview" className="brand" aria-label="CHRP TeamWater overview"><Waves size={26} strokeWidth={2.2}/><span>CHRP<span className="brand-period">.</span></span><span className="brand-team">TeamWater</span></a>
      <nav aria-label="Main navigation"><a className="active" href="#overview">Overview</a><a href="#packet-ledger">Packet ledger</a></nav>
      <div className="topbar-right"><span className={`connection ${state.connection}`}><i/>{connectionLabels[state.connection]}</span><button className="icon-button" aria-label="Connection settings" onClick={() => { setEndpoint(state.endpoint); setSettingsOpen(true); }}><Settings2 size={18}/></button></div>
    </header>

    <main id="overview">
      <div className="page-heading"><div><div className="eyebrow">OFF-GRID COMMUNICATION / PLAYA MESH</div><h1>Find your people.<br className="mobile-break"/> Across the playa.</h1><p>Malcome is at Mayan Warrior in deep playa. Basith is at the playa airport. Watch their messages hop through the local mesh.</p></div></div>
      {state.error && <div className="error-banner" role="alert">{state.error}</div>}
      <PairPicker nodes={state.nodes.length ? state.nodes : [{ id: 'node0' }, { id: 'node4' }]} a={leftId} b={rightId} setA={setLeftId} setB={setRightId}/>
      <div className="demo-stage">
        <aside className="phone-column boss-phone" aria-label={`${camper(leftId)} · phone`}><div className="phone-profile" role="group" aria-label={`${camper(leftId)} profile`}><PhoneIdentity role="boss" conversation="playa" endpoints={left}/></div><div className="phone-frame" data-testid="phone-boss"><div className="phone-camera"/><PhoneChat client={client} role="boss" endpoints={left} conversation="playa" showIdentity={false} showConversationHeader={false} initialDraft={isDefaultPair ? "Basith, come meet me at the Mayan Warrior set in deep playa!" : `${camper(rightId)}, where are you on the playa?`} embedded pickMedia={pickBrowserMedia} renderAudio={uri => <VerifiedAudio uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>} /></div><div className="phone-caption"><i/>{isDefaultPair ? 'Mayan Warrior · Deep playa' : playaNodeLabels[leftId] ?? leftId}</div></aside>

        <section className="console-column" aria-label="Network console">
          <div className="network-conversation"><div className="network-conversation-title"><h2>{camper(leftId)} → {camper(rightId)}</h2><span className="network-mesh-badge"><i/>MESH</span></div><p>{isDefaultPair ? 'Playa airport' : (playaNodeLabels[rightId] ?? rightId).split(' · ')[1] ?? rightId}</p><div className="network-conversation-status" role="status" aria-label="Simulation status"><span>Live simulation</span><span className={`connection ${state.connection}`}><i/>{connectionLabels[state.connection]}</span></div></div>
          <div className="mode-note"><CircleHelp size={12}/>Off-grid phones in a local mesh simulation · running simulator required.</div>

          <section className="topology-panel"><div className="panel-heading"><div><span className="eyebrow">THE NETWORK</span><h2>Every hop counts.</h2></div><span className="nodes-status"><i/>{state.nodes.filter(node => node.online).length} / {state.nodes.length} nodes online</span></div>
            <Narrator message={selected} events={events}/>
            <Topology state={state} message={selected} events={events}/>
            <div className="route-detail"><div><span className="small-label">SELECTED ROUTE</span><div className="route-path" aria-label="Selected route">{selected ? (selected.route.length ? selected.route.join(' → ') : 'Route unavailable') : 'Send a message to trace its route'}</div></div><div className={`route-status ${verified ? 'verified' : ''}`}>{verified ? <ShieldCheck size={15}/> : <Activity size={15}/>}<span>{selected ? deliveryLabel(selected) : 'Ready when you are'}</span></div></div>
          </section>
          <div className="metrics-row"><Metric name="Bandwidth" value={telemetry.bitRate === null ? null : telemetry.bitRate / 1000} unit="kbps" note={replay ? 'Sample radio configuration' : 'Configured radio bit rate'} icon={<Signal size={13}/>}/><Metric name="Delay" value={telemetry.latencyMs === null ? null : telemetry.latencyMs / 1000} unit="s" note={telemetry.latencyMs === null ? 'Receiver verification timing not reported' : replay ? 'Sample message elapsed time' : 'Time to receiver verification'} icon={<Activity size={13}/>}/><Metric name="Range" value={telemetry.rangeMeters} unit="m" note={telemetry.rangeMeters === null ? 'Radio range is not reported' : replay ? 'Sample radio range' : 'Configured radio range'} icon={<Radio size={13}/>}/><Metric name="Packet loss" value={telemetry.observedLossRate === null ? null : telemetry.observedLossRate * 100} unit="%" note="Observed transmitted frames" icon={<ArrowDownLeft size={13}/>}/></div>
          <section className="ledger-panel" id="packet-ledger" data-testid="packet-log"><div className="ledger-heading"><div><span className="eyebrow">FOLLOW THE SIGNAL</span><h2>Packet ledger<span className="count-badge">{events.length}</span></h2></div><span className="ledger-state"><i/>{replay ? 'REPLAY TRACE' : 'LIVE EVENTS'}</span></div>
            {!!messages.length && <div className="message-picker" aria-label="Inspect messages">{messages.map(message => <button key={message.id} aria-label={`Inspect message ${message.id}`} aria-pressed={selected?.id === message.id} onClick={() => setSelectedId(message.id)}><span className="message-kind">{message.kind}</span><span>{message.preview || message.id}</span><ChevronRight size={12}/></button>)}</div>}
            <div className="ledger-scroll"><table aria-label="Packet ledger"><thead><tr><th>{replay ? 'Elapsed' : 'Sim time'}</th><th>Packet</th><th>Hop</th><th>Event</th><th>Bytes</th></tr></thead><tbody>{events.slice(-60).reverse().map(event => <tr key={event.id} className={`event-${event.kind}`}><td>{traceTime(event.at, selected?.createdAt, replay)}</td><td>{event.packetId}</td><td>{event.from}<span className="hop-arrow">→</span>{event.to}</td><td><span className="event-label">{eventLabels[event.kind]}</span></td><td>{event.bytes ?? '—'}</td></tr>)}</tbody></table>
              {!events.length && <div className="ledger-empty"><span className="empty-signal"><Radio size={23}/></span><strong>{!replay && !state.capabilities.packetEvents ? 'Packet events unavailable' : 'The next message starts the story.'}</strong><p>{!replay && !state.capabilities.packetEvents ? 'This backend does not provide a packet event stream.' : 'Send from either phone to follow its packets, hop by hop.'}</p></div>}
            </div><div className="ledger-footer"><span>{selected ? `${selected.received} / ${selected.totalChunks} chunks received` : 'No message selected'}</span><span>{replay ? 'DEMO DATA' : 'SERVICE DATA'}<span className="footer-cross">+</span></span></div>
          </section>
        </section>

        <aside className="phone-column employee-phone" aria-label={`${camper(rightId)} · phone`}><div className="phone-profile" role="group" aria-label={`${camper(rightId)} profile`}><PhoneIdentity role="employee" conversation="playa" endpoints={right}/></div><div className="phone-frame" data-testid="phone-employee"><div className="phone-camera"/><PhoneChat client={client} role="employee" endpoints={right} conversation="playa" showIdentity={false} showConversationHeader={false} initialDraft={isDefaultPair ? "On my way from the playa airport. See you at Mayan Warrior!" : `${camper(leftId)}, I can hear you through the mesh!`} embedded pickMedia={pickBrowserMedia} renderAudio={uri => <VerifiedAudio uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>} /></div><div className="phone-caption"><i/>{isDefaultPair ? 'Playa airport' : playaNodeLabels[rightId] ?? rightId}</div></aside>
      </div>
      <footer className="page-footer"><span><Waves size={14}/> BUILT TO KEEP PEOPLE CONNECTED.</span><span>TeamWater / CHRP <span className="footer-cross">+</span></span></footer>
    </main>
    {settingsOpen && <div className="dialog-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="dialog-heading"><h2 id="settings-title">Connection settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18}/></button></div><p>Use the local proxy or enter your simulator service URL.</p><form onSubmit={event => { event.preventDefault(); client.setMode('live', endpoint.trim() || '/api'); setSelectedId(null); setSettingsOpen(false); }}><label htmlFor="endpoint">Backend URL</label><input id="endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="/api"/><p className="settings-hint">/api uses the configured local simulator proxy.</p><button className="apply-button" type="submit">Connect to live backend<ArrowUpRight size={15}/></button></form></section></div>}
  </div>;
}
