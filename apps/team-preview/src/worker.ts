export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  BACKEND_URL: string;
  ORIGIN_TOKEN: string;
  TEAM_PASSWORD: string;
  SESSION_SECRET: string;
  LOGIN_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const COOKIE = '__Host-teamwater_session';
const LIFETIME = 12 * 60 * 60;
const encoder = new TextEncoder();
const securityHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
};
const error = (status: number, message: string) => Response.json({ error: message }, { status, headers: securityHeaders });
const redirect = (location: string, cookie?: string) => new Response(null, { status: 303, headers: { ...securityHeaders, Location: location, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const sessionCookie = (value: string, maxAge = LIFETIME) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  const result = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
  if (encode(result) !== value) throw new Error('Noncanonical encoding');
  return result;
}
async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function createSession(env: Env, origin: string): Promise<string> {
  const issued = Math.floor(Date.now() / 1000);
  const payload = `v1.${issued}.${issued + LIFETIME}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env.SESSION_SECRET), encoder.encode(`${origin}\n${payload}`));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
async function authenticated(request: Request, env: Env, origin: string): Promise<number | null> {
  try {
    const matches = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(COOKIE.length + 1);
    const fields = value.split('.');
    if (fields.length !== 5 || fields[0] !== 'v1' || !/^\d+$/.test(fields[1]) || !/^\d+$/.test(fields[2]) || !/^[a-f0-9-]{36}$/.test(fields[3])) return null;
    const issued = Number(fields[1]), expires = Number(fields[2]), now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > now || expires <= now || expires - issued !== LIFETIME) return null;
    return await crypto.subtle.verify('HMAC', await signingKey(env.SESSION_SECRET), decode(fields[4]), encoder.encode(`${origin}\n${fields.slice(0, 4).join('.')}`)) ? expires : null;
  } catch { return null; }
}

function loginPage(message = '', status = 200): Response {
  // Messages are fixed server strings, never reflected passwords or request input.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CHRP · Team preview</title><style>
    :root{color-scheme:light;font-family:ui-sans-serif,system-ui,sans-serif;color:#382b24;background:#faf5ed}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px}.card{width:min(100%,400px);padding:36px;border:1px solid #e5d8c8;border-radius:26px;background:#fffaf3;box-shadow:0 16px 55px #6d493012}.mark{letter-spacing:.2em;font-size:12px;font-weight:700;color:#b76b38}h1{font-weight:550;font-size:30px;letter-spacing:-1px;margin:18px 0 10px}p{line-height:1.5;color:#806e60;font-size:14px}label{display:block;font-size:13px;margin:25px 0 9px}input,button{width:100%;min-height:48px;border-radius:12px;font:inherit}input{padding:12px;border:1px solid #d8c7b6;background:#fff}input:focus{outline:2px solid #bc784c;outline-offset:2px}button{margin-top:14px;border:0;background:#b97143;color:white;font-weight:600;cursor:pointer}.error{color:#9a3c2d}footer{font-size:11px;margin-top:26px;color:#9d8d7e}
    </style></head><body><main class="card"><div class="mark">CHRP / TEAM PREVIEW</div><h1>A little closer,<br>even off-grid.</h1><p>Open the shared phone app to send a message across the mesh.</p><form action="/login" method="post"><label for="password">Team password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256" autofocus><button type="submit">Open phone app</button></form>${message ? `<p class="error" role="alert">${message}</p>` : ''}<footer>Your session lasts up to 12 hours.</footer></main></body></html>`;
  return new Response(html, { status, headers: { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}

async function readPassword(request: Request): Promise<string | null> {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  if (Number(request.headers.get('Content-Length')) > 4096 || !request.body) return null;
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 4096) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  const passwords = form.getAll('password');
  return passwords.length === 1 && passwords[0].length <= 256 ? passwords[0] : null;
}
async function passwordMatches(candidate: string, env: Env): Promise<boolean> {
  const key = await signingKey(env.SESSION_SECRET);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(env.TEAM_PASSWORD));
  return crypto.subtle.verify('HMAC', key, expected, encoder.encode(candidate));
}
function allowedMethod(path: string): string | null {
  if (path === '/nodes' || path === '/state' || /^\/messages\/[A-Za-z0-9_-]+\/content$/.test(path) || path === '/ws') return 'GET';
  if (/^\/send\/(text|image|voice)$/.test(path)) return 'POST';
  return null;
}
const requestHeaderNames = ['accept', 'content-type', 'range', 'if-none-match', 'if-modified-since', 'upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions'];
const responseHeaderNames = ['content-type', 'content-length', 'content-encoding', 'content-disposition', 'etag', 'last-modified', 'accept-ranges', 'content-range'];
function selectHeaders(source: Headers, names: string[]) {
  const headers = new Headers(); for (const name of names) { const value = source.get(name); if (value !== null) headers.set(name, value); } return headers;
}
interface WorkerSocket extends EventTarget { accept(): void; send(data: string | ArrayBuffer): void; close(code?: number, reason?: string): void }
function bridgeSocket(upstream: WorkerSocket, expires: number): Response {
  const Pair = (globalThis as typeof globalThis & { WebSocketPair: new () => { 0: WorkerSocket; 1: WorkerSocket } }).WebSocketPair;
  const pair = new Pair(), server = pair[1]; let finished = false;
  const cleanups: (() => void)[] = [];
  const finish = (code = 1000, reason = 'Connection closed') => {
    if (finished) return; finished = true; clearTimeout(timer);
    cleanups.forEach(cleanup => cleanup());
    for (const socket of [server, upstream]) { try { socket.close(code, reason); } catch { /* The peer may already be closed. */ } }
  };
  const timer = setTimeout(() => finish(1008, 'Session expired'), Math.max(0, expires * 1000 - Date.now()));
  for (const [source, destination] of [[server, upstream], [upstream, server]]) {
    const message = (event: Event) => { if (!finished) { try { destination.send((event as MessageEvent<string | ArrayBuffer>).data); } catch { finish(1011, 'Connection failed'); } } };
    const closed = () => finish(); const failed = () => finish(1011, 'Connection failed');
    source.addEventListener('message', message); source.addEventListener('close', closed); source.addEventListener('error', failed);
    cleanups.push(() => { source.removeEventListener('message', message); source.removeEventListener('close', closed); source.removeEventListener('error', failed); });
  }
  try {
    server.accept(); upstream.accept();
    const init: ResponseInit & { webSocket: WorkerSocket } = { status: 101, webSocket: pair[0], headers: securityHeaders };
    return new Response(null, init);
  } catch (failure) { finish(1011, 'Connection failed'); throw failure; }
}
async function proxy(request: Request, env: Env, url: URL, expires: number): Promise<Response> {
  const path = url.pathname.slice(4); const method = allowedMethod(path);
  if (!method) return error(404, 'Not found');
  if (request.method !== method) return error(405, 'Method not allowed');
  const socket = path === '/ws';
  if ((method === 'POST' || socket) && request.headers.get('Origin') !== url.origin) return error(403, 'Origin not allowed');
  if (socket && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error(426, 'WebSocket upgrade required');
  if (!socket && request.headers.has('Upgrade')) return error(400, 'Unexpected upgrade');
  const target = new URL(env.BACKEND_URL); target.pathname = `${target.pathname.replace(/\/$/, '')}${path}`; target.search = url.search;
  const headers = selectHeaders(request.headers, requestHeaderNames); headers.set('X-TeamWater-Origin', env.ORIGIN_TOKEN);
  try {
    const init: RequestInit & { duplex?: 'half' } = { method, headers, redirect: 'manual', ...(method === 'POST' ? { body: request.body, duplex: 'half' } : {}) };
    const response = await fetch(new Request(target, init));
    if (response.status >= 300 && response.status < 400) return error(502, 'Backend redirect rejected');
    if (socket && response.status === 101) {
      const upgraded = response as Response & { webSocket?: WorkerSocket };
      if (!upgraded.webSocket) return error(502, 'Mesh service unavailable');
      return bridgeSocket(upgraded.webSocket, expires);
    }
    const outputHeaders = selectHeaders(response.headers, responseHeaderNames);
    for (const [key, value] of Object.entries(securityHeaders)) outputHeaders.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outputHeaders });
  } catch { return error(502, 'Mesh service unavailable'); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let backend: URL; try { backend = new URL(env.BACKEND_URL); } catch { return error(503, 'Preview unavailable'); }
    if (!env.TEAM_PASSWORD || env.SESSION_SECRET.length < 32 || !env.ORIGIN_TOKEN || backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || url.protocol !== 'https:') return error(503, 'Preview unavailable');
    if (url.pathname === '/login') {
      if (request.method === 'GET') return loginPage();
      if (request.method !== 'POST') return error(405, 'Method not allowed');
      if (request.headers.get('Origin') !== url.origin) return error(403, 'Origin not allowed');
      if (env.LOGIN_LIMITER) {
        try { if (!(await env.LOGIN_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' })).success) return loginPage('Too many attempts. Please wait a minute and try again.', 429); }
        catch { return error(503, 'Login temporarily unavailable'); }
      }
      let password: string | null;
      try { password = await readPassword(request); } catch { return error(400, 'Invalid login request'); }
      if (password === null || !await passwordMatches(password, env)) return loginPage('That password did not match. Please try again.', 401);
      return redirect('/', sessionCookie(await createSession(env, url.origin)));
    }
    if (url.pathname === '/logout') {
      if (request.method !== 'POST') return error(405, 'Method not allowed');
      if (request.headers.get('Origin') !== url.origin) return error(403, 'Origin not allowed');
      return redirect('/login', sessionCookie('', 0));
    }
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const expires = await authenticated(request, env, url.origin);
    if (expires === null) return api ? error(401, 'Authentication required') : redirect('/login');
    if (api) return proxy(request, env, url, expires);
    if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'Method not allowed');
    const assetRequest = new Request(request.url, { method: request.method, headers: selectHeaders(request.headers, ['accept', 'if-none-match', 'if-modified-since']) });
    const response = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(response.headers); for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
    headers.delete('Set-Cookie');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
