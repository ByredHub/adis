/* Reusable UI components: app bar, toasts, bottom sheets, dialogs, loading/empty/error states, async button guard. */
(function (A) {
  'use strict';
  const U = A.util, I = A.icon;
  const overlay = () => document.getElementById('overlay-root');

  function toastHost() {
    let h = overlay().querySelector('.toasts');
    if (!h) { h = document.createElement('div'); h.className = 'toasts'; h.setAttribute('role', 'status'); h.setAttribute('aria-live', 'polite'); overlay().appendChild(h); }
    return h;
  }

  const ui = {
    appbar({ title = '', sub = '', back = false, large = false, actions = '', bordered = false, demo = false } = {}) {
      return `<header class="appbar${bordered ? ' bordered' : ''}">
        ${back ? `<button class="icon-btn" data-back aria-label="Назад">${I('back')}</button>` : (large ? '' : '<span style="width:8px"></span>')}
        <div class="title${large ? ' large' : ''}">${U.esc(title)}${demo && A.api.isDemo() ? ' <span class="demo-badge" title="Данные хранятся только на этом устройстве">Демо</span>' : ''}${sub ? `<small>${U.esc(sub)}</small>` : ''}</div>
        ${actions}
      </header>`;
    },

    toast(message, type = 'info', action = null, ms = 3200) {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      el.innerHTML = `${I(type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info', 'sm')}<span class="grow">${U.esc(message)}</span>${action ? `<button class="toast-action">${U.esc(action.label)}</button>` : ''}`;
      const host = toastHost();
      host.appendChild(el);
      while (host.children.length > 3) host.firstChild.remove();
      const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
      if (action) el.querySelector('.toast-action').onclick = () => { action.onClick(); close(); };
      setTimeout(close, ms);
      return close;
    },

    sheet({ title = '', body = '', onMount, onClose, className = '' }) {
      const root = overlay();
      const scrim = document.createElement('div'); scrim.className = 'scrim';
      const sh = document.createElement('div'); sh.className = `sheet ${className}`; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-label', title);
      sh.innerHTML = `<div class="grabber"></div>${title ? `<div class="sheet-head"><h3>${U.esc(title)}</h3><button class="icon-btn" data-close aria-label="Закрыть">${I('x')}</button></div>` : ''}<div class="sheet-body">${body}</div>`;
      root.append(scrim, sh);
      let closed = false;
      const close = (result) => {
        if (closed) return; closed = true;
        scrim.classList.add('closing'); sh.classList.add('closing');
        setTimeout(() => { scrim.remove(); sh.remove(); }, 230);
        onClose && onClose(result);
        window.removeEventListener('hashchange', onHash);
      };
      const onHash = () => close();
      window.addEventListener('hashchange', onHash);
      scrim.onclick = () => close();
      sh.querySelectorAll('[data-close]').forEach(b => b.onclick = () => close());
      let startY = null;
      sh.querySelector('.grabber').addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
      sh.querySelector('.grabber').addEventListener('touchend', e => { if (startY != null && e.changedTouches[0].clientY - startY > 60) close(); startY = null; });
      onMount && onMount(sh.querySelector('.sheet-body'), close, sh);
      const f = sh.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 250);
      return close;
    },

    dialog({ title, text = '', icon = 'info', danger = false, confirmLabel = 'OK', cancelLabel = 'Отмена', single = false }) {
      return new Promise(resolve => {
        const root = overlay();
        const wrap = document.createElement('div'); wrap.className = 'dialog-wrap';
        wrap.innerHTML = `<div class="scrim"></div><div class="dialog" role="alertdialog" aria-modal="true">
          <div class="dialog-ico${danger ? ' danger' : ''}">${I(icon)}</div>
          <h3>${U.esc(title)}</h3>${text ? `<p>${U.esc(text)}</p>` : ''}
          <div class="dialog-actions">${single ? '' : `<button class="btn btn-outline" data-no>${U.esc(cancelLabel)}</button>`}<button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-yes>${U.esc(confirmLabel)}</button></div></div>`;
        root.appendChild(wrap);
        const done = v => { wrap.remove(); resolve(v); };
        wrap.querySelector('.scrim').onclick = () => done(false);
        wrap.querySelector('[data-yes]').onclick = () => done(true);
        const no = wrap.querySelector('[data-no]'); if (no) no.onclick = () => done(false);
        setTimeout(() => wrap.querySelector('[data-yes]').focus(), 50);
      });
    },

    viewPhoto(src) {
      const wrap = document.createElement('div');
      wrap.className = 'lightbox';
      wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', 'Фото');
      wrap.innerHTML = `<img src="${U.esc(src)}" alt=""><button class="cam-ic" aria-label="Закрыть">${I('x')}</button>`;
      overlay().appendChild(wrap);
      const close = () => { wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 200); window.removeEventListener('hashchange', close); };
      wrap.onclick = close;
      window.addEventListener('hashchange', close);
    },

    confirmDanger(title, text, confirmLabel = 'Удалить') {
      return ui.dialog({ title, text, icon: 'trash', danger: true, confirmLabel });
    },

    loading(text = 'Загрузка…') { return `<div class="loader-block"><div class="spinner"></div><span>${U.esc(text)}</span></div>`; },
    skeleton(n = 4, h = 64) { return Array.from({ length: n }, () => `<div class="skeleton sk-row" style="height:${h}px"></div>`).join(''); },

    empty({ icon = 'sparkles', title, text = '', action = '' }) {
      return `<div class="empty"><div class="empty-ico">${I(icon)}</div><h3>${U.esc(title)}</h3>${text ? `<p>${U.esc(text)}</p>` : ''}${action}</div>`;
    },

    error(err, retry = true) {
      const msg = err && err.userMessage ? err.userMessage : 'Не удалось загрузить данные.';
      const offline = err && (err.code === 'network' || err.code === 'timeout');
      return `<div class="empty error"><div class="empty-ico">${I(offline ? 'wifiOff' : 'alert')}</div><h3>${offline ? 'Нет соединения' : 'Ошибка'}</h3><p>${U.esc(msg)}</p>${retry ? `<button class="btn btn-outline" data-retry>${I('refresh', 'sm')}Повторить</button>` : ''}</div>`;
    },

    /* Render async content with loading, error (+retry) and offline-cache fallback */
    async load(el, loader, render, { skeleton = ui.skeleton(), offline } = {}) {
      el.innerHTML = skeleton;
      try {
        const data = await loader();
        if (!el.isConnected) return;
        render(data);
      } catch (e) {
        if (!el.isConnected) return;
        const cachedData = offline && offline();
        if (cachedData && cachedData.length && (e.code === 'network' || e.code === 'timeout')) {
          render(cachedData);
          el.insertAdjacentHTML('afterbegin', `<div class="banner mb-3">${I('wifiOff', 'sm')}<span>Показаны сохранённые данные. Нет соединения.</span></div>`);
          return;
        }
        el.innerHTML = ui.error(e);
        const r = el.querySelector('[data-retry]'); if (r) r.onclick = () => ui.load(el, loader, render, { skeleton, offline });
      }
    },

    /* Prevent double submit + loading state + unified error toast */
    async guard(btn, fn) {
      if (btn && btn.dataset.busy) return;
      let html;
      if (btn) { btn.dataset.busy = '1'; html = btn.innerHTML; btn.classList.add('loading'); btn.setAttribute('aria-busy', 'true'); if (btn.classList.contains('btn')) btn.innerHTML = `<span class="spinner"></span>${btn.textContent.trim() ? `<span>${U.esc(btn.textContent.trim())}</span>` : ''}`; }
      try { return await fn(); } catch (e) {
        ui.toast(e && e.userMessage ? e.userMessage : (e && e.message) || 'Ошибка', 'error');
        A.log.warn('ui', e && e.code);
        return undefined;
      } finally {
        if (btn && btn.isConnected) { delete btn.dataset.busy; btn.classList.remove('loading'); btn.removeAttribute('aria-busy'); if (html !== undefined) btn.innerHTML = html; }
      }
    },

    switchHtml(name, checked, label = '') {
      return `<label class="switch" aria-label="${U.esc(label)}"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></label>`;
    },

    avatar(p, cls = '') {
      return `<div class="avatar ${cls}">${p && p.photo ? `<img src="${U.esc(p.photo)}" alt="">` : U.esc(U.initials(p && p.name))}</div>`;
    },

    memIcon(type) {
      const t = A.MEMORY_TYPES[type] || A.MEMORY_TYPES.fact;
      return `<div class="ico-tile c-${type}">${I(t.icon)}</div>`;
    },

    repeatLabel: r => ({ daily: 'Каждый день', weekly: 'Каждую неделю', monthly: 'Каждый месяц' })[r] || '',

    /* Formats a form element into a plain object */
    formData(form) {
      const o = {};
      new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
      form.querySelectorAll('input[type=checkbox]').forEach(c => { if (!c.name.endsWith('[]')) o[c.name] = c.checked; });
      return o;
    },

    fieldError(form, name, message) {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;
      input.classList.add('invalid');
      let err = input.closest('.field').querySelector('.error-text');
      if (!err) { err = document.createElement('div'); err.className = 'error-text'; input.closest('.field').appendChild(err); }
      err.textContent = message;
      input.addEventListener('input', () => { input.classList.remove('invalid'); err.remove(); }, { once: true });
      input.focus();
    }
  };

  A.ui = ui;
})(window.Adis);
