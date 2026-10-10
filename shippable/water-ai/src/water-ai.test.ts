// @vitest-environment node
import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors.json';
import { fromBase64, fromHex, toBase64, toHex } from './bytes';
import { buildRequestFrame, openAnswerFrame, parseRequestFrame, seal, signRelayBody, unseal, MAX_QUESTION_BYTES } from './protocol';
import { WaterAI } from './client';
import type { DeviceCredentials } from './client';

const key = fromHex(vectors.key_hex);

describe('wire format matches the Water Connect server byte for byte', () => {
  it('builds the identical request frame', async () => {
    const { frame } = await buildRequestFrame({ key, deviceId: vectors.device_id, question: vectors.question, modelIndex: vectors.model_index,
      requestId: vectors.request_id, nonce: fromHex(vectors.question_nonce_hex) });
    expect(toHex(frame)).toBe(vectors.request_frame_hex);
  });

  it('opens server-sealed answers, including source ids and the general-knowledge outcome', async () => {
    expect(await openAnswerFrame(fromHex(vectors.answer_frame_hex), key, vectors.device_id))
      .toEqual({ requestId: vectors.request_id, ...vectors.answer });
    expect(await openAnswerFrame(fromHex(vectors.general_answer_frame_hex), key, vectors.device_id))
      .toEqual({ requestId: vectors.request_id, ...vectors.general_answer });
  });

  it('signs gateway calls exactly as the server verifies them', async () => {
    expect(await signRelayBody(key, vectors.relay_timestamp, vectors.relay_body)).toBe(vectors.relay_signature_hex);
  });

  it('reads routing fields without opening the question, and base64 matches Python', () => {
    const parsed = parseRequestFrame(fromHex(vectors.request_frame_hex));
    expect(parsed.requestId).toBe(vectors.request_id);
    expect(parsed.askerDeviceId).toBe(vectors.device_id);
    expect(toHex(parsed.sealed)).toBe(vectors.sealed_question_hex);
    expect(toBase64(parsed.sealed)).toBe(JSON.parse(vectors.relay_body).sealed);
    expect(toHex(fromBase64(toBase64(parsed.sealed)))).toBe(vectors.sealed_question_hex);
  });
});

describe('security properties', () => {
  it('rejects altered bytes, another phone, and another request', async () => {
    const frame = fromHex(vectors.answer_frame_hex);
    const altered = frame.slice(); altered[altered.length - 1] ^= 1;
    await expect(openAnswerFrame(altered, key, vectors.device_id)).rejects.toThrow(/Could not open/);
    await expect(openAnswerFrame(frame, key, vectors.device_id + 1)).rejects.toThrow(/Could not open/);
    const sealed = await seal(key, vectors.request_id, 1, new Uint8Array([1, 2]), 'Q');
    await expect(unseal(key, '00000000-0000-4000-8000-000000000000', 1, sealed, 'Q')).rejects.toThrow();
    await expect(unseal(key, vectors.request_id, 1, sealed, 'A')).rejects.toThrow(); // a question can't pass as an answer
  });

  it('never puts the question in clear text on the radio and enforces the radio size limit', async () => {
    const { frame } = await buildRequestFrame({ key, deviceId: 7, question: 'secret meeting point' });
    expect(new TextDecoder().decode(frame)).not.toContain('secret');
    await expect(buildRequestFrame({ key, deviceId: 7, question: 'x'.repeat(MAX_QUESTION_BYTES + 1) })).rejects.toThrow(/400 bytes/);
    await expect(buildRequestFrame({ key, deviceId: 7, question: 'hi', modelIndex: 256 })).rejects.toThrow(/one byte/);
  });
});

