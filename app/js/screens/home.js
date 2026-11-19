/* Home: greeting, compact suggestions, composer (text + voice), quick actions, nearest tasks and reminders. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;

  function greeting() {
    const h = new Date().getHours();
    return A.t(h < 5 ? 'greet.night' : h < 12 ? 'greet.morning' : h < 18 ? 'greet.day' : 'greet.evening');
  }

  A.ui.taskRow = function taskRow(t, people = []) {
    const p = t.personId && people.find(x => x.id === t.personId);
    const st = t.status || A.dto.task(t).status;
    return `<div class="task-row${t.done ? ' done' : ''}" data-task="${t.id}">
      <button class="check${t.done ? ' on' : ''}" data-check="${t.id}" aria-label="${t.done ? 'Вернуть в работу' : 'Отметить выполненной'}">${I('check', 'sm')}</button>
      <button class="grow task-main" data-open-task="${t.id}">
        <div class="li-title">${U.esc(t.title)}</div>
        <div class="task-meta">${t.dueAt ? `<span class="${st === 'overdue' ? 'danger-text' : ''}">${I('clock', 'sm')}${U.fmtDateTime(t.dueAt)}</span>` : '<span>Без срока</span>'}
          ${t.repeat && t.repeat !== 'none' ? `<span>${I('repeat', 'sm')}${ui.repeatLabel(t.repeat)}</span>` : ''}
          ${p ? `<span>${I('user', 'sm')}${U.esc(p.name.split(' ')[0])}</span>` : ''}</div>
      </button></div>`;
  };

  A.ui.bindTaskRows = function (root, onChange) {
    root.querySelectorAll('[data-check]').forEach(b => b.onclick = () => ui.guard(b, async () => {
      const done = !b.classList.contains('on');
      b.classList.toggle('on', done); b.closest('.task-row').classList.toggle('done', done);
      const t = await repo.tasks.complete(b.dataset.check, done);
      ui.toast(done ? 'Задача выполнена' : 'Задача возвращена в работу', 'success', done ? { label: 'Отменить', onClick: () => repo.tasks.complete(t.id, false) } : null);
      onChange && onChange();
    }));
    root.querySelectorAll('[data-open-task]').forEach(b => b.onclick = () => A.screens.taskSheet(b.dataset.openTask));
  };

  A.ui.suggestionCard = function (s, compact) {
    return `<div class="sugg card${compact ? ' compact' : ''}" data-sugg="${s.id}">
      <div class="row" style="align-items:flex-start"><div class="ico-tile">${I(s.icon || 'sparkles')}</div>
      <div class="grow"><div class="bold">${U.esc(s.title)}</div><div class="small muted mt-1">${U.esc(s.text)}</div></div></div>
      <div class="row mt-3 gap-2 wrap"><button class="btn btn-secondary btn-sm" data-accept>${U.esc(s.actionLabel || 'Принять')}</button>
      <button class="btn btn-ghost btn-sm" data-snooze>Позже</button><button class="btn btn-ghost btn-sm" data-dismiss>Не нужно</button></div></div>`;
  };

  A.ui.bindSuggestions = function (root, list, reload) {
    root.querySelectorAll('[data-sugg]').forEach(card => {
      const s = list.find(x => x.id === card.dataset.sugg);
      const fade = () => { card.style.transition = 'all .25s'; card.style.opacity = '0'; card.style.transform = 'scale(.97)'; setTimeout(() => { card.remove(); reload && reload(); }, 240); };
      card.querySelector('[data-accept]').onclick = e => ui.guard(e.currentTarget, async () => {
        const r = await repo.proactive.accept(s.id);
        const a = r.action || s.action;
        if (a.type === 'open') { A.router.go(a.route); return; }
        if (a.type === 'chat') { A.router.go('#/chat/new?q=' + encodeURIComponent(a.prompt)); return; }
        ui.toast(a.type === 'reschedule_task' ? 'Задача перенесена на завтра' : 'Напоминание создано', 'success');
        fade();
      });
      card.querySelector('[data-snooze]').onclick = e => ui.guard(e.currentTarget, async () => { await repo.proactive.snooze(s.id, 24); ui.toast('Напомню завтра', 'info'); fade(); });
      card.querySelector('[data-dismiss]').onclick = e => ui.guard(e.currentTarget, async () => { await repo.proactive.dismiss(s.id); ui.toast('Больше не покажу', 'info'); fade(); });
    });
  };

  /* ---------- Home: a calm, personal conversation entry point ---------- */

  function subline(h) {
    if (h < 5) return 'Не спится? Я рядом.';
    if (h < 12) return 'Как начинается твой день?';
    if (h < 18) return 'Чем могу помочь?';
    return 'Как прошёл день?';
  }

  /* Up to two hints that fit the user's situation right now. "fill" puts a starter into the input instead of sending. */
  function pickHints({ tasks, people, memories, events }, h) {
    const today = new Date();
    const hasToday = tasks.some(t => t.status === 'overdue' || (t.status === 'active' && t.dueAt && U.isSameDay(t.dueAt, today))) || events.some(e => U.isSameDay(e.startAt, today) && new Date(e.startAt) > Date.now());
    const isNew = !tasks.length && !people.length && !memories.length;
    const list = [];
    if (isNew) list.push({ label: 'Что ты умеешь?', send: 'Что ты умеешь?' });
    if (hasToday) list.push({ label: h < 12 ? 'Что у меня сегодня?' : 'Что ещё на сегодня?', send: 'Что у меня на сегодня?' });
    if (h >= 18 && !isNew) list.push({ label: 'Что у меня завтра?', send: 'Что у меня на завтра?' });
    list.push({ label: 'Напомнить о чём-то', fill: 'Напомни завтра в 10 ' });
    list.push({ label: 'Запомнить знакомство', fill: 'Сегодня познакомился с ' });
    return list.slice(0, 2);
  }

  /* One genuinely relevant item: overdue → coming up soon → a personal suggestion → nothing. */
  function pickNote({ tasks, events, suggestions }) {
    const now = Date.now();
    const overdue = tasks.filter(t => t.status === 'overdue').sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0];
    if (overdue) return { kind: 'overdue', tone: 'warn', label: U.isSameDay(overdue.dueAt, new Date()) ? `Не забудь · было в ${U.fmtTime(overdue.dueAt)}` : `Не забудь · ${U.fmtRelDay(overdue.dueAt).toLowerCase()}`, text: overdue.title, task: overdue };
    const soonTask = tasks.filter(t => t.status === 'active' && t.dueAt && new Date(t.dueAt) - now < 12 * 3600000 && U.isSameDay(t.dueAt, new Date())).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
    const soonEvent = events.filter(e => new Date(e.startAt) > now && new Date(e.startAt) - now < 12 * 3600000 && U.isSameDay(e.startAt, new Date())).sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    if (soonEvent && (!soonTask || soonEvent.startAt < soonTask.dueAt)) return { kind: 'event', tone: 'soon', label: `Сегодня в ${U.fmtTime(soonEvent.startAt)}${soonEvent.location ? ' · ' + soonEvent.location : ''}`, text: soonEvent.title, event: soonEvent };
    if (soonTask) return { kind: 'task', tone: 'soon', label: `Сегодня в ${U.fmtTime(soonTask.dueAt)}`, text: soonTask.title, task: soonTask };
    const s = suggestions.find(x => ['person', 'plan', 'network'].includes(x.kind));
    if (s) return { kind: 'suggestion', tone: 'idea', label: 'Adis подсказывает', text: s.title, suggestion: s };
    return null;
  }

  A.router.register('/home', (el, ctx) => {
    const user = repo.auth.user || {};
    const first = (user.name || '').split(' ')[0];
    const assistant = user.assistantName || 'Adis';
    const h = new Date().getHours();
    el.classList.add('home-screen');
    el.innerHTML = `
      <div class="home-glow" aria-hidden="true"></div>
      <header class="home-top">
        <div class="home-brand"><span class="orb sm"></span><span>${U.esc(assistant)}</span>${A.api.isDemo() ? '<span class="home-demo" title="Демо-режим: данные хранятся только на этом устройстве">демо</span>' : ''}</div>
        <a class="icon-btn" href="#/tools" aria-label="Инструменты и разделы">${I('grid')}</a>
      </header>
      <main class="content home-main">
        <section class="home-hero">
          <div class="home-orb rise"><span class="orb"></span></div>
          <h1 class="home-greet rise" style="--d:80ms">${greeting()}${first ? ',<br>' + U.esc(first) : ''}</h1>
          <p class="home-sub rise" style="--d:160ms" data-sub>${subline(h)}</p>
        </section>

        <form class="talk rise" style="--d:240ms" data-composer novalidate>
          <textarea name="q" rows="2" placeholder="Напиши или скажи, что нужно…" aria-label="Сообщение для ${U.esc(assistant)}"></textarea>
          <div class="talk-bar">
            <span class="talk-hint" data-hint>Текст, голос или фото</span>
            <button type="button" class="talk-cam" data-camera aria-label="Сфотографировать и спросить Adis">${I('camera')}</button>
            <a class="talk-btn talk-mic" href="#/voice" aria-label="Говорить голосом">${I('mic')}</a>
            <button class="talk-btn talk-send" type="submit" aria-label="Отправить" hidden>${I('send')}</button>
          </div>
        </form>

        <div class="home-hints" data-hints></div>
        <div class="home-note" data-note></div>
      </main>`;

    const form = el.querySelector('[data-composer]');
    const ta = form.q, send = form.querySelector('.talk-send'), mic = form.querySelector('.talk-mic'), hint = form.querySelector('[data-hint]');
    const sync = () => {
      ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
      const has = !!ta.value.trim();
      send.hidden = !has; mic.hidden = has;
      hint.textContent = has ? 'Enter — отправить' : 'Текст, голос или фото';
    };
    ta.addEventListener('input', sync);
    mic.onclick = e => { if (e.isTrusted) { A.voice.unlockAudio(); A.state.voiceAutoStart = true; } };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); } });
    form.onsubmit = e => { e.preventDefault(); const q = ta.value.trim(); if (q) A.router.go('#/chat/new?q=' + encodeURIComponent(q)); };
    form.querySelector('[data-camera]').onclick = () => A.camera.capture({ title: 'Покажи Adis' }).then(shot => {
      if (!shot || !el.isConnected) return;
      A.state.pendingPhoto = shot;
      const q = ta.value.trim();
      A.router.go('#/chat/new?send=1' + (q ? '&q=' + encodeURIComponent(q) : ''));
    });

    const hintsEl = el.querySelector('[data-hints]'), noteEl = el.querySelector('[data-note]'), subEl = el.querySelector('[data-sub]');

    function drawHints(list) {
      hintsEl.innerHTML = list.map((x, i) => `<button type="button" class="hint rise" style="--d:${i * 70}ms" data-i="${i}">${U.esc(x.label)}</button>`).join('');
      hintsEl.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const x = list[+b.dataset.i];
        if (x.send) { A.router.go('#/chat/new?q=' + encodeURIComponent(x.send)); return; }
        ta.value = x.fill; sync(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    }

    function drawNote(n) {
      if (!n) { noteEl.innerHTML = ''; return; }
      const actions = n.kind === 'overdue'
        ? '<button class="note-btn main" data-act="done">Готово</button><button class="note-btn" data-act="tomorrow">Завтра</button>'
        : n.kind === 'task' ? '<button class="note-btn main" data-act="done">Готово</button>'
          : n.kind === 'suggestion' ? `<button class="note-btn main" data-act="accept">${U.esc(n.suggestion.actionLabel || 'Да')}</button><button class="note-x" data-act="dismiss" aria-label="Скрыть">${I('x', 'sm')}</button>`
            : `<a class="note-x" href="#/calendar?date=${U.toLocalDateInput(n.event.startAt)}" aria-label="Открыть календарь">${I('chevron', 'sm')}</a>`;
      noteEl.innerHTML = `<div class="note rise" style="--d:160ms" role="status"><span class="note-dot ${n.tone}"></span>
        <div class="note-body"><div class="note-label">${U.esc(n.label)}</div><div class="note-text">${U.esc(n.text)}</div></div>
        <div class="note-actions">${actions}</div></div>`;
      const card = noteEl.querySelector('.note');
      const leave = () => { card.classList.add('leaving'); };
      noteEl.querySelectorAll('[data-act]').forEach(b => b.onclick = () => ui.guard(b, async () => {
        const a = b.dataset.act;
        if (a === 'done') { await repo.tasks.complete(n.task.id, true); leave(); ui.toast('Отлично, отметил', 'success', { label: 'Отменить', onClick: () => repo.tasks.complete(n.task.id, false) }); }
        else if (a === 'tomorrow') {
          const d = U.addDays(new Date(), 1); const o = new Date(n.task.dueAt); d.setHours(o.getHours(), o.getMinutes(), 0, 0);
          await repo.tasks.update(n.task.id, { dueAt: d.toISOString() }); leave(); ui.toast(`Перенёс на завтра, ${U.fmtTime(d)}`, 'success');
        } else if (a === 'dismiss') { await repo.proactive.dismiss(n.suggestion.id); leave(); setTimeout(load, 300); }
        else if (a === 'accept') {
          const r = await repo.proactive.accept(n.suggestion.id);
          const act = r.action || n.suggestion.action;
          if (act.type === 'open') A.router.go(act.route);
          else if (act.type === 'chat') A.router.go('#/chat/new?q=' + encodeURIComponent(act.prompt));
          else { leave(); ui.toast('Готово, напомню', 'success'); setTimeout(load, 300); }
        }
      }));
    }

    async function load() {
      const safe = p => p.catch(() => []);
      const [tasks, people, memories, events, suggestions] = await Promise.all([safe(repo.tasks.list()), safe(repo.people.list()), safe(repo.memory.list()), safe(repo.events.list()), safe(repo.proactive.list())]);
      if (!el.isConnected) return;
      const data = { tasks, people, memories, events, suggestions };
      A.state.overdue = tasks.filter(t => t.status === 'overdue').length; A.router.renderTabbar('home');
      const todayCount = tasks.filter(t => t.status === 'overdue' || (t.status === 'active' && t.dueAt && U.isSameDay(t.dueAt, new Date()))).length;
      const sub = !tasks.length && !people.length && !memories.length ? `Я ${assistant}. Расскажи что-нибудь — я запомню важное.`
        : todayCount ? `Сегодня у тебя ${todayCount} ${U.plural(todayCount, 'дело', 'дела', 'дел')}. Я напомню вовремя.` : subline(h);
      if (subEl.textContent !== sub) { subEl.classList.add('swap'); setTimeout(() => { subEl.textContent = sub; subEl.classList.remove('swap'); }, 180); }
      if (!hintsEl.children.length) drawHints(pickHints(data, h));
      drawNote(pickNote(data));
    }
    load();

    ctx.onLeave(A.bus.on('data:tasks', () => { if (el.isConnected) setTimeout(load, 250); }));
  }, { tab: 'home' });
})(window.Adis);
