// @vitest-environment node
// Opt-in: TEAMWATER_CONNECT_URL=http://127.0.0.1:8000/connect npx vitest run tests/integration/water-ai-live.test.ts
// Drives the shippable phone module against a real Water Connect server (and its real model provider).
import { expect, test } from 'vitest';
import { WaterAI } from '../../shippable/water-ai/src';

const base = process.env.TEAMWATER_CONNECT_URL?.replace(/\/+$/, '');

async function setupTokens(count: number): Promise<string[]> {
  let cookie = '';
  const go = async (path: string, form: Record<string, string>) => {
    const r = await fetch(`${base}${path}`, { method: 'POST', body: new URLSearchParams(form), redirect: 'manual', headers: cookie ? { cookie } : {} });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return r.headers.get('location') ?? '';
  };
  await go('/signup', { email: `phone-${Date.now()}@water.test`, password: 'password123' });
  const groupId = (await go('/groups', { name: 'Phone module check' })).split('/').pop()!;
  const tokens = [];
  for (let i = 0; i < count; i++) tokens.push(new URL(await go('/connect', { group_id: groupId, device_name: `phone ${i}`, return: 'water://connected' }), 'water://x').searchParams.get('token')!);
  return tokens;
}

test.runIf(Boolean(base))('phone module: real setup, sealed question via a gateway phone, answer opened on the asker', async () => {
  const [t1, t2] = await setupTokens(2);
  const asker = new WaterAI(await WaterAI.connect(base!, t1));
  const gateway = new WaterAI(await WaterAI.connect(base!, t2));
  expect(asker.credentials.models.length).toBeGreaterThan(10);

  const { requestId, frame } = await asker.ask('How long does a packet take per hop at Long Fast?');
  const reply = await gateway.relay(frame);
  expect(reply.state).toBe('answered');
  if (reply.state !== 'answered') return;
  const result = await asker.receive(reply.frame);
  expect(result?.requestId).toBe(requestId);
  expect(['ok', 'general']).toContain(result?.outcome);
  expect(result?.text.length).toBeGreaterThan(0);
  await gateway.receipt(requestId);
  console.log('live answer:', result);
}, 90_000);
