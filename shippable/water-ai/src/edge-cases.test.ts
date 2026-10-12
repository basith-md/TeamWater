// @vitest-environment node
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToUuid, fromBase64, fromHex, toBase64, toHex, uuidToBytes } from './bytes';
import { answerFrameRequestId, buildRequestFrame, newRequestId, openAnswerFrame, parseRequestFrame, seal, signRelayBody, unseal, MAX_QUESTION_BYTES, FRAME_OVERHEAD_BYTES } from './protocol';
import { WaterAI } from './client';
import type { DeviceCredentials } from './client';

const rand = (n: number) => new Uint8Array(randomBytes(n));
const aad = (rid: string, dev: number, p: 'Q' | 'A') => Buffer.concat([Buffer.from(rid.replace(/-/g, ''), 'hex'), Buffer.from([dev >>> 24 & 255, dev >>> 16 & 255, dev >>> 8 & 255, dev & 255]), Buffer.from(p)]);

/** Independent reference: Node's own AES-GCM, not Web Crypto, so the module isn't only checking itself. */
function nodeSeal(key: Uint8Array, rid: string, dev: number, plain: Uint8Array, p: 'Q' | 'A', nonce: Uint8Array) {
  const c = createCipheriv('aes-256-gcm', key, nonce); c.setAAD(aad(rid, dev, p));
  return new Uint8Array(Buffer.concat([Buffer.from(nonce), c.update(plain), c.final(), c.getAuthTag()]));
}
function nodeOpen(key: Uint8Array, rid: string, dev: number, sealed: Uint8Array, p: 'Q' | 'A') {
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12)); d.setAAD(aad(rid, dev, p));
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return new Uint8Array(Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]));
}

describe('cross-check against Node crypto on random inputs', () => {
  it('seal/unseal agree with an independent AES-256-GCM in both directions (200 cases)', async () => {
    for (let i = 0; i < 200; i++) {
      const key = rand(32), rid = newRequestId(), dev = (randomBytes(4).readUInt32BE(0)), nonce = rand(12);
      const plain = rand(Math.floor(Math.random() * 500)); const p = i % 2 ? 'A' : 'Q';
      const ours = await seal(key, rid, dev, plain, p, { nonce });
      expect(toHex(ours)).toBe(toHex(nodeSeal(key, rid, dev, plain, p, nonce)));
      expect(toHex(nodeOpen(key, rid, dev, ours, p))).toBe(toHex(plain));
      expect(toHex(await unseal(key, rid, dev, nodeSeal(key, rid, dev, plain, p, nonce), p))).toBe(toHex(plain));
    }
  });

  it('HMAC signatures match Node for random keys and bodies (100 cases)', async () => {
    for (let i = 0; i < 100; i++) {
      const key = rand(32), ts = String(1_700_000_000 + Math.random() * 1e8), body = JSON.stringify({ n: toHex(rand(40)), u: 'ünïcødé ✓' });
      expect(await signRelayBody(key, ts, body)).toBe(createHmac('sha256', key).update(`${ts}.${body}`).digest('hex'));
    }
  });

  it('base64 and hex match Node Buffer for every length 0..300', () => {
    for (let n = 0; n <= 300; n++) {
      const b = rand(n);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
      expect(toHex(fromBase64(Buffer.from(b).toString('base64')))).toBe(toHex(b));
      expect(toHex(fromHex(Buffer.from(b).toString('hex')))).toBe(toHex(b));
    }
  });
});

