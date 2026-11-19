/* Unified logger. Redacts personal data (emails, phones, tokens, long digit sequences) before output. */
(function (A) {
  'use strict';
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  const buffer = [];
  let minLevel = LEVELS.info;

  function redact(v) {
    let s = typeof v === 'string' ? v : (v instanceof Error ? `${v.name}: ${v.message}` : (() => { try { return JSON.stringify(v); } catch (_) { return String(v); } })());
    return s
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
      .replace(/(Bearer\s+)[\w.-]+/gi, '$1[token]')
      .replace(/"(password|token|accessToken|refreshToken|passHash)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
      .replace(/\+?\d[\d\s()-]{8,}\d/g, '[number]');
  }

  function write(level, scope, args) {
    if (LEVELS[level] < minLevel) return;
    const line = { t: new Date().toISOString(), level, scope, msg: args.map(redact).join(' ') };
    buffer.push(line); if (buffer.length > 300) buffer.shift();
    (console[level] || console.log)(`[Adis:${scope}]`, line.msg);
  }

  A.log = {
    debug: (scope, ...a) => write('debug', scope, a),
    info: (scope, ...a) => write('info', scope, a),
    warn: (scope, ...a) => write('warn', scope, a),
    error: (scope, ...a) => write('error', scope, a),
    setLevel(l) { minLevel = LEVELS[l] || LEVELS.info; },
    entries: () => buffer.slice()
  };

  window.addEventListener('error', e => A.log.error('window', e.message || 'error'));
  window.addEventListener('unhandledrejection', e => A.log.error('promise', (e.reason && e.reason.message) || String(e.reason)));
})(window.Adis);
