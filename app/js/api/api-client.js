/* ApiClient: single entry point for all network calls. Chooses Demo (mock) or Server transport,
 * manages tokens via secureStorage and prevents duplicate submissions of the same mutation. */
(function (A) {
  'use strict';
  const inflight = new Map();
  let tokens = null;
  let remember = true;

  async function loadTokens() {
    if (tokens) return tokens;
    const raw = await A.secureStorage.read('tokens');
    try { tokens = raw ? JSON.parse(raw) : null; } catch (_) { tokens = null; }
    return tokens;
  }
  async function saveTokens(t) {
    tokens = t ? { accessToken: t.accessToken, refreshToken: t.refreshToken } : null;
    if (tokens) await A.secureStorage.write('tokens', JSON.stringify(tokens), remember);
    else await A.secureStorage.delete('tokens');
  }

  function isDemo() { return A.settings.get('apiMode') !== 'server' || !A.settings.get('apiBaseUrl'); }

  let http = null, httpBase = null;
  function httpClient() {
    const base = A.settings.get('apiBaseUrl');
    if (!http || httpBase !== base) {
      httpBase = base;
      http = A.createHttpClient({ baseUrl: base, getTokens: loadTokens, onTokens: saveTokens, onUnauthorized: () => A.bus.emit('auth:expired') });
    }
    return http;
  }

  /* Demo transport with the same refresh semantics as the server */
  async function mockRequest(method, path, body) {
    const t = await loadTokens();
    try {
      return await A.mockServer.handle(method, path, body, t && t.accessToken);
    } catch (e) {
      if (e.code === 'unauthorized' && t && t.refreshToken && !path.startsWith('/auth/')) {
        try {
          await saveTokens(await A.mockServer.handle('POST', '/auth/refresh', { refreshToken: t.refreshToken }));
          return await A.mockServer.handle(method, path, body, tokens.accessToken);
        } catch (_) { A.bus.emit('auth:expired'); }
      }
      throw e;
    }
  }

  async function request(spec, { params = {}, query, body, dedupe = true, signal, raw, contentType, responseType, timeout } = {}) {
    let [method, path] = spec.split(' ');
    path = path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(params[k]));
    if (query) {
      const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      const s = q.toString(); if (s) path += '?' + s;
    }
    if (!navigator.onLine && !isDemo()) throw new A.ApiError('network', 'Offline');
    const key = method !== 'GET' && dedupe && !raw ? `${method} ${path} ${JSON.stringify(body || {})}` : null;
    if (key && inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        return isDemo() ? await mockRequest(method, path, body) : await httpClient().request(method, path, body, { signal, raw, contentType, responseType, timeout });
      } catch (e) {
        const err = e instanceof A.ApiError ? e : new A.ApiError('server', e.message || String(e));
        A.log.warn('api', `${method} ${path.split('?')[0]} → ${err.code}`);
        throw err;
      }
    })();
    if (key) { inflight.set(key, p); p.finally(() => inflight.delete(key)).catch(() => {}); }
    return p;
  }

  async function* stream(body, signal) {
    if (isDemo()) {
      const t = await loadTokens();
      yield* A.mockServer.stream(body, t && t.accessToken, signal);
    } else {
      yield* httpClient().stream('/chat/stream', body, signal);
    }
  }

  A.api = {
    request, stream, isDemo, loadTokens, saveTokens,
    setRemember(v) { remember = v; },
    hasSession: async () => !!(await loadTokens())
  };
})(window.Adis);
