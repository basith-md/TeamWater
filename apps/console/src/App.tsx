import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, ChevronRight, CircleHelp, Radio, RotateCcw, Settings2, ShieldCheck, Signal, Waves, X } from 'lucide-react';
import { deliveryLabel, deriveTelemetry, useMesh } from '@teamwater/core';
import type { MeshClient, MeshEvent, MeshMessage, MeshState } from '@teamwater/core';
import { PhoneChat, PhoneIdentity } from '@teamwater/mobile-ui';
import { pickBrowserMedia } from './browserMedia';
import { VerifiedAudio } from './VerifiedAudio';
import { liveTransmission, useTracePlayback } from './useTracePlayback';
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
  const [open, setOpen] = useState<'left' | 'right' | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const close = (restore = false) => {
    if (restore && open) wrapper.current?.querySelector<HTMLButtonElement>(`[data-side="${open}"]`)?.focus();
    setOpen(null);
  };
  useEffect(() => {
    if (!open) return;
    wrapper.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const picker = (side: 'left' | 'right', value: string, other: string, select: (id: string) => void) => {
    const label = `${side === 'left' ? 'Left' : 'Right'} phone node`;
    return <div className="phone-node-picker" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      if (event.key === 'Tab') close();
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (open !== side) { setOpen(side); return; }
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <span className="phone-picker-label">{side === 'left' ? 'Left' : 'Right'} phone</span>
      <button type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open === side} aria-controls={`${side}-phone-options`} data-side={side} onClick={() => setOpen(open === side ? null : side)}>{camper(value)} ({value}) <span aria-hidden="true">⌄</span></button>
      {open === side && <div className="phone-node-options" id={`${side}-phone-options`} role="listbox" aria-label={`${label} options`}>{nodes.map(node => <button type="button" key={node.id} role="option" aria-selected={node.id === value} disabled={node.id === other} onClick={() => { select(node.id); close(true); }}>{camper(node.id)} ({node.id})</button>)}</div>}
    </div>;
  };
  return <div ref={wrapper} className="pair-picker" role="group" aria-label="Choose phones">
    {picker('left', a, b, setA)}{picker('right', b, a, setB)}
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

function TracePacket({ event, from, to, duration = 0.6, live = false }: { live?: boolean; duration?: number; event: MeshEvent; from: { x: number; y: number }; to: { x: number; y: number } }) {
  const motion = useRef<SVGElement>(null);
  const group = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    if (live) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) group.current?.setAttribute('transform', `translate(${to.x},${to.y})`);
    else (motion.current as SVGAnimationElement | null)?.beginElement?.();
  }, []);
  return <g ref={group} transform={live ? `translate(${(from.x + to.x) / 2},${(from.y + to.y) / 2})` : undefined} className="trace-packet" data-testid="trace-packet" data-event-id={event.id}>
    <circle r="13" fill="#fffaf0" stroke="#f46638" strokeWidth="3"/><circle r="5" fill="#f46638"/>
    <rect x="17" y="-9" width="34" height="18" rx="4" fill="#f46638"/><text x="34" y="3" fill="white" fontSize="9" textAnchor="middle" fontFamily="monospace">#{event.sequence}</text>
    {!live && <animateMotion ref={motion} begin="indefinite" dur={`${duration}s`} repeatCount="1" fill="freeze" path={`M${from.x},${from.y} L${to.x},${to.y}`} />}
  </g>;
}

