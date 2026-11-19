/* Adis core utilities. Global namespace is used so the app runs without a build step (incl. file://). */
window.Adis = window.Adis || {};
(function (A) {
  'use strict';

  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  const util = {
    MONTHS_GEN, MONTHS_NOM, WEEKDAYS_SHORT, WEEKDAYS,

    uid(prefix = 'id') {
      const r = (crypto && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(16).slice(2);
      return `${prefix}_${Date.now().toString(36)}${r.slice(0, 8)}`;
    },

    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    sleep: ms => new Promise(r => setTimeout(r, ms)),

    debounce(fn, ms = 250) {
      let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    },

    cap(s) { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; },

    clone: o => JSON.parse(JSON.stringify(o)),

    initials(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
    },

    plural(n, one, few, many) {
      const m10 = n % 10, m100 = n % 100;
      if (m10 === 1 && m100 !== 11) return one;
      if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
      return many;
    },

    /* Russian stemming for name/keyword matching across grammatical cases */
    stem(word) {
      let w = String(word || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9+#.]/g, '');
      if (/^[a-z0-9+#.]+$/.test(w)) return w;
      const before = w;
      w = w.replace(/(ами|ями|ого|его|ому|ему|ыми|ими|ом|ем|ой|ей|ою|ею|ам|ям|ах|ях|ов|ев)$/, '');
      w = w.replace(/[аеиоуыэюяйь]+$/, '');
      return w.length >= 2 ? w : before;
    },

    sameStem(a, b) {
      const sa = util.stem(a), sb = util.stem(b);
      if (!sa || !sb) return false;
      if (sa === sb) return true;
      const min = Math.min(sa.length, sb.length);
      if (min >= 4 && (sa.startsWith(sb) || sb.startsWith(sa))) return true;
      /* stems ending in a case-like suffix ("Артём" -> "арт") still match their inflected forms ("Артёмом") */
      const raw = x => String(x || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9+#]/g, '');
      const ra = raw(a), rb = raw(b);
      return Math.min(ra.length, rb.length) >= 4 && (ra.startsWith(rb) || rb.startsWith(ra));
    },

    words(text) {
      return String(text || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9+#]+/).filter(Boolean);
    },

    /* ---------- dates ---------- */
    startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
    addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
    isSameDay(a, b) { a = new Date(a); b = new Date(b); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); },
    pad: n => String(n).padStart(2, '0'),

    fmtTime(d) { d = new Date(d); return `${util.pad(d.getHours())}:${util.pad(d.getMinutes())}`; },

    fmtDate(d, withYear) {
      d = new Date(d);
      const y = (withYear || d.getFullYear() !== new Date().getFullYear()) ? ` ${d.getFullYear()}` : '';
      return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`;
    },

    fmtRelDay(d) {
      d = new Date(d);
      const today = util.startOfDay(new Date());
      const diff = Math.round((util.startOfDay(d) - today) / 86400000);
      if (diff === 0) return 'Сегодня';
      if (diff === 1) return 'Завтра';
      if (diff === 2) return 'Послезавтра';
      if (diff === -1) return 'Вчера';
      return util.fmtDate(d);
    },

    fmtDateTime(d) { return `${util.fmtRelDay(d)}, ${util.fmtTime(d)}`; },

    fmtAgo(d) {
      const s = Math.round((Date.now() - new Date(d)) / 1000);
      if (s < 60) return 'только что';
      if (s < 3600) { const m = Math.floor(s / 60); return `${m} ${util.plural(m, 'минуту', 'минуты', 'минут')} назад`; }
      if (s < 86400) { const h = Math.floor(s / 3600); return `${h} ${util.plural(h, 'час', 'часа', 'часов')} назад`; }
      return util.fmtRelDay(d);
    },

    toLocalInput(d) {
      d = new Date(d);
      return `${d.getFullYear()}-${util.pad(d.getMonth() + 1)}-${util.pad(d.getDate())}T${util.pad(d.getHours())}:${util.pad(d.getMinutes())}`;
    },
    toLocalDateInput(d) { d = new Date(d); return `${d.getFullYear()}-${util.pad(d.getMonth() + 1)}-${util.pad(d.getDate())}`; },

    /* 12500.5 -> «12 500,50 ₽»; same rules as server/adis/services/finance.py money() */
    money(amount, currency = 'RUB') {
      const signs = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸', UZS: 'сум', GBP: '£', CNY: '¥', TRY: '₺' };
      const a = Math.round(Number(amount || 0) * 100) / 100;
      const abs = Math.abs(a), whole = Math.floor(abs), frac = Math.round((abs - whole) * 100);
      let s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
      if (frac) s += ',' + String(frac).padStart(2, '0');
      const sign = signs[currency] || currency;
      return (a < 0 ? '−' : '') + (currency === 'USD' || currency === 'GBP' ? sign + s : s + '\u00a0' + sign);
    },

    fmtBytes(b) {
      if (b < 1024) return `${b} Б`;
      if (b < 1048576) return `${(b / 1024).toFixed(1)} КБ`;
      return `${(b / 1048576).toFixed(1)} МБ`;
    },

    download(filename, content, mime = 'application/json') {
      const blob = new Blob([content], { type: mime });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    },

    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* ignore */ }
        ta.remove(); return ok;
      }
    },

    async hash(text) {
      if (crypto && crypto.subtle && window.isSecureContext) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
      }
      let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
      for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
      return 'f' + ((h2 >>> 0).toString(16) + (h1 >>> 0).toString(16));
    },

    timezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } }
  };

  /* Simple event bus for cross-feature updates (single data system) */
  const listeners = {};
  const bus = {
    on(evt, fn) { (listeners[evt] = listeners[evt] || new Set()).add(fn); return () => listeners[evt].delete(fn); },
    emit(evt, payload) { (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { A.log && A.log.error('bus', e); } }); }
  };

  A.util = util;
  A.bus = bus;
})(window.Adis);
