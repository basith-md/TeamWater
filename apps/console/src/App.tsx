import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronRight, CircleHelp, Play, Radio, RotateCcw, Settings2, ShieldCheck, Signal, Waves, X } from 'lucide-react';
import { deliveryLabel, deriveTelemetry, useMesh } from '@teamwater/core';
import type { MeshClient, MeshEvent, MeshMessage, MeshState } from '@teamwater/core';
import { PhoneChat, PhoneIdentity } from '@teamwater/mobile-ui';
import type { ModelPickerProps } from '@teamwater/mobile-ui';
import { pickBrowserMedia } from './browserMedia';
import { VerifiedAudio } from './VerifiedAudio';
import { liveTransmission, useTracePlayback } from './useTracePlayback';
import { VoiceRecorder } from './VoiceRecorder';
import { useDemoPlayback } from './useDemoPlayback';
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

function PairPicker({ nodes, a, b, setA, setB, status, disabled = false, internet, setInternet, internetBusy = false }: { nodes: { id: string }[]; a: string; b: string; setA: (id: string) => void; setB: (id: string) => void; status: React.ReactNode; disabled?: boolean; internet?: string | null; setInternet?: (id: string | null) => void; internetBusy?: boolean }) {
  const [open, setOpen] = useState<'left' | 'right' | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => { if (disabled) setOpen(null); }, [disabled]);
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
      if (disabled) return;
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
      <button type="button" role="combobox" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open === side} aria-controls={`${side}-phone-options`} data-side={side} onClick={() => setOpen(open === side ? null : side)}>{camper(value)} ({value}) <span aria-hidden="true">⌄</span></button>
      {open === side && <div className="phone-node-options" id={`${side}-phone-options`} role="listbox" aria-label={`${label} options`}>{nodes.map(node => <button type="button" key={node.id} role="option" aria-selected={node.id === value} disabled={disabled || node.id === other} onClick={() => { select(node.id); close(true); }}>{camper(node.id)} ({node.id})</button>)}</div>}
    </div>;
  };
  return <div ref={wrapper} className="pair-bar" role="group" aria-label="Choose phones">
    <div className="pair-selects">{picker('left', a, b, setA)}<ArrowRight size={16} aria-hidden="true"/>{picker('right', b, a, setB)}
      {setInternet && <label className="internet-picker"><span>Internet</span><select aria-label="Internet node" value={internet ?? ''} disabled={disabled || internetBusy} onChange={event => setInternet(event.target.value || null)}>
        <option value="">None · offline</option>
        {nodes.map(node => <option key={node.id} value={node.id}>{camper(node.id)}</option>)}
      </select></label>}
    </div>{status}
  </div>;
}

function ModelSelect({ models, value, onChange, disabled }: ModelPickerProps) {
  return <label className="model-select"><span>Model</span><select aria-label="AI model" value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))}>
    {(['ok', 'unknown', 'avoid'] as const).map(level => <optgroup key={level} label={level === 'ok' ? 'Not trained on' : level === 'unknown' ? 'Privacy policy unknown' : 'Trained on / retained'}>
      {models.filter(m => m.privacyLevel === level).map(m => <option key={m.index} value={m.index}>{m.label} · {m.provider} · {m.tier}</option>)}
    </optgroup>)}
  </select></label>;
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
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) group.current?.setAttribute('transform', `translate(${live ? (from.x + to.x) / 2 : to.x},${live ? (from.y + to.y) / 2 : to.y})`);
    else (motion.current as SVGAnimationElement | null)?.beginElement?.();
  }, []);
  return <g ref={group} className="trace-packet" data-testid="trace-packet" data-event-id={event.id}>
    <circle r="8" fill="#fffaf0" stroke="#f46638" strokeWidth="2"/><circle r="3" fill="#f46638"/>
    <rect x="12" y="-7" width="28" height="14" rx="3" fill="#f46638"/><text x="26" y="2.5" fill="white" fontSize="7.5" textAnchor="middle" fontFamily="monospace">#{event.sequence}</text>
    <animateMotion ref={motion} begin="indefinite" dur={`${live ? 1.2 : duration}s`} repeatCount={live ? 'indefinite' : '1'} fill="freeze" path={`M${from.x},${from.y} L${to.x},${to.y}`} />
  </g>;
}