/** Stands in for Water Connect: verifies the gateway's signature, opens the question with the asker's key, seals an answer. */
function fakeConnect(keys: Record<number, Uint8Array>, calls: string[]): typeof fetch {
  const answered = new Map<string, string>();
  return (async (url: string, init: RequestInit) => {
    const body = String(init.body); const h = init.headers as Record<string, string>;
    const sig = await signRelayBody(keys[Number(h['X-Device-Id'])], h['X-Timestamp'], body);
    if (sig !== h['X-Signature']) return new Response(JSON.stringify({ detail: 'Bad signature' }), { status: 401 });
    const data = JSON.parse(body);
    calls.push(url.split('/v1/')[1]);
    if (url.endsWith('/v1/receipt')) return Response.json({ state: 'receipt_recorded' });
    if (!answered.has(data.request_id)) {
      const plain = await unseal(keys[data.device_id], data.request_id, data.device_id, fromBase64(data.sealed), 'Q');
      const text = `Model ${plain[0]} says: about 1.07 kbps.`;
      const wire = new Uint8Array([0, ...new TextEncoder().encode(text), 0x1e, ...new TextEncoder().encode('field_guide-01')]);
      answered.set(data.request_id, toBase64(await seal(keys[data.device_id], data.request_id, data.device_id, wire, 'A')));
      calls.push('ai-call');
    }
    return Response.json({ state: 'answered', answer: answered.get(data.request_id) });
  }) as typeof fetch;
}

const creds = (deviceId: number, k: Uint8Array): DeviceCredentials =>
  ({ connectUrl: 'https://connect.example/connect', deviceId, groupId: 1, deviceKey: k, models: [], defaultModel: 0 });

describe('WaterAI client: asker phone and gateway phone', () => {
  it('asks offline, a gateway relays it, and the asker opens the answer once', async () => {
    const askerKey = crypto.getRandomValues(new Uint8Array(32)), gatewayKey = crypto.getRandomValues(new Uint8Array(32));
    const calls: string[] = [];
    const server = fakeConnect({ 1: askerKey, 2: gatewayKey }, calls);
    const asker = new WaterAI(creds(1, askerKey), { fetch: server });
    const gateway = new WaterAI(creds(2, gatewayKey), { fetch: server });

    const { requestId, frame } = await asker.ask('How fast is Long Fast?', 3);   // → radio
    const reply = await gateway.relay(frame);                                     // gateway has internet
    if (reply.state !== 'answered') throw new Error('expected an answer');
    expect(await gateway.receive(reply.frame)).toBeNull();                        // not the gateway's question

    const result = await asker.receive(reply.frame);                              // ← radio
    expect(result).toMatchObject({ requestId, outcome: 'ok', text: 'Model 3 says: about 1.07 kbps.', sources: ['field_guide-01'], duplicate: false });
    expect((await asker.receive(reply.frame))?.duplicate).toBe(true);             // second gateway delivered it too
    await gateway.receipt(requestId);

    // A retry through another gateway reuses the request ID: the server answers from storage.
    await gateway.relay(frame);
    expect(calls.filter(c => c === 'ai-call')).toHaveLength(1);
    expect(calls).toContain('receipt');
    expect(asker.questions()[0]).toMatchObject({ requestId, status: 'answered', modelIndex: 3 });
  });

  it('connects with a setup token and surfaces server errors', async () => {
    const k = new Uint8Array(32).fill(9);
    const ok = (async () => Response.json({ device_id: 5, group_id: 2, device_key: toBase64(k), models: [{ index: 0, id: 'm' }], default_model: 0 })) as unknown as typeof fetch;
    const c = await WaterAI.connect('https://h/connect/', 'tok', { fetch: ok });
    expect(c).toMatchObject({ connectUrl: 'https://h/connect', deviceId: 5, groupId: 2 });
    expect(toHex(c.deviceKey)).toBe(toHex(k));
    const bad = (async () => new Response(JSON.stringify({ detail: 'Token invalid, used or expired' }), { status: 400 })) as unknown as typeof fetch;
    await expect(WaterAI.connect('https://h/connect', 'tok', { fetch: bad })).rejects.toThrow('Token invalid, used or expired');
  });
});
