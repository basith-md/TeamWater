// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './worker';

class Socket extends EventTarget {
  accepted = false; sent: (string | ArrayBuffer)[] = []; closed: { code?: number; reason?: string }[] = [];
  accept() { this.accepted = true; }
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  close(code?: number, reason?: string) { this.closed.push({ code, reason }); this.dispatchEvent(new Event('close')); }
}
let pairs: { client: Socket; server: Socket }[];

const origin = 'https://team.example';
let env: Env;
let upstream: Request | undefined;
let asset: Request | undefined;
const req = (path: string, init: RequestInit = {}) => new Request(`${origin}${path}`, init);
async function login(password = 'test-password') {
  return worker.fetch(req('/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) }), env);
}
async function cookie() { const response = await login(); return response.headers.get('Set-Cookie')!.split(';')[0]; }
beforeEach(() => {
  pairs = [];
  upstream = undefined; asset = undefined;
  env = { BACKEND_URL: 'https://origin.example', ORIGIN_TOKEN: 'synthetic-origin-token', TEAM_PASSWORD: 'test-password', SESSION_SECRET: 'synthetic-session-secret-for-tests-32bytes', ASSETS: { async fetch(request) { asset = request; return new Response('private app bundle', { headers: { 'Content-Type': 'application/javascript' } }); } } };
  vi.stubGlobal('fetch', async (request: Request) => { upstream = request; return new Response('backend bytes', { headers: { 'Content-Type': 'audio/ogg', 'Set-Cookie': 'backend-secret=secret', 'X-TeamWater-Origin': env.ORIGIN_TOKEN } }); });
  vi.stubGlobal('WebSocketPair', class { 0: Socket; 1: Socket; constructor() { this[0] = new Socket(); this[1] = new Socket(); pairs.push({ client: this[0], server: this[1] }); } });
  const NativeResponse = globalThis.Response;
  vi.stubGlobal('Response', class extends NativeResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: Socket }) {
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      if (init?.status === 101) { Object.defineProperty(this, 'status', { value: 101 }); Object.defineProperty(this, 'webSocket', { value: init.webSocket }); }
    }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('team preview authentication', () => {
  it('protects every asset and returns JSON 401 for unauthenticated API calls', async () => {
    const page = await worker.fetch(req('/_expo/static/app.js'), env);
    expect(page.status).toBe(303); expect(page.headers.get('Location')).toBe('/login'); expect(asset).toBeUndefined();
    const api = await worker.fetch(req('/api/state'), env);
    expect(api.status).toBe(401); expect(await api.json()).toEqual({ error: 'Authentication required' }); expect(upstream).toBeUndefined();
  });
  it('serves a password form without embedding secrets or caching it', async () => {
    const page = await worker.fetch(req('/login'), env); const html = await page.text();
    expect(page.status).toBe(200); expect(html).toContain('type="password"'); expect(html).toContain('action="/login"');
    expect(html).not.toContain(env.TEAM_PASSWORD); expect(html).not.toContain(env.SESSION_SECRET); expect(html).not.toContain(env.ORIGIN_TOKEN);
    expect(page.headers.get('Cache-Control')).toBe('no-store');
  });
  it('preserves the browser form Origin on login and wrong-password retry pages', async () => {
    const page = await worker.fetch(req('/login'), env);
    const retry = await login('wrong');
    // no-referrer makes Chromium serialize a native form POST Origin as null.
    // Keep same-origin form requests intact while withholding cross-origin referrers.
    expect(page.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(retry.status).toBe(401);
    expect(retry.headers.get('Referrer-Policy')).toBe('same-origin');
  });
  it('rejects wrong passwords without a session and grants a secure signed cookie for the correct password', async () => {
    const wrong = await login('wrong'); expect(wrong.status).toBe(401); expect(wrong.headers.get('Set-Cookie')).toBeNull();
    const right = await login(); expect(right.status).toBe(303); expect(right.headers.get('Location')).toBe('/');
    const session = right.headers.get('Set-Cookie')!;
    expect(session).toMatch(/^__Host-teamwater_session=/); expect(session).toContain('HttpOnly'); expect(session).toContain('Secure'); expect(session).toContain('SameSite=Strict'); expect(session).toContain('Max-Age=43200');
    const page = await worker.fetch(req('/', { headers: { Cookie: session.split(';')[0] } }), env);
    expect(page.status).toBe(200); expect(await page.text()).toBe('private app bundle');
  });
  it('rejects a tampered, expired, duplicate or differently signed session', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00Z')); const session = await cookie();
    const tampered = session.slice(0, -1) + (session.endsWith('A') ? 'B' : 'A');
    expect((await worker.fetch(req('/api/state', { headers: { Cookie: tampered } }), env)).status).toBe(401);
    expect((await worker.fetch(req('/api/state', { headers: { Cookie: `${session}; ${session}` } }), env)).status).toBe(401);
    expect((await worker.fetch(req('/api/state', { headers: { Cookie: session } }), { ...env, SESSION_SECRET: 'different-session-secret-32bytes-long' })).status).toBe(401);
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    expect((await worker.fetch(req('/api/state', { headers: { Cookie: session } }), env)).status).toBe(401);
  });
  it('requires an exact same origin for login, logout, mutation and websocket requests', async () => {
    for (const Origin of [undefined, 'https://evil.example', `${origin}.evil.example`, 'null']) {
      const loginResponse = await worker.fetch(req('/login', { method: 'POST', headers: Origin ? { Origin } : {}, body: 'password=test-password' }), env);
      expect(loginResponse.status).toBe(403);
    }
    const session = await cookie();
    for (const path of ['/logout', '/api/send/text', '/api/ws']) {
      const response = await worker.fetch(req(path, { method: path.endsWith('/ws') ? 'GET' : 'POST', headers: { Cookie: session, Origin: 'https://evil.example', ...(path.endsWith('/ws') ? { Upgrade: 'websocket' } : {}) } }), env);
      expect(response.status).toBe(403); expect(upstream).toBeUndefined();
    }
  });
  it('clears the session on same-origin logout and rate limits password attempts when bound', async () => {
    const session = await cookie(); const out = await worker.fetch(req('/logout', { method: 'POST', headers: { Cookie: session, Origin: origin } }), env);
    expect(out.status).toBe(303); expect(out.headers.get('Set-Cookie')).toContain('Max-Age=0');
    env.LOGIN_LIMITER = { async limit() { return { success: false }; } };
    expect((await login()).status).toBe(429);
  });
  it('fails closed when required secrets are missing', async () => {
    expect((await worker.fetch(req('/'), { ...env, SESSION_SECRET: '' })).status).toBe(503);
    expect((await worker.fetch(req('/login'), { ...env, TEAM_PASSWORD: '' })).status).toBe(503);
  });
  it('bounds login input and rejects duplicate fields, other origins and insecure origins', async () => {
    for (const body of ['password=test-password&password=wrong', `password=${'x'.repeat(5000)}`]) {
      const response = await worker.fetch(req('/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body }), env);
      expect(response.status).toBe(401); expect(response.headers.has('Set-Cookie')).toBe(false);
    }
    const session = await cookie();
    expect((await worker.fetch(new Request('https://another.example/api/state', { headers: { Cookie: session } }), env)).status).toBe(401);
    expect((await worker.fetch(new Request('http://team.example/login'), env)).status).toBe(503);
  });
  it('returns a controlled error for unavailable rate limiting and interrupted login bodies', async () => {
    env.LOGIN_LIMITER = { async limit() { throw new Error('rate service unavailable'); } };
    expect((await login()).status).toBe(503);
    env.LOGIN_LIMITER = undefined;
    const body = new ReadableStream({ start(controller) { controller.error(new Error('interrupted body')); } });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body, duplex: 'half' };
    expect((await worker.fetch(req('/login', init), env)).status).toBe(400);
  });
});

describe('authenticated origin proxy', () => {
  it('streams request/response bytes, attaches only server credentials and never sends session credentials to the backend', async () => {
    const session = await cookie();
    const response = await worker.fetch(req('/api/send/voice', { method: 'POST', headers: { Origin: origin, Cookie: session, Authorization: 'Bearer malicious', 'X-TeamWater-Origin': 'forged', 'Content-Type': 'audio/wav' }, body: 'actual recording bytes' }), env);
    expect(upstream?.url).toBe('https://origin.example/send/voice'); expect(upstream?.redirect).toBe('manual');
    expect(upstream?.headers.get('X-TeamWater-Origin')).toBe(env.ORIGIN_TOKEN); expect(upstream?.headers.has('Cookie')).toBe(false); expect(upstream?.headers.has('Authorization')).toBe(false);
    expect(await upstream!.text()).toBe('actual recording bytes'); expect(await response.text()).toBe('backend bytes');
    expect(response.headers.get('Content-Type')).toBe('audio/ogg'); expect(response.headers.has('Set-Cookie')).toBe(false); expect(response.headers.has('X-TeamWater-Origin')).toBe(false); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('forwards only explicitly allowed routes and methods, keeping assets private', async () => {
    const session = await cookie();
    for (const path of ['/api/admin', '/api/send/video', '/api/simulation/reset', '/api/messages/a%2fb/content', '/api//evil.example/state']) {
      expect((await worker.fetch(req(path, { headers: { Cookie: session } }), env)).status).toBe(404); expect(upstream).toBeUndefined();
    }
    expect((await worker.fetch(req('/api/state', { method: 'POST', headers: { Cookie: session, Origin: origin } }), env)).status).toBe(405);
    await worker.fetch(req('/api/messages/message-123/content', { headers: { Cookie: session, Range: 'bytes=0-100' } }), env);
    expect(upstream?.url).toBe('https://origin.example/messages/message-123/content'); expect(upstream?.headers.get('Range')).toBe('bytes=0-100');
    await worker.fetch(req('/static/app.js', { headers: { Cookie: session } }), env); expect(asset?.headers.has('Cookie')).toBe(false);
  });
  it('rejects backend redirects and upstream failures without revealing the protected origin', async () => {
    const session = await cookie();
    vi.stubGlobal('fetch', async () => new Response(null, { status: 302, headers: { Location: 'https://other.example/collect' } }));
    const redirect = await worker.fetch(req('/api/state', { headers: { Cookie: session } }), env);
    expect(redirect.status).toBe(502); expect(redirect.headers.has('Location')).toBe(false);
    vi.stubGlobal('fetch', async () => { throw new Error(`backend unreachable ${env.BACKEND_URL} ${env.ORIGIN_TOKEN}`); });
    const fail = await worker.fetch(req('/api/state', { headers: { Cookie: session } }), env);
    expect(fail.status).toBe(502); expect(await fail.text()).not.toContain(env.ORIGIN_TOKEN);
  });
  it('bridges actual websocket messages and closes both sides when the signed session expires', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    const session = await cookie(); const backendSocket = new Socket();
    const upgraded = new Response(null, { status: 101, webSocket: backendSocket } as ResponseInit & { webSocket: Socket });
    vi.stubGlobal('fetch', async (request: Request) => { upstream = request; return upgraded; });
    const response = await worker.fetch(req('/api/ws', { headers: { Cookie: session, Origin: origin, Upgrade: 'websocket', Connection: 'Upgrade' } }), env);
    expect(response.status).toBe(101); expect(upstream?.url).toBe('https://origin.example/ws'); expect(upstream?.headers.get('Upgrade')).toBe('websocket');
    expect(pairs).toHaveLength(1); const server = pairs[0].server;
    backendSocket.dispatchEvent(new MessageEvent('message', { data: 'actual state' })); expect(server.sent).toEqual(['actual state']);
    server.dispatchEvent(new MessageEvent('message', { data: 'keepalive' })); expect(backendSocket.sent).toEqual(['keepalive']);
    vi.advanceTimersByTime(12 * 60 * 60 * 1000 - 1); expect(server.closed).toHaveLength(0);
    vi.advanceTimersByTime(1); expect(server.closed).toEqual([{ code: 1008, reason: 'Session expired' }]); expect(backendSocket.closed).toEqual([{ code: 1008, reason: 'Session expired' }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