export function Topology({ state, message, events }: { state: MeshState; message?: MeshMessage; events: MeshEvent[] }) {
  const xs = state.nodes.map(node => node.x), ys = state.nodes.map(node => node.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1, height = Math.max(...ys) - minY || 1;
  const positions = new Map(state.nodes.map(node => [node.id, { x: 64 + (node.x - minX) / width * 472, y: 72 + (node.y - minY) / height * 170 }]));
  const route = message?.route ?? [];
  const traceKey = `${state.mode}:${state.endpoint}:${message?.id ?? 'none'}`;
  const snapshotKey = `${traceKey}:${events.at(-1)?.sequence ?? 0}`;
  const [replaySnapshot, setReplaySnapshot] = useState<string | null>(null);
  const replaying = state.mode === 'replay' || replaySnapshot === snapshotKey;
  const playback = useTracePlayback(replaying ? events : [], traceKey);
  const terminal = !!message && ['delivered', 'failed', 'cancelled', 'receipt_unconfirmed'].includes(message.status);
  const current = replaying ? playback.current : liveTransmission(events, terminal || state.connection !== 'connected');
  const hopFrom = current && positions.get(current.from), hopTo = current && positions.get(current.to);
  const duration = !replaying && current?.bytes && state.config.bitRate
    ? Math.max(0.03, (current.bytes * 8 / state.config.bitRate + 0.05) / state.config.playbackSpeed) : 0.6;
  const replayTrace = () => { setReplaySnapshot(snapshotKey); if (replaying) playback.replay(); };
  return <div className="topology-canvas">
    <div className="map-coordinate">Simulated Mesh Network</div>
    <svg className="mesh-map" viewBox="0 0 600 300" role="img" aria-label="Mesh network topology">
      <defs><pattern id="mesh-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#deddd3" strokeWidth=".6" /></pattern></defs>
      <rect width="600" height="300" fill="url(#mesh-grid)" />
      <g className="map-contours" fill="none" stroke="#dcded3" strokeWidth="1"><path d="M-20 110C85 10 130 70 197 115S380 212 620 34"/><path d="M-20 126C82 26 137 87 201 131S383 228 620 50"/><path d="M-20 142C79 42 144 104 205 147S386 244 620 66"/><path d="M-20 158C76 58 151 121 209 163S389 260 620 82"/><path d="M-20 174C73 74 158 138 213 179S392 276 620 98"/></g>
      {state.links.map(link => {
        const a = positions.get(link.from), b = positions.get(link.to);
        if (!a || !b) return null;
        const metric = state.routing?.distanceAware ? state.routing.links.find(l => (l.from === link.from && l.to === link.to) || (l.from === link.to && l.to === link.from)) : undefined;
        const active = route.some((id, index) => index < route.length - 1 && ((id === link.from && route[index + 1] === link.to) || (id === link.to && route[index + 1] === link.from)));
        return <g key={`${link.from}-${link.to}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={active ? 'map-link active' : 'map-link'} />{metric && <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} className={active ? 'link-label active' : 'link-label'} textAnchor="middle">{Math.round(metric.distance)} m</text>}</g>;
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
      {hopFrom && hopTo && current && <TracePacket key={replaying ? `replay-${playback.serial}` : current.id} event={current} from={hopFrom} to={hopTo} duration={duration} live={!replaying}/>}
    </svg>
    <div className="map-legend"><span><i className="legend-dot"/>Online node</span><span><i className="legend-line"/>Selected route</span><span className="map-not-scale">Topology · not to scale</span></div>
    <div className="trace-playback"><div className="trace-playback-heading"><strong>{replaying ? 'Trace playback' : 'Live packet activity'}</strong><button aria-label="Replay selected trace" disabled={!events.some(event => event.kind === 'packet_tx')} onClick={replayTrace}><RotateCcw size={11}/>Replay trace</button></div>
      <div role="status" aria-label="Trace playback status">{current ? <>{current.from} → {current.to}{replaying ? ` · ${playback.queued} ${playback.queued === 1 ? 'hop' : 'hops'} queued` : ' · transmitting now'}{(!hopFrom || !hopTo) && ' · coordinates unavailable'}</> : replaying ? (playback.observed ? 'Trace complete' : 'Waiting for observed transmit events') : terminal ? deliveryLabel(message!) : 'Waiting for the next transmission'}</div>
      <p>{replaying ? 'Visual timing only · backend timing stays in the ledger.' : 'Live backend events · synchronized with the phones and ledger.'}</p>
      {!!playback.skipped && <p className="trace-limit">{playback.skipped} observed hops not animated (presentation limit).</p>}
    </div>
  </div>;
}

function narrate(message: MeshMessage | undefined, events: MeshEvent[]): { title: string; body: string } {
  if (!message) return { title: 'How this works', body: 'Send a message from either phone. Small radio packets hop across relay nodes. Receiver verification needs every chunk and a matching checksum; sender delivery confirmation also needs the checksum receipt to return.' };
  const route = message.route.length ? message.route.join(' → ') : 'the mesh';
  const drops = events.filter(e => e.kind === 'packet_dropped').length, retries = events.filter(e => e.kind === 'packet_retry').length;
  const loss = drops || retries ? ` The visible trace records ${drops} dropped transmissions and ${retries} retry attempts.` : '';
  if (message.status === 'failed') return { title: 'Transfer failed', body: `Delivery was not confirmed along ${route}. ${message.integrity === 'verified' ? 'The receiver verified the content, but the sender did not confirm the final receipt.' : 'The transfer may have failed before receiver verification or while returning the receipt.'}${loss}` };
  if (message.integrity === 'verified' && message.status === 'delivered' && message.receiptConfirmed) return { title: 'Delivered and verified', body: `All ${message.totalChunks} chunks arrived over ${route}. The receiver rebuilt the message and its checksum matched. The checksum receipt returned to the sender, confirming delivery.${loss}` };
  if (message.integrity === 'verified') return { title: 'Receiver verified · delivery unconfirmed', body: `The receiver rebuilt the message and its checksum matched. It can show the verified content while the sender awaits the checksum receipt.${loss}` };
  if (message.status === 'awaiting_receipt' || message.status === 'receipt_unconfirmed') return { title: 'Waiting for the receiver\u2019s proof', body: 'The sender is awaiting a checksum receipt. Receiver verification and sender delivery confirmation are separate; a missing receipt can leave delivery unconfirmed.' };
  return { title: 'In transit', body: `Sending ${message.totalChunks} chunks over ${route}. ${message.received}/${message.totalChunks} have reached the receiver so far. Each hop waits for an acknowledgment and can retry lost packets. Unverified previews may appear before reconstruction and checksum verification.${loss}` };
}

function RouteProofPanel({ message, distanceAware }: { message?: MeshMessage; distanceAware: boolean }) {
  if (!distanceAware) return null;
  const proof = message?.routeProof;
  if (!proof) return <div className="route-proof"><span className="small-label">WHY THIS ROUTE</span><p>Send a message to see which path the mesh picked and the proof that it was the cheapest.</p></div>;
  const name = (id: string) => (playaNodeLabels[id] ?? id).split(' · ')[0];
  const chain = (path: string[]) => path.map(name).join(' → ');
  return <div className="route-proof" aria-label="Route proof">
    <span className="small-label">WHY THIS ROUTE</span>
    <strong>{chain(proof.chosen)} · cost {proof.chosenCost.toFixed(2)} · {Math.round(proof.chosenDistance)} m</strong>
    <p>Cost is expected transmissions: each hop is sent 1 / (1 − loss)² times on average (frame and ACK must both arrive), and loss rises with distance. {proof.optimal ? `The simulator reports this route is cheapest among ${proof.candidatesChecked} checked paths.` : 'Could not confirm this path is the cheapest.'} Verification: {proof.verifiedBy.length ? proof.verifiedBy.join(', ') : 'not reported'}.</p>
    <table aria-label="Route comparison"><thead><tr><th>Path</th><th>Hops</th><th>Distance</th><th>Cost</th></tr></thead><tbody>
      <tr className="chosen"><td>{chain(proof.chosen)} ✓</td><td>{proof.chosen.length - 1}</td><td>{Math.round(proof.chosenDistance)} m</td><td>{proof.chosenCost.toFixed(2)}</td></tr>
      {proof.alternatives.map(alt => <tr key={alt.path.join('>')}><td>{chain(alt.path)}</td><td>{alt.hops}</td><td>{Math.round(alt.distance)} m</td><td>{alt.cost.toFixed(2)} <small>(+{alt.extraCost.toFixed(2)})</small></td></tr>)}
    </tbody></table>
    <details><summary>Per-hop numbers</summary><ul>{proof.links.map(l => <li key={`${l.from}-${l.to}`}>{name(l.from)} → {name(l.to)}: {Math.round(l.distance)} m, {Math.round(l.loss * 100)}% loss, cost {l.etx.toFixed(2)}</li>)}</ul></details>
  </div>;
}

function Narrator({ message, events }: { message: MeshMessage | undefined; events: MeshEvent[] }) {
  const note = narrate(message, events);
  return <div className="narrator" role="status" aria-label="What is happening"><span className="small-label">WHAT&apos;S HAPPENING</span><strong>{note.title}</strong><p>{note.body}</p></div>;
}

export function App({ client }: { client: MeshClient }) {
  const state = useMesh(client);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const distanceAware = !!state.routing?.distanceAware;
  async function toggleDistance() {
    setRoutingError(null);
    try { await client.setDistanceRouting?.(!distanceAware); } catch (failure) { setRoutingError(failure instanceof Error ? failure.message : 'Could not change routing.'); }
  }
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
        <aside className="phone-column boss-phone" aria-label={`${camper(leftId)} · phone`}><div className="phone-profile" role="group" aria-label={`${camper(leftId)} profile`}><PhoneIdentity role="boss" conversation="playa" endpoints={left}/></div><div className="phone-frame" data-testid="phone-boss"><div className="phone-camera"/><PhoneChat key={`left:${leftId}:${rightId}`} client={client} role="boss" endpoints={left} conversation="playa" showIdentity={false} showConversationHeader={false} initialDraft={isDefaultPair ? "Basith, come meet me at the Mayan Warrior set in deep playa!" : `${camper(rightId)}, where are you on the playa?`} embedded pickMedia={pickBrowserMedia} renderAudio={uri => <VerifiedAudio uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>} /></div><div className="phone-caption"><i/>{isDefaultPair ? 'Mayan Warrior · Deep playa' : playaNodeLabels[leftId] ?? leftId}</div></aside>

        <section className="console-column" aria-label="Network console">
          <div className="network-conversation"><div className="network-conversation-title"><h2>{camper(leftId)} → {camper(rightId)}</h2><span className="network-mesh-badge"><i/>MESH</span></div><p>{isDefaultPair ? 'Playa airport' : (playaNodeLabels[rightId] ?? rightId).split(' · ')[1] ?? rightId}</p><div className="network-conversation-status" role="status" aria-label="Simulation status"><span>Live simulation</span><span className={`connection ${state.connection}`}><i/>{connectionLabels[state.connection]}</span></div></div>
          <div className="mode-note"><CircleHelp size={12}/>Off-grid phones in a local mesh simulation · running simulator required.</div>

          <section className="topology-panel"><div className="panel-heading"><div><span className="eyebrow">THE NETWORK</span><h2>Every hop counts.</h2></div><button className={`distance-toggle ${distanceAware ? 'on' : ''}`} role="switch" aria-checked={distanceAware} aria-label="Distance-aware routing" onClick={toggleDistance}><i/>Distances &amp; best route</button><span className="nodes-status"><i/>{state.nodes.filter(node => node.online).length} / {state.nodes.length} nodes online</span></div>
            <Narrator message={selected} events={events}/>
            {routingError && <div className="error-banner" role="alert">{routingError}</div>}
            <Topology state={state} message={selected} events={events}/>
            <div className="route-detail"><div><span className="small-label">SELECTED ROUTE</span><div className="route-path" aria-label="Selected route">{selected ? (selected.route.length ? selected.route.join(' → ') : 'Route unavailable') : 'Send a message to trace its route'}</div></div><div className={`route-status ${verified ? 'verified' : ''}`}>{verified ? <ShieldCheck size={15}/> : <Activity size={15}/>}<span>{selected ? deliveryLabel(selected) : 'Ready when you are'}</span></div></div>
          <RouteProofPanel message={selected} distanceAware={distanceAware}/>
          </section>
          <div className="metrics-row"><Metric name="Bandwidth" value={telemetry.bitRate === null ? null : telemetry.bitRate / 1000} unit="kbps" note={replay ? 'Sample radio configuration' : 'Configured radio bit rate'} icon={<Signal size={13}/>}/><Metric name="Delay" value={telemetry.latencyMs === null ? null : telemetry.latencyMs / 1000} unit="s" note={telemetry.latencyMs === null ? 'Receiver verification timing not reported' : replay ? 'Sample message elapsed time' : 'Time to receiver verification'} icon={<Activity size={13}/>}/><Metric name="Range" value={telemetry.rangeMeters} unit="m" note={telemetry.rangeMeters === null ? 'Radio range is not reported' : replay ? 'Sample radio range' : 'Configured radio range'} icon={<Radio size={13}/>}/><Metric name="Packet loss" value={telemetry.observedLossRate === null ? null : telemetry.observedLossRate * 100} unit="%" note="Observed transmitted frames" icon={<ArrowDownLeft size={13}/>}/></div>
          <section className="ledger-panel" id="packet-ledger" data-testid="packet-log"><div className="ledger-heading"><div><span className="eyebrow">FOLLOW THE SIGNAL</span><h2>Packet ledger<span className="count-badge">{events.length}</span></h2></div><span className="ledger-state"><i/>{replay ? 'REPLAY TRACE' : 'LIVE EVENTS'}</span></div>
            {!!messages.length && <div className="message-picker" aria-label="Inspect messages">{messages.map(message => <button key={message.id} aria-label={`Inspect message ${message.id}`} aria-pressed={selected?.id === message.id} onClick={() => setSelectedId(message.id)}><span className="message-kind">{message.kind}</span><span>{message.preview || message.id}</span><ChevronRight size={12}/></button>)}</div>}
            <div className="ledger-scroll"><table aria-label="Packet ledger"><thead><tr><th>{replay ? 'Elapsed' : 'Sim time'}</th><th>Packet</th><th>Hop</th><th>Event</th><th>Bytes</th></tr></thead><tbody>{events.slice(-60).reverse().map(event => <tr key={event.id} className={`event-${event.kind}`}><td>{traceTime(event.at, selected?.createdAt, replay)}</td><td>{event.packetId}</td><td>{event.from}<span className="hop-arrow">→</span>{event.to}</td><td><span className="event-label">{eventLabels[event.kind]}</span></td><td>{event.bytes ?? '—'}</td></tr>)}</tbody></table>
              {!events.length && <div className="ledger-empty"><span className="empty-signal"><Radio size={23}/></span><strong>{!replay && !state.capabilities.packetEvents ? 'Packet events unavailable' : 'The next message starts the story.'}</strong><p>{!replay && !state.capabilities.packetEvents ? 'This backend does not provide a packet event stream.' : 'Send from either phone to follow its packets, hop by hop.'}</p></div>}
            </div><div className="ledger-footer"><span>{selected ? `${selected.received} / ${selected.totalChunks} chunks received` : 'No message selected'}</span><span>{replay ? 'DEMO DATA' : 'SERVICE DATA'}<span className="footer-cross">+</span></span></div>
          </section>
        </section>

        <aside className="phone-column employee-phone" aria-label={`${camper(rightId)} · phone`}><div className="phone-profile" role="group" aria-label={`${camper(rightId)} profile`}><PhoneIdentity role="employee" conversation="playa" endpoints={right}/></div><div className="phone-frame" data-testid="phone-employee"><div className="phone-camera"/><PhoneChat key={`right:${rightId}:${leftId}`} client={client} role="employee" endpoints={right} conversation="playa" showIdentity={false} showConversationHeader={false} initialDraft={isDefaultPair ? "On my way from the playa airport. See you at Mayan Warrior!" : `${camper(leftId)}, I can hear you through the mesh!`} embedded pickMedia={pickBrowserMedia} renderAudio={uri => <VerifiedAudio uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>} /></div><div className="phone-caption"><i/>{isDefaultPair ? 'Playa airport' : playaNodeLabels[rightId] ?? rightId}</div></aside>
      </div>
      <footer className="page-footer"><span><Waves size={14}/> BUILT TO KEEP PEOPLE CONNECTED.</span><span>TeamWater / CHRP <span className="footer-cross">+</span></span></footer>
    </main>
    {settingsOpen && <div className="dialog-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="dialog-heading"><h2 id="settings-title">Connection settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18}/></button></div><p>Use the local proxy or enter your simulator service URL.</p><form onSubmit={event => { event.preventDefault(); client.setMode('live', endpoint.trim() || '/api'); setSelectedId(null); setSettingsOpen(false); }}><label htmlFor="endpoint">Backend URL</label><input id="endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="/api"/><p className="settings-hint">/api uses the configured local simulator proxy.</p><button className="apply-button" type="submit">Connect to live backend<ArrowUpRight size={15}/></button></form></section></div>}
  </div>;
}
