/* Production HTTP client for the Adis AI Backend (FastAPI).
 * Timeouts, retry for idempotent requests on weak networks, token refresh, SSE streaming. No secrets in the client. */
(function (A) {
  'use strict';
  const TIMEOUT = 20000;

  function createHttpClient({ baseUrl, getTokens, onTokens, onUnauthorized }) {
    let refreshing = null;

    /* raw: send body as-is (Blob/ArrayBuffer) with contentType, e.g. recorded audio */
    async function rawFetch(method, path, body, { signal, timeout = TIMEOUT, auth = true, raw = false, contentType } = {}) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort('timeout'), timeout);
      if (signal) signal.addEventListener('abort', () => ctrl.abort('aborted'), { once: true });
      const headers = { 'Content-Type': raw ? (contentType || 'application/octet-stream') : 'application/json', Accept: 'application/json', 'X-Client': 'adis-pwa/0.1', 'X-Timezone': A.settings.get('timezone') };
      const tokens = await getTokens();
      if (auth && tokens && tokens.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
      try {
        return await fetch(baseUrl.replace(/\/$/, '') + path, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      } catch (e) {
        if (ctrl.signal.aborted) throw new A.ApiError(ctrl.signal.reason === 'aborted' ? 'aborted' : 'timeout', 'Request aborted');
        throw new A.ApiError('network', e.message);
      } finally { clearTimeout(timer); }
    }

    async function toError(res, path = '') {
      let payload = {};
      try { payload = await res.json(); } catch (_) { /* empty body */ }
      const msg = payload.detail || payload.message || res.statusText;
      /* 401 on /auth/* means wrong credentials, not an expired session */
      const code = res.status === 401 ? (path.startsWith('/auth/') ? 'validation' : 'unauthorized') : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : res.status === 422 || res.status === 400 ? 'validation' : res.status === 429 ? 'rate_limited' : res.status === 502 ? 'ai_unavailable' : 'server';
      return new A.ApiError(code, typeof msg === 'string' ? msg : 'Ошибка запроса', res.status, payload);
    }

    async function refresh() {
      if (!refreshing) {
        refreshing = (async () => {
          const tokens = await getTokens();
          if (!tokens || !tokens.refreshToken) throw new A.ApiError('unauthorized', 'No refresh token', 401);
          const res = await rawFetch('POST', '/auth/refresh', { refreshToken: tokens.refreshToken }, { auth: false });
          if (!res.ok) throw await toError(res);
          await onTokens(await res.json());
        })().finally(() => { refreshing = null; });
      }
      return refreshing;
    }

    async function request(method, path, body, opts = {}) {
      const idempotent = method === 'GET';
      let attempt = 0;
      for (;;) {
        try {
          let res = await rawFetch(method, path, body, opts);
          if (res.status === 401 && opts.auth !== false && !path.startsWith('/auth/')) {
            try { await refresh(); } catch (e) { onUnauthorized(); throw new A.ApiError('unauthorized', 'Session expired', 401); }
            res = await rawFetch(method, path, body, opts);
          }
          if (!res.ok) throw await toError(res, path);
          if (res.status === 204) return null;
          return opts.responseType === 'blob' ? await res.blob() : await res.json();
        } catch (e) {
          if (idempotent && (e.code === 'network' || e.code === 'timeout') && attempt < 2) { attempt++; await A.util.sleep(600 * attempt); continue; }
          throw e;
        }
      }
    }

    /* SSE: lines "data: {json}" with events start | status | delta | done | error */
    async function* stream(path, body, signal) {
      const res = await rawFetch('POST', path, body, { signal, timeout: 120000 });
      if (!res.ok) throw await toError(res);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
          if (!data || data === '[DONE]') continue;
          const evt = JSON.parse(data);
          if (evt.type === 'error') throw new A.ApiError('server', evt.message || 'Stream error');
          yield evt;
        }
      }
    }

    return { request, stream };
  }

  A.createHttpClient = createHttpClient;
})(window.Adis);