export function Topology({ state, message, events, onMove }: { state: MeshState; message?: MeshMessage; events: MeshEvent[]; onMove?: (nodeId: string, x: number, y: number) => void }) {
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const internetNode = state.ai?.internetNode ?? null;
  const svgRef = useRef<SVGSVGElement>(null);
  const xs = state.nodes.map(node => node.x), ys = state.nodes.map(node => node.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1, height = Math.max(...ys) - minY || 1;
  const toMap = (x: number, y: number) => ({ x: 64 + (x - minX) / width * 472, y: 72 + (y - minY) / height * 170 });
  const fromMap = (x: number, y: number) => ({ x: Math.round(minX + Math.max(0, Math.min(1, (x - 64) / 472)) * width), y: Math.round(minY + Math.max(0, Math.min(1, (y - 72) / 170)) * height) });
  const positions = new Map(state.nodes.map(node => [node.id, drag?.id === node.id ? toMap(drag.x, drag.y) : toMap(node.x, node.y)]));
  const dragPoint = (event: React.PointerEvent) => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return fromMap(local.x, local.y);
  };
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
    <svg ref={svgRef} className="mesh-map" viewBox="0 0 600 300" role="img" aria-label="Mesh network topology">
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
        const internet = node.id === internetNode;
        return <g key={node.id} transform={`translate(${point.x},${point.y})`} className={`map-node${node.online ? '' : ' offline'}${internet ? ' internet' : ''}`}
          style={onMove ? { cursor: 'grab', touchAction: 'none' } : undefined}
          onPointerDown={onMove ? event => { event.currentTarget.setPointerCapture(event.pointerId); const p = dragPoint(event); if (p) setDrag({ id: node.id, ...p }); } : undefined}
          onPointerMove={onMove ? event => { if (drag?.id !== node.id) return; const p = dragPoint(event); if (p) setDrag({ id: node.id, ...p }); } : undefined}
          onPointerUp={onMove ? () => { if (drag?.id === node.id) { onMove(node.id, drag.x, drag.y); setDrag(null); } } : undefined}
          onPointerCancel={onMove ? () => setDrag(null) : undefined}>
          <circle r="22" className="node-halo" /><circle r="12" className={endpoint ? 'node-point endpoint' : 'node-point'} />
          {internet && <g className="internet-badge" transform="translate(14,-26)"><rect x="-4" y="-9" width="62" height="17" rx="8.5"/><text x="27" y="3" textAnchor="middle">◍ internet</text></g>}
          <circle r="3" fill={node.online ? '#fff' : '#92958e'} />
          <title>{label} · {node.id}</title><text y="38" className="node-name" textAnchor="middle">{label}</text>
          <text y="52" className="node-id" textAnchor="middle">{node.id}{!node.online ? ' · offline' : ''}</text>
        </g>;
      })}
      {!state.nodes.length && <text x="300" y="150" textAnchor="middle" className="empty-map">Waiting for a network snapshot</text>}
      {hopFrom && hopTo && current && <TracePacket key={replaying ? `replay-${playback.serial}` : `${current.messageId}:${current.packetKind}:${current.chunk}:${current.from}:${current.to}`} event={current} from={hopFrom} to={hopTo} duration={duration} live={!replaying}/>}
    </svg>
    <div className="map-legend"><span><i className="legend-dot"/>Online node</span><span><i className="legend-line"/>Selected route</span>{internetNode && <span><i className="legend-internet"/>Internet gateway</span>}<span className="map-not-scale">{onMove ? 'Drag a node to change distances' : 'Topology · not to scale'}</span></div>
    <div className="trace-playback"><div className="trace-playback-heading"><strong>{replaying ? 'Trace playback' : 'Live packet activity'}</strong><button aria-label="Replay selected trace" disabled={!events.some(event => event.kind === 'packet_tx')} onClick={replayTrace}><RotateCcw size={11}/>Replay trace</button></div>
      <div role="status" aria-label="Trace playback status">{current ? <>{current.from} → {current.to}{replaying ? ` · ${playback.queued} ${playback.queued === 1 ? 'hop' : 'hops'} queued` : ' · transmitting now'}{(!hopFrom || !hopTo) && ' · coordinates unavailable'}</> : replaying ? (playback.observed ? 'Trace complete' : 'Waiting for observed transmit events') : terminal ? deliveryLabel(message!) : 'Waiting for the next transmission'}</div>
      <p>{replaying ? 'Visual timing only · backend timing stays in the ledger.' : 'Live backend events · synchronized with the phones and ledger.'}</p>
      {!!playback.skipped && <p className="trace-limit">{playback.skipped} observed hops not animated (presentation limit).</p>}
    </div>
  </div>;
}