describe('frame edge cases', () => {
  const key = rand(32);

  it('handles multi-byte Unicode at the exact radio limit', async () => {
    const atLimit = '✓'.repeat(MAX_QUESTION_BYTES / 4) + 'é'.repeat(MAX_QUESTION_BYTES / 4); // 3*100 + 2*100 = 500 > 400
    await expect(buildRequestFrame({ key, deviceId: 1, question: atLimit })).rejects.toThrow(/400 bytes/);
    const exact = 'é'.repeat(MAX_QUESTION_BYTES / 2); // 200 × 2 bytes = 400
    const { frame, requestId } = await buildRequestFrame({ key, deviceId: 1, question: exact, modelIndex: 255 });
    expect(frame.length).toBe(MAX_QUESTION_BYTES + FRAME_OVERHEAD_BYTES);
    const plain = await unseal(key, requestId, 1, parseRequestFrame(frame).sealed, 'Q');
    expect(plain[0]).toBe(255);
    expect(new TextDecoder().decode(plain.slice(1))).toBe(exact);
  });

  it('normalises whitespace and rejects empty questions', async () => {
    const { frame, requestId } = await buildRequestFrame({ key, deviceId: 9, question: '  How   far\n is  it? ' });
    expect(new TextDecoder().decode((await unseal(key, requestId, 9, parseRequestFrame(frame).sealed, 'Q')).slice(1))).toBe('How far is it?');
    await expect(buildRequestFrame({ key, deviceId: 9, question: ' \n\t ' })).rejects.toThrow(/Ask a question/);
  });

  it('round-trips the largest device id and generates valid v4 request ids', async () => {
    const { frame } = await buildRequestFrame({ key, deviceId: 0xffffffff, question: 'hi' });
    expect(parseRequestFrame(frame).askerDeviceId).toBe(0xffffffff);
    await expect(buildRequestFrame({ key, deviceId: -1, question: 'hi' })).rejects.toThrow(/device ID/);
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bytesToUuid(uuidToBytes([...ids][0]))).toBe([...ids][0]);
  });

  it('rejects short or malformed frames instead of misreading them', async () => {
    expect(() => parseRequestFrame(rand(47))).toThrow(/too short/);
    expect(() => answerFrameRequestId(rand(43))).toThrow(/too short/);
    expect(() => fromHex('abc')).toThrow(); expect(() => fromBase64('###')).toThrow();
    await expect(seal(rand(16), newRequestId(), 1, rand(4), 'Q')).rejects.toThrow(/32 bytes/);
  });

  it('parses answers with no sources, empty text, and unknown outcome codes', async () => {
    const rid = newRequestId();
    const frame = async (plain: number[]) => new Uint8Array([...uuidToBytes(rid), ...await seal(key, rid, 3, new Uint8Array(plain), 'A')]);
    expect(await openAnswerFrame(await frame([0, 0x68, 0x69]), key, 3)).toMatchObject({ outcome: 'ok', text: 'hi', sources: [] });
    expect(await openAnswerFrame(await frame([3]), key, 3)).toMatchObject({ outcome: 'no_grounding', text: '', sources: [] });
    expect(await openAnswerFrame(await frame([99, 0x78]), key, 3)).toMatchObject({ outcome: 'error', text: 'x' });
    expect((await openAnswerFrame(await frame([0, 0x61, 0x1e, 0x73, 0x31, 0x2c, 0x73, 0x32]), key, 3)).sources).toEqual(['s1', 's2']);
  });
});

describe('client error paths', () => {
  const creds = (deviceKey = rand(32)): DeviceCredentials => ({ connectUrl: 'https://c/connect', deviceId: 1, groupId: 1, deviceKey, models: [], defaultModel: 4 });
  const respond = (status: number, body: object) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reports already_claimed with the retry hint, and surfaces server errors', async () => {
    const asker = new WaterAI(creds());
    const { frame } = await asker.ask('q');
    expect(await new WaterAI(creds(), { fetch: respond(200, { state: 'already_claimed', retry_after: 17 }) }).relay(frame))
      .toMatchObject({ state: 'already_claimed', retryAfterSeconds: 17 });
    await expect(new WaterAI(creds(), { fetch: respond(403, { detail: "Gateway is not in the asker's group" }) }).relay(frame)).rejects.toThrow(/not in the asker's group/);
    await expect(new WaterAI(creds(), { fetch: respond(500, {}) }).receipt('x')).rejects.toThrow(/500/);
    await expect(new WaterAI(creds(), { fetch: respond(200, { state: 'weird' }) }).relay(frame)).rejects.toThrow(/Unexpected/);
  });

  it('uses the group default model when none is given, and ignores other phones’ answers', async () => {
    const key = rand(32); const ai = new WaterAI(creds(key));
    const { requestId, frame } = await ai.ask('default model?');
    expect(ai.questions()[0].modelIndex).toBe(4);
    expect((await unseal(key, requestId, 1, parseRequestFrame(frame).sealed, 'Q'))[0]).toBe(4);
    const strangerRid = newRequestId();
    expect(await ai.receive(new Uint8Array([...uuidToBytes(strangerRid), ...rand(40)]))).toBeNull();
  });

  it('a gateway-forged answer for a pending question is rejected, not shown', async () => {
    const ai = new WaterAI(creds());
    const { requestId } = await ai.ask('real question');
    const forged = new Uint8Array([...uuidToBytes(requestId), ...await seal(rand(32), requestId, 1, new Uint8Array([0, 0x6c, 0x69, 0x65]), 'A')]);
    await expect(ai.receive(forged)).rejects.toThrow(/Could not open/);
    expect(ai.questions()[0].status).toBe('sent');
  });
});
