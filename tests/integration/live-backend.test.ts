// @vitest-environment node
import { expect, test } from 'vitest';
import { createMeshClient, deliveryLabel, deriveTelemetry } from '@teamwater/core';
import type { MeshClient, MeshState } from '@teamwater/core';

function waitForState(client: MeshClient, predicate: (state: MeshState) => boolean): Promise<MeshState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe(); reject(new Error('Live backend did not publish the expected state.')); }, 8_000);
    const check = () => {
      const state = client.getSnapshot();
      if (predicate(state)) { clearTimeout(timeout); unsubscribe(); resolve(state); }
    };
    const unsubscribe = client.subscribe(check);
    check();
  });
}

test.runIf(Boolean(process.env.TEAMWATER_LIVE_URL))('two independent clients share real FastAPI messages without inventing telemetry or verification', async () => {
  const endpoint = process.env.TEAMWATER_LIVE_URL!;
  const boss = createMeshClient({ mode: 'live', endpoint });
  const employee = createMeshClient({ mode: 'live', endpoint });
  try {
    boss.start(); employee.start();
    await Promise.all([waitForState(boss, state => state.nodes.length === 6), waitForState(employee, state => state.nodes.length === 6)]);
    const request = 'Live integration: can you fix the code?';
    const id = await boss.sendText('node0', 'node4', request);
    const received = await waitForState(employee, state => Boolean(state.messages[id]));
    expect(received.messages[id].preview).toBe(request);
    expect(received.messages[id]).toMatchObject({ src: 'node0', dst: 'node4', integrity: 'unverified', receiptConfirmed: false });
    expect(deliveryLabel(received.messages[id])).not.toBe('Delivered');
    expect(deriveTelemetry(received, id)).toMatchObject({ transmittedBytes: null, observedLossRate: null, latencyMs: null });
    const reply = await employee.sendText('node4', 'node0', 'Live integration: received the request.');
    const updated = await waitForState(boss, state => Boolean(state.messages[reply]));
    expect(updated.messages[reply]).toMatchObject({ src: 'node4', dst: 'node0', receiptConfirmed: false });
  } finally { boss.dispose(); employee.dispose(); }
}, 20_000);
