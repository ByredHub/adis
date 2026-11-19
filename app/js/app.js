/* App bootstrap: theme, splash, session restore, router start, offline indicator, service worker, notifications. */
(function (A) {
  'use strict';
  A.state = { overdue: 0 };

  function splash() {
    document.getElementById('app').innerHTML = `<div class="screen fade splash"><div class="splash-inner"><div class="orb xl pulse"></div><div class="splash-name">Adis</div><div class="splash-sub">персональный ИИ-помощник</div></div><div class="splash-foot"><div class="spinner"></div></div></div>`;
  }

  function offlineBar() {
    const bar = document.getElementById('offline');
    const upd = () => bar.classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', () => { upd(); A.ui.toast('Соединение восстановлено', 'success'); });
    window.addEventListener('offline', upd);
    upd();
  }

  async function refreshBadge() {
    if (!A.repo.auth.user) return;
    try {
      const tasks = await A.repo.tasks.list();
      const n = tasks.filter(t => t.status === 'overdue').length;
      if (n !== A.state.overdue) {
        A.state.overdue = n;
        const cur = document.querySelector('.tab.active');
        const tab = cur && cur.getAttribute('href').replace('#/', '');
        if (tab) A.router.renderTabbar(tab);
      }
    } catch (_) { /* ignore */ }
  }

  /* Opened from an Adis server (e.g. http://host:8000/): connect to its API automatically instead of the local demo */
  async function autoConnect() {
    const S = A.settings.get();
    if (S.apiModeChosen || !/^https?:$/.test(location.protocol)) return;
    const base = location.origin + '/v1';
    if (S.apiMode === 'server' && S.apiBaseUrl === base) return;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(base + '/health', { signal: ctrl.signal, cache: 'no-store' }); clearTimeout(t);
      const info = res.ok ? await res.json() : null;
      if (!info || info.status !== 'ok') return;
      await A.api.saveTokens(null);  // demo session tokens are meaningless on the server
      A.settings.set({ apiMode: 'server', apiBaseUrl: base });
      A.log.info('boot', 'connected to AI Backend', info.engine);
    } catch (_) { /* not an Adis server or offline: keep current mode */ }
  }

  async function boot() {
    A.settings.apply();
    splash();
    offlineBar();
    const minSplash = A.util.sleep(900);
    await autoConnect();
    try { await A.repo.auth.restore(); } catch (e) { A.log.warn('boot', e.code); }
    await minSplash;

    A.bus.on('auth:expired', async () => {
      await A.repo.auth.clearLocal();
      A.ui.toast('Сессия истекла. Войдите снова.', 'error');
      A.router.go('#/login', { replace: true });
    });
    A.bus.on('auth:changed', u => { if (u) { A.notifications.start(); A.alarmClock.start(); A.push.resume(); refreshBadge(); } else { A.notifications.stop(); A.alarmClock.stop(); } });
    A.bus.on('data:tasks', refreshBadge);
    A.bus.on('settings:changed', p => { if ('language' in p) A.router.resolve(); });

    if (!location.hash || location.hash === '#/' || location.hash === '#') {
      location.replace(A.repo.auth.user ? (A.settings.get('onboarded') ? '#/home' : '#/onboarding') : '#/welcome');
    }
    A.router.start();
    if (A.repo.auth.user) { A.notifications.start(); A.alarmClock.start(); refreshBadge(); }

    const urlEl = document.querySelector('[data-stage-url]');
    if (urlEl) urlEl.textContent = location.href.split('#')[0];

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(e => A.log.warn('sw', e.message));
      navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.route) location.hash = e.data.route; });
    }
  }

  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; A.bus.emit('install:available'); });
  A.install = {
    available: () => !!deferredInstall,
    async prompt() { if (!deferredInstall) return false; deferredInstall.prompt(); const r = await deferredInstall.userChoice; deferredInstall = null; return r.outcome === 'accepted'; },
    isStandalone: () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.Adis);
