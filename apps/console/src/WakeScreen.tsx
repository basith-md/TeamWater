import { useEffect, useState } from 'react';
import { Waves } from 'lucide-react';
import type { MeshClient, MeshState } from '@teamwater/core';

// Shown while the hosted simulator wakes from sleep. Free hosts take 30–60 s, longer than the
// client's own reconnect backoff, so this keeps pinging and restarts live mode once it answers.
const SHOW_AFTER_S = 0.8;
const PING_EVERY_MS = 3000;
const PING_TIMEOUT_MS = 8000;
const hops = [{ x: 20, y: 60 }, { x: 70, y: 22 }, { x: 125, y: 62 }, { x: 180, y: 20 }, { x: 235, y: 58 }];
const spur = { x: 128, y: 8 };

function httpBase(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '').replace(/\/ws$/, '').replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

function stage(elapsed: number, connected: boolean) {
  if (connected) return 'Connected. Starting the mesh…';
  if (elapsed < 8) return 'Connecting to the mesh simulator…';
  if (elapsed < 50) return 'Waking the simulator. It runs on a free server that sleeps when idle, so the first visit takes 30–60 seconds.';
  return 'Almost there. The server is still waking up…';
}

export function WakeScreen({ client, state }: { client: MeshClient; state: MeshState }) {
  const connected = state.connection === 'connected';
  const [connectedOnce, setConnectedOnce] = useState(false);
  const [gone, setGone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const live = state.mode === 'live';

  useEffect(() => { if (connected) setConnectedOnce(true); }, [connected]);

  useEffect(() => {
    if (!connectedOnce) return;
    const timer = setTimeout(() => setGone(true), 700);
    return () => clearTimeout(timer);
  }, [connectedOnce]);

  useEffect(() => {
    if (connectedOnce) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => clearInterval(timer);
  }, [connectedOnce]);

  useEffect(() => {
    if (connectedOnce || !live) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ping = async () => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      try {
        const response = await fetch(`${httpBase(state.endpoint)}/nodes`, { signal: controller.signal, cache: 'no-store' });
        const connection = client.getSnapshot().connection;
        if (response.ok && !stopped && connection !== 'connected' && connection !== 'connecting') client.setMode('live', state.endpoint);
      } catch { /* still asleep; try again */ }
      finally {
        clearTimeout(deadline);
        if (!stopped) timer = setTimeout(ping, PING_EVERY_MS);
      }
    };
    void ping();
    return () => { stopped = true; clearTimeout(timer); };
  }, [client, connectedOnce, live, state.endpoint]);

  if (!live || gone || dismissed || (!connectedOnce && elapsed < SHOW_AFTER_S)) return null;
  const progress = connectedOnce ? 100 : Math.round(95 * (1 - Math.exp(-elapsed / 22)));
  return <div className={`wake-screen ${connectedOnce ? 'done' : ''}`} role="dialog" aria-modal="true" aria-labelledby="wake-title">
    <div className="wake-card">
      <div className="wake-brand"><Waves size={22} strokeWidth={2.2}/><span>Water Connect</span></div>
      <svg className="wake-mesh" viewBox="0 0 255 80" aria-hidden="true">
        {hops.slice(1).map((hop, i) => <line key={i} className="wake-link" x1={hops[i].x} y1={hops[i].y} x2={hop.x} y2={hop.y}/>)}
        <line className="wake-link" x1={hops[1].x} y1={hops[1].y} x2={spur.x} y2={spur.y}/><line className="wake-link" x1={spur.x} y1={spur.y} x2={hops[3].x} y2={hops[3].y}/>
        <circle className="wake-node" cx={spur.x} cy={spur.y} r="5"/>
        {hops.map((hop, i) => <g key={i} className="wake-hop" style={{ animationDelay: `${i * 0.35}s` }}>
          <circle className="wake-ring" cx={hop.x} cy={hop.y} r="6" style={{ animationDelay: `${i * 0.35}s` }}/>
          <circle className={`wake-node ${i === 0 || i === hops.length - 1 ? 'endpoint' : ''}`} cx={hop.x} cy={hop.y} r="6"/>
        </g>)}
      </svg>
      <h2 id="wake-title">{connectedOnce ? 'Mesh online' : 'Waking up the mesh'}</h2>
      <p role="status" aria-live="polite">{stage(elapsed, connectedOnce)}</p>
      <div className="wake-progress" role="progressbar" aria-label="Simulator startup" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }}/></div>
      <div className="wake-meta"><span>{connectedOnce ? 'Ready' : `${Math.floor(elapsed)} s`}</span>{!connectedOnce && elapsed > 20 && <button type="button" onClick={() => setDismissed(true)}>Look around while it loads</button>}</div>
    </div>
  </div>;
}