const statusLabel = (m: MeshMessage) =>
  m.status === 'failed' ? 'Failed'
  : m.status === 'cancelled' ? 'Cancelled'
  : m.status === 'receipt_unconfirmed' ? `Delivery unconfirmed${m.integrity === 'verified' ? ' · receiver verified' : ''}`
  : m.integrity === 'verified' && m.status === 'delivered' && m.receiptConfirmed ? 'Delivered · verified by receiver'
  : m.integrity === 'verified' ? 'Receiver verified · awaiting receipt'
  : m.status === 'awaiting_receipt' ? 'Waiting for receipt'
  : m.status === 'reassembled' ? 'Received · unverified'
  : 'In transit';

function LastMessage({ message }: { message: MeshMessage | undefined }) {
  const verifiedAt = message?.receiverVerifiedSeconds;
  const tiles: { name: string; value: number | null; unit: string; note: string; icon: React.ReactNode }[] = [
    { name: 'Latency', value: verifiedAt ?? message?.etaSeconds ?? null, unit: 's', note: verifiedAt != null ? 'Time to receiver verification' : message?.etaSeconds != null ? 'Estimated time remaining' : 'Not reported yet', icon: <Activity size={13}/> },
    { name: 'Bytes on air', value: message?.radioBytes ?? null, unit: 'B', note: message?.encodedBytes !== undefined ? `Payload ${message.encodedBytes.toLocaleString()} B` : 'All transmitted frames', icon: <Signal size={13}/> },
    { name: 'Retries', value: message?.retries ?? null, unit: '', note: message ? `${message.received} / ${message.totalChunks} chunks received` : 'No message selected', icon: <RotateCcw size={13}/> },
    { name: 'Lost packets', value: message?.lostPackets ?? null, unit: '', note: message?.airtimeSeconds !== undefined ? `Airtime ${message.airtimeSeconds.toFixed(1)} s` : 'Dropped frames', icon: <ArrowDownLeft size={13}/> },
  ];
  return <div className="last-message" role="status" aria-label="Selected message">
    <div className="last-head"><span className="small-label">SELECTED MESSAGE{message ? ` · ${message.kind}` : ''}</span><strong>{message ? statusLabel(message) : 'No message selected'}</strong></div>
    <div className="metrics-row">{tiles.map(tile => <Metric key={tile.name} {...tile}/>)}</div>
  </div>;
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

export function App({ client }: { client: MeshClient }) {
  const state = useMesh(client);
  const demo = useDemoPlayback(client);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const distanceAware = !!state.routing?.distanceAware;
  async function toggleDistance() {
    setRoutingError(null);
    try { await client.setDistanceRouting?.(!distanceAware); } catch (failure) { setRoutingError(failure instanceof Error ? failure.message : 'Could not change routing.'); }
  }
  async function moveNode(nodeId: string, x: number, y: number) {
    setRoutingError(null);
    try { await client.moveNode?.(nodeId, x, y); } catch (failure) { setRoutingError(failure instanceof Error ? failure.message : 'Could not move node.'); }
  }
  const [leftId, setLeftId] = useState('node0');
  const [rightId, setRightId] = useState('node4');
  const left = { src: leftId, dst: rightId, self: camper(leftId), contact: camper(rightId) };
  const right = { src: rightId, dst: leftId, self: camper(rightId), contact: camper(leftId) };
  const isDefaultPair = leftId === 'node0' && rightId === 'node4';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  async function resetConversation() {
    if (resetting || !client.resetConversation) return;
    demo.cancel();
    setResetting(true); setResetError(null);
    try {
      await client.resetConversation();
      setSelectedId(null); setConversationVersion(version => version + 1);
    } catch (failure) { setResetError(failure instanceof Error ? failure.message : 'Reset failed. Try again.'); }
    finally { setResetting(false); }
  }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [internetBusy, setInternetBusy] = useState(false);
  const internetRequest = useRef(0);
  useEffect(() => {
    internetRequest.current++;
    setAiError(null); setInternetBusy(false);
    return () => { internetRequest.current++; };
  }, [client, state.mode, state.endpoint]);
  async function changeInternet(node: string | null) {
    if (!client.setInternetNode || internetBusy || demo.playing || resetting) return;
    const request = ++internetRequest.current;
    setInternetBusy(true); setAiError(null);
    try { await client.setInternetNode(node); }
    catch (failure) { if (request === internetRequest.current) setAiError(failure instanceof Error ? failure.message : 'Could not change the internet node.'); }
    finally { if (request === internetRequest.current) setInternetBusy(false); }
  }
  const setupUrl = `${state.endpoint.trim().replace(/\/+$/, '').replace(/\/ws$/, '').replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')}/connect/`;
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
      <a href="#overview" className="brand" aria-label="Water Connect overview"><Waves size={26} strokeWidth={2.2}/><span>Water Connect</span></a>
      <nav aria-label="Main navigation"><a className="active" href="#overview">Overview</a><a href="#packet-ledger">Packet ledger</a><a href={setupUrl} target="_blank" rel="noreferrer">AI setup <ArrowUpRight size={11}/></a></nav>
      <div className="topbar-right"><span className={`connection ${state.connection}`}><i/>{connectionLabels[state.connection]}</span><button className="reset-demo-button" aria-label="Play demo" disabled={resetting || demo.playing || !client.resetConversation || state.mode !== 'live'} onClick={() => { setResetError(null); setSettingsOpen(false); void demo.start(() => { setLeftId('node0'); setRightId('node4'); setSelectedId(null); setConversationVersion(version => version + 1); }); }}><Play size={14}/>{demo.playing ? 'Playing…' : 'Play demo'}</button><button className="reset-demo-button" aria-label="Reset demo" disabled={resetting || demo.playing && demo.stage === 'Resetting the conversation…' || !client.resetConversation} onClick={resetConversation}><RotateCcw size={14}/>{resetting ? 'Resetting…' : 'Reset demo'}</button><button className="icon-button" aria-label="Connection settings" disabled={demo.playing || resetting} onClick={() => { setEndpoint(state.endpoint); setSettingsOpen(true); }}><Settings2 size={18}/></button></div>
    </header>

    <main id="overview">
      <div className="page-heading"><div><h1>Message Your People At Burning Man Without Cell Service</h1><p>Malcome is at Mayan Warrior in deep playa. Basith is at the playa airport. Watch their messages hop through the local mesh.</p></div></div>
      {(demo.error ?? resetError ?? state.error) && <div className="error-banner" role="alert">{demo.error ?? resetError ?? state.error}</div>}
      {demo.stage && <div role="status" aria-label="Demo playback">{demo.stage}</div>}
      <PairPicker disabled={demo.playing || resetting} nodes={state.nodes.length ? state.nodes : [{ id: 'node0' }, { id: 'node4' }]} a={leftId} b={rightId} setA={setLeftId} setB={setRightId} status={<div className="pair-status" role="status" aria-label="Simulation status"><span>Live simulation</span><span className={`connection ${state.connection}`}><i/>{connectionLabels[state.connection]}</span></div>}
        internet={state.ai?.internetNode ?? null} internetBusy={internetBusy} setInternet={state.mode === 'live' && state.ai && client.setInternetNode ? changeInternet : undefined}/>
      {aiError && <div className="error-banner" role="alert">{aiError}</div>}
      <div className="demo-stage">
        <aside className="phone-column boss-phone" aria-label={`${camper(leftId)} · phone`}><div className="phone-profile" role="group" aria-label={`${camper(leftId)} profile`}><PhoneIdentity role="boss" conversation="playa" endpoints={left}/></div><div className="phone-frame" data-testid="phone-boss"><div className="phone-camera"/><PhoneChat key={`left:${leftId}:${rightId}:${conversationVersion}`} client={client} role="boss" endpoints={left} conversation="playa" demoDraft={demo.drafts.left} disabled={demo.playing || resetting} showIdentity={false} showConversationHeader={false} embedded pickMedia={pickBrowserMedia} renderAudio={uri => <VerifiedAudio uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>} aiTab nodeName={camper} renderModelPicker={props => <ModelSelect {...props}/>} /></div><div className="phone-caption"><i/>{isDefaultPair ? 'Mayan Warrior · Deep playa' : playaNodeLabels[leftId] ?? leftId}</div></aside>

        <section className="console-column" aria-label="Network console">
          <div className="network-conversation"><div className="network-conversation-title"><h2>{camper(leftId)} → {camper(rightId)}</h2><span className="network-mesh-badge"><i/>MESH</span></div></div>

          <section className="topology-panel"><div className="panel-heading"><div><h2>Network</h2></div><button className={`distance-toggle ${distanceAware ? 'on' : ''}`} role="switch" disabled={demo.playing || resetting} aria-checked={distanceAware} aria-label="Distance-aware routing" onClick={toggleDistance}><i/>Distances &amp; best route</button><span className="nodes-status"><i/>{state.nodes.filter(node => node.online).length} / {state.nodes.length} nodes online</span></div>
            <LastMessage message={selected}/>
            {routingError && <div className="error-banner" role="alert">{routingError}</div>}
            <Topology state={state} message={selected} events={events} onMove={client.moveNode && !demo.playing && !resetting ? moveNode : undefined}/>
            <div className="route-detail"><div><span className="small-label">SELECTED ROUTE</span><div className="route-path" aria-label="Selected route">{selected ? (selected.route.length ? selected.route.join(' → ') : 'Route unavailable') : 'Send a message to trace its route'}</div></div><div className={`route-status ${verified ? 'verified' : ''}`}>{verified ? <ShieldCheck size={15}/> : <Activity size={15}/>}<span>{selected ? deliveryLabel(selected) : 'Ready when you are'}</span></div></div>
          <RouteProofPanel message={selected} distanceAware={distanceAware}/>
          </section>
          <div className="metrics-row"><Metric name="Bandwidth" value={telemetry.bitRate === null ? null : telemetry.bitRate / 1000} unit="kbps" note={replay ? 'Sample radio configuration' : 'Configured radio bit rate'} icon={<Signal size={13}/>}/><Metric name="Delay" value={telemetry.latencyMs === null ? null : telemetry.latencyMs / 1000} unit="s" note={telemetry.latencyMs === null ? 'Receiver verification timing not reported' : replay ? 'Sample message elapsed time' : 'Time to receiver verification'} icon={<Activity size={13}/>}/><Metric name="Range" value={telemetry.rangeMeters} unit="m" note={telemetry.rangeMeters === null ? 'Radio range is not reported' : replay ? 'Sample radio range' : 'Configured radio range'} icon={<Radio size={13}/>}/><Metric name="Packet loss" value={telemetry.observedLossRate === null ? null : telemetry.observedLossRate * 100} unit="%" note="Observed transmitted frames" icon={<ArrowDownLeft size={13}/>}/></div>
          <section className="ledger-panel" id="packet-ledger" data-testid="packet-log"><div className="ledger-heading"><div><h2>Packet ledger<span className="count-badge">{events.length}</span></h2></div><span className="ledger-state"><i/>{replay ? 'REPLAY TRACE' : 'LIVE EVENTS'}</span></div>
            {!!messages.length && <div className="message-picker" aria-label="Inspect messages">{messages.map(message => <button key={message.id} aria-label={`Inspect message ${message.id}`} aria-pressed={selected?.id === message.id} onClick={() => setSelectedId(message.id)}><span className="message-kind">{message.kind}</span><span>{message.preview || message.id}</span><ChevronRight size={12}/></button>)}</div>}
            <div className="ledger-scroll"><table aria-label="Packet ledger"><thead><tr><th>{replay ? 'Elapsed' : 'Sim time'}</th><th>Packet</th><th>Hop</th><th>Event</th><th>Bytes</th></tr></thead><tbody>{events.slice(-60).reverse().map(event => <tr key={event.id} className={`event-${event.kind}`}><td>{traceTime(event.at, selected?.createdAt, replay)}</td><td>{event.packetId}</td><td>{event.from}<span className="hop-arrow">→</span>{event.to}</td><td><span className="event-label">{eventLabels[event.kind]}</span></td><td>{event.bytes ?? '—'}</td></tr>)}</tbody></table>
              {!events.length && <div className="ledger-empty"><span className="empty-signal"><Radio size={23}/></span><strong>{!replay && !state.capabilities.packetEvents ? 'Packet events unavailable' : 'The next message starts the story.'}</strong><p>{!replay && !state.capabilities.packetEvents ? 'This backend does not provide a packet event stream.' : 'Send from either phone to follow its packets, hop by hop.'}</p></div>}
            </div><div className="ledger-footer"><span>{selected ? `${selected.received} / ${selected.totalChunks} chunks received` : 'No message selected'}</span><span>{replay ? 'DEMO DATA' : 'SERVICE DATA'}</span></div>
          </section>
        </section>

        <aside className="phone-column employee-phone" aria-label={`${camper(rightId)} · phone`}><div className="phone-profile" role="group" aria-label={`${camper(rightId)} profile`}><PhoneIdentity role="employee" conversation="playa" endpoints={right}/></div><div className="phone-frame" data-testid="phone-employee"><div className="phone-camera"/><PhoneChat key={`right:${rightId}:${leftId}:${conversationVersion}`} client={client} role="employee" endpoints={right} conversation="playa" demoDraft={demo.drafts.right} disabled={demo.playing || resetting} showIdentity={false} showConversationHeader={false} embedded pickMedia={pickBrowserMedia} renderAudio={uri => <VerifiedAudio uri={uri}/>} renderVoiceRecorder={props => <VoiceRecorder {...props}/>} aiTab nodeName={camper} renderModelPicker={props => <ModelSelect {...props}/>} /></div><div className="phone-caption"><i/>{isDefaultPair ? 'Playa airport' : playaNodeLabels[rightId] ?? rightId}</div></aside>
      </div>
      <footer className="page-footer"><span><Waves size={14}/> Water Connect mesh simulator</span><span>Water Connect</span></footer>
    </main>
    {settingsOpen && <div className="dialog-backdrop"><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="dialog-heading"><h2 id="settings-title">Connection settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X size={18}/></button></div><p>Use the local proxy or enter your simulator service URL.</p><form onSubmit={event => { event.preventDefault(); client.setMode('live', endpoint.trim() || '/api'); setSelectedId(null); setSettingsOpen(false); }}><label htmlFor="endpoint">Backend URL</label><input id="endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="/api"/><p className="settings-hint">/api uses the configured local simulator proxy.</p><button className="apply-button" type="submit">Connect to live backend<ArrowUpRight size={15}/></button></form></section></div>}
  </div>;
}
