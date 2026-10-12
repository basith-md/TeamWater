/**
 * The phone side of Water AI. One instance per phone.
 *
 *   const ai = new WaterAI(await WaterAI.connect(CONNECT_URL, setupToken)); // once, while online
 *   const { requestId, frame } = await ai.ask('How fast is Long Fast?');   // hand `frame` to the radio
 *   const result = await ai.receive(answerFrame);                         // bytes the radio delivered
 *
 * When this phone has internet it can also be the gateway for others:
 *   const reply = await ai.relay(requestFrame);   // send reply.frame back over the radio
 *
 * The radio is not this module's job: it only produces and consumes bytes.
 */
import { fromBase64, toBase64 } from './bytes';
import type { AnswerResult, CryptoLike } from './protocol';
import { answerFrameRequestId, buildRequestFrame, defaultCrypto, openAnswerFrame, parseRequestFrame, signRelayBody } from './protocol';
import { concat, uuidToBytes } from './bytes';

export interface WaterAIModel { index: number; id: string; label: string; provider: string; tier: string; privacy: string; privacy_level: 'ok' | 'unknown' | 'avoid' }

/** What a phone stores after setup. Keep `deviceKey` in secure storage (Keychain / Keystore), never in logs. */
export interface DeviceCredentials {
  connectUrl: string; deviceId: number; groupId: number; deviceKey: Uint8Array;
  models: WaterAIModel[]; defaultModel: number;
}

export type AskStatus = 'sent' | 'answered';
export interface PendingQuestion { requestId: string; question: string; modelIndex: number; askedAt: number; status: AskStatus; result?: AnswerResult }

export type RelayReply =
  | { state: 'answered'; requestId: string; frame: Uint8Array }
  | { state: 'already_claimed'; requestId: string; retryAfterSeconds: number };

export interface WaterAIOptions { crypto?: CryptoLike; fetch?: typeof fetch; now?: () => number }

export class WaterAI {
  readonly credentials: DeviceCredentials;
  private readonly crypto: CryptoLike;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingQuestion>();

  constructor(credentials: DeviceCredentials, options: WaterAIOptions = {}) {
    this.credentials = credentials;
    this.crypto = options.crypto ?? defaultCrypto();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  /** One-time setup while online: trade the token Water Connect redirected back with for this phone's key. */
  static async connect(connectUrl: string, setupToken: string, options: Pick<WaterAIOptions, 'fetch'> = {}): Promise<DeviceCredentials> {
    const base = connectUrl.replace(/\/+$/, '');
    const r = await (options.fetch ?? fetch)(`${base}/v1/exchange`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: setupToken }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.detail ?? `Setup failed (${r.status})`);
    return { connectUrl: base, deviceId: body.device_id, groupId: body.group_id, deviceKey: fromBase64(body.device_key),
      models: body.models ?? [], defaultModel: body.default_model ?? 0 };
  }

  // ---------- asking (works fully offline) ----------
  async ask(question: string, modelIndex = this.credentials.defaultModel) {
    const { requestId, frame } = await buildRequestFrame({ key: this.credentials.deviceKey, deviceId: this.credentials.deviceId, question, modelIndex, crypto: this.crypto });
    this.pending.set(requestId, { requestId, question: question.trim(), modelIndex, askedAt: this.now(), status: 'sent' });
    return { requestId, frame };
  }

  /**
   * Handle an answer frame from the radio. Returns the answer for this phone's own questions,
   * the same answer again for duplicates (gateways may deliver twice), or null if it isn't ours.
   */
  async receive(frame: Uint8Array): Promise<(AnswerResult & { duplicate: boolean }) | null> {
    const entry = this.pending.get(answerFrameRequestId(frame));
    if (!entry) return null;
    if (entry.result) return { ...entry.result, duplicate: true };
    const result = await openAnswerFrame(frame, this.credentials.deviceKey, this.credentials.deviceId, this.crypto);
    entry.status = 'answered'; entry.result = result;
    return { ...result, duplicate: false };
  }

  /** Questions this phone has asked, newest last. Resend `frame` with the same request ID to retry: no second AI call. */
  questions(): PendingQuestion[] { return [...this.pending.values()]; }

  // ---------- gateway role (only when this phone has internet) ----------
  /** Relay a request frame another phone sent over the radio. The question stays sealed. */
  async relay(requestFrame: Uint8Array): Promise<RelayReply> {
    const { requestId, askerDeviceId, sealed } = parseRequestFrame(requestFrame);
    const res = await this.post('/v1/relay', { request_id: requestId, device_id: askerDeviceId, sealed: toBase64(sealed) });
    if (res.state === 'already_claimed') return { state: 'already_claimed', requestId, retryAfterSeconds: res.retry_after ?? 5 };
    if (res.state !== 'answered' || typeof res.answer !== 'string') throw new Error('Unexpected relay response');
    return { state: 'answered', requestId, frame: concat(uuidToBytes(requestId), fromBase64(res.answer)) };
  }

  /** Tell Water Connect the asker confirmed delivery (call when the radio reports the answer frame delivered). */
  async receipt(requestId: string): Promise<void> {
    await this.post('/v1/receipt', { request_id: requestId });
  }

  private async post(path: string, payload: object) {
    const body = JSON.stringify(payload);
    const ts = String(this.now() / 1000);
    const r = await this.fetchImpl(`${this.credentials.connectUrl}${path}`, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': String(this.credentials.deviceId), 'X-Timestamp': ts,
        'X-Signature': await signRelayBody(this.credentials.deviceKey, ts, body, this.crypto) },
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.detail ?? `Water Connect error (${r.status})`);
    return json;
  }
}
