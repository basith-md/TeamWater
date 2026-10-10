import { useEffect, useRef, useState } from 'react';
import type { MeshClient } from '@teamwater/core';

const invitation = 'Basith, come meet me at the Mayan Warrior set in deep playa!';
const reply = 'On my way from the playa airport, Malcome. See you at Mayan Warrior!';

function cancelled() { return new Error('Demo cancelled.'); }
function active(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }
function interruptible<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    if (signal.aborted) { reject(cancelled()); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); signal.aborted ? reject(cancelled()) : resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 70);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function awaitDelivery(client: MeshClient, id: string, text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let off = () => {}; let seen = false;
    const finish = (error?: Error) => { clearTimeout(timer); off(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new Error('Delivery timed out. Check the simulator and try Play demo again.')), 120_000);
    const check = () => {
      if (signal.aborted) { abort(); return; }
      const state = client.getSnapshot();
      const message = state.messages[id];
      if (state.mode !== 'live' || state.connection === 'error' || state.connection === 'disconnected') { finish(new Error('Simulator connection lost. Reconnect and try Play demo again.')); return; }
      if (!message) { if (seen) finish(new Error('Conversation changed. Try Play demo again.')); return; }
      seen = true;
      if (['failed', 'cancelled', 'receipt_unconfirmed'].includes(message.status)) { finish(new Error('Message delivery could not be confirmed. Check the mesh and try Play demo again.')); return; }
      if (message.status === 'delivered' && message.integrity === 'verified' && message.receiptConfirmed && message.text === text) finish();
    };
    signal.addEventListener('abort', abort, { once: true });
    off = client.subscribe(check); check();
  });
}

export function useDemoPlayback(client: MeshClient) {
  const [playing, setPlaying] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<{ left?: string; right?: string }>({});
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => { run.current?.abort(); run.current = null; }, [client]);
  function cancel() {
    run.current?.abort(); run.current = null;
    setPlaying(false); setStage(''); setError(null); setDrafts({});
  }
  async function start(prepare: () => void) {
    if (run.current) return;
    const controller = new AbortController(); run.current = controller;
    const signal = controller.signal;
    const initial = client.getSnapshot();
    let connectionFailure: Error | null = null;
    const checkConnection = () => {
      const current = client.getSnapshot();
      if (current.endpoint !== initial.endpoint || current.mode !== initial.mode || current.connection === 'error' || current.connection === 'disconnected') {
        connectionFailure = new Error('Simulator connection changed. Reconnect and try Play demo again.');
        controller.abort();
      }
    };
    const unsubscribe = client.subscribe(checkConnection);
    setPlaying(true); setError(null); setStage('Resetting the conversation…');
    try {
      if (!client.resetConversation) throw new Error('Simulator reset is unavailable.');
      if (client.getSnapshot().mode !== 'live') throw new Error('Play demo requires live simulation.');
      checkConnection(); active(signal);
      await interruptible(client.resetConversation(), signal); active(signal);
      prepare(); setDrafts({ left: '', right: '' });
      async function type(side: 'left' | 'right', text: string) {
        for (let length = 1; length <= text.length; length++) {
          await pause(signal); active(signal);
          setDrafts(draft => ({ ...draft, [side]: text.slice(0, length) }));
        }
      }
      setStage('Malcome is typing…'); await type('left', invitation);
      const first = await interruptible(client.sendText('node0', 'node4', invitation), signal); active(signal);
      setDrafts(draft => ({ ...draft, left: '' })); setStage('Delivering Malcome’s invitation…');
      await awaitDelivery(client, first, invitation, signal); active(signal);
      setStage('Basith is typing…'); await type('right', reply);
      const second = await interruptible(client.sendText('node4', 'node0', reply), signal); active(signal);
      setDrafts(draft => ({ ...draft, right: '' })); setStage('Delivering Basith’s reply…');
      await awaitDelivery(client, second, reply, signal); active(signal);
      setStage('Demo complete · both messages verified');
    } catch (failure) {
      if (run.current === controller && (!signal.aborted || connectionFailure)) {
        const reason = connectionFailure ?? failure;
        setError(`Demo stopped: ${reason instanceof Error ? reason.message : 'Try again.'}`);
        setStage('Demo stopped');
      }
    } finally {
      unsubscribe();
      if (run.current === controller) { run.current = null; setPlaying(false); setDrafts({}); }
    }
  }
  return { playing, stage, error, drafts, start, cancel };
}
