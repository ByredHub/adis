/* Hash router with auth/onboarding guards, tab bar sync, back navigation and per-screen cleanup. */
(function (A) {
  'use strict';
  const routes = [];
  const stack = [];
  let current = null;

  function register(pattern, screen, opts = {}) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/?]+)'; }) + '$');
    routes.push(Object.assign({ pattern, rx, keys, screen }, opts));
  }

  function parse(hash) {
    const h = (hash || '').replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }

  function match(path) {
    for (const r of routes) { const m = path.match(r.rx); if (m) return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
    return null;
  }

  function go(hash, { replace = false } = {}) {
    if (replace) { location.replace(hash); } else if (location.hash === hash) { resolve(); } else { location.hash = hash; }
  }

  function back(fallback = '#/home') {
    if (stack.length > 1) history.back(); else go(fallback, { replace: true });
  }

  function renderTabbar(tab) {
    const bar = document.getElementById('tabbar');
    if (!tab) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const tabs = [['home', 'home', 'nav.home'], ['chats', 'chat', 'nav.chats'], ['memory', 'memory', 'nav.memory'], ['tasks', 'tasks', 'nav.tasks'], ['profile', 'user', 'nav.profile']];
    bar.innerHTML = tabs.map(([id, icon, label]) => `<a class="tab${id === tab ? ' active' : ''}" href="#/${id}" aria-label="${A.t(label)}"${id === tab ? ' aria-current="page"' : ''}><span class="tab-ico">${A.icon(icon)}</span><span>${A.t(label)}</span>${id === 'tasks' && A.state.overdue ? `<span class="badge">${A.state.overdue}</span>` : ''}</a>`).join('');
  }

  async function resolve() {
    const { path, query } = parse(location.hash);
    const hit = match(path);
    if (!hit) { go(A.repo.auth.user ? '#/home' : '#/welcome', { replace: true }); return; }
    const { r, params } = hit;
    const user = A.repo.auth.user;
    if (!r.public && !user) { go('#/welcome', { replace: true }); return; }
    if (r.guestOnly && user) { go(A.settings.get('onboarded') ? '#/home' : '#/onboarding', { replace: true }); return; }
    if (!r.public && user && !A.settings.get('onboarded') && !r.onboarding) { go('#/onboarding', { replace: true }); return; }

    const hash = location.hash || '#/';
    const isBack = stack.length > 1 && stack[stack.length - 2] === hash;
    if (isBack) stack.pop(); else if (stack[stack.length - 1] !== hash) stack.push(hash);
    if (stack.length > 50) stack.shift();

    if (current && current.cleanup) current.cleanup.forEach(fn => { try { fn(); } catch (e) { A.log.warn('router', e); } });
    const app = document.getElementById('app');
    const el = document.createElement('div');
    el.className = 'screen' + (isBack ? ' back-anim' : '') + (r.tab ? ' with-tabbar' : '') + (r.fade ? ' fade' : '');
    const ctx = { params, query, el, cleanup: [], onLeave(fn) { this.cleanup.push(fn); }, refresh: () => resolve() };
    current = ctx;
    app.innerHTML = '';
    app.appendChild(el);
    renderTabbar(r.tab);
    el.addEventListener('click', e => { if (e.target.closest('[data-back]')) { e.preventDefault(); back(r.backTo); } });
    try { await r.screen(el, ctx); } catch (e) {
      A.log.error('screen', e);
      el.innerHTML = A.ui.appbar({ back: true, title: 'Ошибка' }) + `<main class="content">${A.ui.error(e, false)}</main>`;
    }
    const focusTarget = el.querySelector('.appbar .title');
    if (focusTarget) { focusTarget.setAttribute('tabindex', '-1'); }
  }

  function replaceSilently(hash) {
    history.replaceState(history.state, '', hash);
    if (stack.length) stack[stack.length - 1] = hash;
  }

  A.router = { register, go, back, resolve, renderTabbar, replaceSilently, current: () => current, start() { window.addEventListener('hashchange', resolve); resolve(); } };
})(window.Adis);
