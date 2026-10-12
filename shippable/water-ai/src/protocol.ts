/**
 * Water AI wire format, byte-compatible with Water Connect (connect/security.py, connect/pipeline.py,
 * service/ai_gateway.py). Verified against shippable/water-ai/test-vectors.json, which the Python
 * server generates.
 *
 *   sealed         = nonce(12) | AES-256-GCM ciphertext | tag(16)
 *                    AAD = requestId(16) | deviceId(u32 BE) | purpose ('Q' question, 'A' answer)
 *   request frame  = requestId(16) | askerDeviceId(u32 BE) | sealed(modelIndex(1) | question UTF-8)
 *   answer frame   = requestId(16) | sealed(outcome(1) | answer UTF-8 [| 0x1E | source ids, comma-separated])
 *
 * Only the asker's phone and Water Connect hold the asker's key: a gateway phone carries the
 * frames but cannot read or alter them.
 */
import { bytesToUuid, concat, fromUtf8, readU32, toHex, u32, utf8, uuidToBytes } from './bytes';

export type Outcome = 'ok' | 'general' | 'blocked' | 'over_budget' | 'no_grounding' | 'error';
export const OUTCOME_CODES: Record<Outcome, number> = { ok: 0, blocked: 1, over_budget: 2, no_grounding: 3, error: 4, general: 5 };
const OUTCOMES = Object.fromEntries(Object.entries(OUTCOME_CODES).map(([k, v]) => [v, k])) as Record<number, Outcome>;

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
/** Questions travel over a ~1 kbps radio; Water Connect rejects anything longer. */
export const MAX_QUESTION_BYTES = 400;
/** Bytes a request frame adds around the question: request ID, device ID, model byte, nonce, tag. */
export const FRAME_OVERHEAD_BYTES = 16 + 4 + 1 + NONCE_BYTES + TAG_BYTES;

/** The subset of Web Crypto this module needs. Browsers, Node 20+, and React Native with a WebCrypto polyfill provide it. */
export interface CryptoLike {
  subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

export function defaultCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c?.subtle || !c.getRandomValues) throw new Error('Web Crypto is unavailable. On React Native, install a WebCrypto polyfill or pass `crypto` explicitly.');
  return c;
}

export interface AnswerResult { requestId: string; outcome: Outcome; text: string; sources: string[] }
export interface RequestFrame { requestId: string; askerDeviceId: number; sealed: Uint8Array }

const purposeByte = (p: 'Q' | 'A') => new Uint8Array([p.charCodeAt(0)]);
const aad = (requestId: string, deviceId: number, p: 'Q' | 'A') => concat(uuidToBytes(requestId), u32(deviceId), purposeByte(p));
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function aesKey(key: Uint8Array, crypto: CryptoLike, usage: KeyUsage[]) {
  if (key.length !== 32) throw new Error('Device key must be 32 bytes');
  return crypto.subtle.importKey('raw', buf(key), 'AES-GCM', false, usage);
}

export async function seal(key: Uint8Array, requestId: string, deviceId: number, plaintext: Uint8Array, purpose: 'Q' | 'A',
  { crypto = defaultCrypto(), nonce }: { crypto?: CryptoLike; nonce?: Uint8Array } = {}): Promise<Uint8Array> {
  const iv = nonce ?? crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (iv.length !== NONCE_BYTES) throw new Error('Nonce must be 12 bytes');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad(requestId, deviceId, purpose)) },
    await aesKey(key, crypto, ['encrypt']), buf(plaintext));
  return concat(iv, new Uint8Array(ct));
}

export async function unseal(key: Uint8Array, requestId: string, deviceId: number, sealed: Uint8Array, purpose: 'Q' | 'A',
  { crypto = defaultCrypto() }: { crypto?: CryptoLike } = {}): Promise<Uint8Array> {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) throw new Error('Sealed message too short');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(sealed.slice(0, NONCE_BYTES)), additionalData: buf(aad(requestId, deviceId, purpose)) },
      await aesKey(key, crypto, ['decrypt']), buf(sealed.slice(NONCE_BYTES)));
    return new Uint8Array(pt);
  } catch {
    throw new Error('Could not open: wrong key, wrong request, or the bytes were altered');
  }
}

export function newRequestId(crypto: CryptoLike = defaultCrypto()): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 v4
  return bytesToUuid(b);
}

/** Asker: seal a question and build the bytes to hand to the radio. */
export async function buildRequestFrame(opts: { key: Uint8Array; deviceId: number; question: string; modelIndex?: number; requestId?: string; crypto?: CryptoLike; nonce?: Uint8Array }) {
  const crypto = opts.crypto ?? defaultCrypto();
  const question = opts.question.trim().replace(/\s+/g, ' ');
  if (!question) throw new Error('Ask a question first');
  const text = utf8(question);
  if (text.length > MAX_QUESTION_BYTES) throw new Error(`Keep questions under ${MAX_QUESTION_BYTES} bytes: they travel over the radio`);
  const modelIndex = opts.modelIndex ?? 0;
  if (!Number.isInteger(modelIndex) || modelIndex < 0 || modelIndex > 255) throw new Error('Model index must fit in one byte');
  const requestId = opts.requestId ?? newRequestId(crypto);
  const sealed = await seal(opts.key, requestId, opts.deviceId, concat(new Uint8Array([modelIndex]), text), 'Q', { crypto, nonce: opts.nonce });
  return { requestId, frame: concat(uuidToBytes(requestId), u32(opts.deviceId), sealed) };
}

/** Gateway: read the routing fields of a request frame. The question itself stays sealed. */
export function parseRequestFrame(frame: Uint8Array): RequestFrame {
  if (frame.length < 20 + NONCE_BYTES + TAG_BYTES) throw new Error('Request frame too short');
  return { requestId: bytesToUuid(frame.slice(0, 16)), askerDeviceId: readU32(frame, 16), sealed: frame.slice(20) };
}

export const answerFrameRequestId = (frame: Uint8Array) => {
  if (frame.length < 16 + NONCE_BYTES + TAG_BYTES) throw new Error('Answer frame too short');
  return bytesToUuid(frame.slice(0, 16));
};

/** Asker: open an answer frame that arrived over the radio. */
export async function openAnswerFrame(frame: Uint8Array, key: Uint8Array, deviceId: number, crypto?: CryptoLike): Promise<AnswerResult> {
  const requestId = answerFrameRequestId(frame);
  const plain = await unseal(key, requestId, deviceId, frame.slice(16), 'A', { crypto });
  const sep = plain.indexOf(0x1e, 1);
  const text = fromUtf8(plain.slice(1, sep < 0 ? undefined : sep));
  const sources = sep < 0 ? [] : fromUtf8(plain.slice(sep + 1)).split(',').filter(Boolean);
  return { requestId, outcome: OUTCOMES[plain[0]] ?? 'error', text, sources };
}

/** Gateway: HMAC-SHA256 over `${timestamp}.${body}`, hex, as Water Connect's X-Signature expects. */
export async function signRelayBody(key: Uint8Array, timestamp: string, body: string, crypto: CryptoLike = defaultCrypto()): Promise<string> {
  const k = await crypto.subtle.importKey('raw', buf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, buf(utf8(`${timestamp}.${body}`)))));
}
