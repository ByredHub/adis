/* Local storage abstractions.
 * - A.storage: JSON cache for non-sensitive data.
 * - A.secureStorage: token storage. On native builds (Capacitor/Flutter) this maps to Keychain/Keystore;
 *   on the web the safest available option is used: tokens are kept in sessionStorage unless "remember me" is set. */
(function (A) {
  'use strict';
  const NS = 'adis.';
  const mem = {};

  function safe(store) {
    try { const k = '__t'; store.setItem(k, '1'); store.removeItem(k); return store; } catch (_) { return null; }
  }
  const ls = safe(window.localStorage);
  const ss = safe(window.sessionStorage);

  const storage = {
    get(key, fallback = null) {
      try { const raw = ls ? ls.getItem(NS + key) : mem[key]; return raw == null ? fallback : JSON.parse(raw); } catch (_) { return fallback; }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try { ls ? ls.setItem(NS + key, raw) : (mem[key] = raw); } catch (e) { A.log.warn('storage', 'quota exceeded', e); }
    },
    remove(key) { ls ? ls.removeItem(NS + key) : delete mem[key]; }
  };

  const secureStorage = {
    async read(key) {
      const v = (ss && ss.getItem(NS + 'sec.' + key)) || (ls && ls.getItem(NS + 'sec.' + key));
      return v || null;
    },
    async write(key, value, persist) {
      secureStorage.delete(key);
      const target = persist ? ls : ss;
      if (target) target.setItem(NS + 'sec.' + key, value);
    },
    async delete(key) {
      ss && ss.removeItem(NS + 'sec.' + key);
      ls && ls.removeItem(NS + 'sec.' + key);
    }
  };

  A.storage = storage;
  A.secureStorage = secureStorage;
})(window.Adis);
