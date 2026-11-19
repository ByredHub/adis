/* Tasks & reminders: active / overdue / done, create, reschedule, repeat, complete, delete. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  A.screens = A.screens || {};

  /* Create/edit sheet shared by Tasks, Home, Person, Chat */
  A.screens.taskSheet = async function taskSheet(id, preset = {}) {
    let t = null, people = [];
    try {
      people = await repo.people.list();
      if (id) { t = (await repo.tasks.list()).find(x => x.id === id); if (!t) throw new A.ApiError('not_found', 'Задача не найдена'); }
    } catch (e) { ui.toast(e.userMessage || 'Ошибка', 'error'); return; }
    const v0 = Object.assign({ title: '', notes: '', dueAt: (() => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d.toISOString(); })(), repeat: 'none', remind: true, personId: null }, t || {}, preset);
    ui.sheet({
      title: t ? 'Задача' : 'Новое напоминание',
      body: `<form novalidate>
        <div class="field"><label>Что сделать</label><input class="input" name="title" value="${U.esc(v0.title)}" placeholder="Позвонить, отправить, купить…" ${t ? '' : 'autofocus'}></div>
        <div class="field"><label>Когда</label><input class="input" type="datetime-local" name="dueAt" value="${v0.dueAt ? U.toLocalInput(v0.dueAt) : ''}">
          <div class="chips wrap mt-2">${[['Через час', 1 / 24], ['Вечером', 'eve'], ['Завтра утром', 'tm'], ['Через неделю', 7]].map(([l, k]) => `<button type="button" class="chip" data-quick="${k}">${l}</button>`).join('')}</div>
          <div class="hint">Часовой пояс: ${U.esc(A.settings.get('timezone'))}</div></div>
        <div class="field"><label>Повтор</label><select class="select" name="repeat">${[['none', 'Не повторять'], ['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Каждый месяц']].map(([v, l]) => `<option value="${v}" ${v0.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Связать с человеком</label><select class="select" name="personId"><option value="">— Нет —</option>${people.map(p => `<option value="${p.id}" ${v0.personId === p.id ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Заметки</label><textarea class="textarea" name="notes" style="min-height:70px">${U.esc(v0.notes || '')}</textarea></div>
        <div class="row between mb-4"><span class="bold small">Прислать уведомление</span>${ui.switchHtml('remind', v0.remind, 'Уведомление')}</div>
        <button class="btn btn-primary btn-block" type="submit">${t ? 'Сохранить' : 'Создать'}</button>
        ${t ? `<div class="row mt-3 gap-2"><button type="button" class="btn btn-outline grow" data-done>${t.done ? 'Вернуть в работу' : 'Выполнено'}</button><button type="button" class="btn btn-danger grow" data-delete>Удалить</button></div>` : ''}
      </form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => {
          const k = b.dataset.quick; let d = new Date();
          if (k === 'eve') { d.setHours(19, 0, 0, 0); if (d < new Date()) d = U.addDays(d, 1); }
          else if (k === 'tm') { d = U.addDays(d, 1); d.setHours(9, 0, 0, 0); }
          else d = new Date(Date.now() + parseFloat(k) * 86400000);
          f.dueAt.value = U.toLocalInput(d);
        });
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!v.title) return ui.fieldError(f, 'title', 'Введите название');
          if (v.repeat !== 'none' && !v.dueAt) return ui.fieldError(f, 'dueAt', 'Для повтора нужно время');
          const payload = { title: v.title, notes: v.notes, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : null, repeat: v.repeat, remind: v.remind, personId: v.personId || null };
          ui.guard(f.querySelector('[type=submit]'), async () => {
            if (t) await repo.tasks.update(t.id, payload); else await repo.tasks.create(Object.assign(payload, { source: { kind: 'manual' } }));
            close(); ui.toast(t ? 'Задача обновлена' : (payload.dueAt ? `Напомню ${U.fmtDateTime(payload.dueAt).toLowerCase()}` : 'Задача создана'), 'success');
          });
        };
        const done = f.querySelector('[data-done]'); if (done) done.onclick = () => ui.guard(done, async () => { await repo.tasks.complete(t.id, !t.done); close(); ui.toast(t.done ? 'Возвращено в работу' : 'Выполнено', 'success'); });
        const del = f.querySelector('[data-delete]'); if (del) del.onclick = async () => {
          if (!(await ui.confirmDanger('Удалить задачу?', `«${t.title}» будет удалена.`))) return;
          ui.guard(del, async () => { await repo.tasks.remove(t.id); close(); ui.toast('Задача удалена', 'success'); });
        };
      }
    });
  };

  A.router.register('/tasks', (el, ctx) => {
    let tab = ctx.query.tab || 'active';
    el.innerHTML = `${ui.appbar({ title: 'Задачи', large: true, demo: true, actions: `<a class="icon-btn" href="#/alarms" aria-label="Будильники">${I('clock')}</a><a class="icon-btn" href="#/calendar" aria-label="Календарь">${I('calendar')}</a><button class="icon-btn soft" data-add aria-label="Новая задача">${I('plus')}</button>` })}
      <main class="content">
        <div class="segmented" role="tablist">${[['active', 'Активные'], ['overdue', 'Просроченные'], ['done', 'Выполненные']].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}<span class="seg-count" data-count="${k}"></span></button>`).join('')}</div>
        <div class="mt-4" data-alarms></div>
        <div class="mt-4" data-list></div>
      </main>`;
    const listEl = el.querySelector('[data-list]'), alarmsEl = el.querySelector('[data-alarms]');
    let tasks = [], people = [], alarms = [];

    // Alarms set from chat or voice ("Разбуди меня в 7") are shown here too, so they are not lost in a separate screen
    function drawAlarms() {
      const on = alarms.filter(a => a.enabled).sort((a, b) => (a.nextAt || '').localeCompare(b.nextAt || ''));
      alarmsEl.innerHTML = tab === 'active' && on.length ? `<div class="row between mb-2"><div class="t-label">Будильники</div><a class="link-btn small" href="#/alarms">Все</a></div>
        <div class="list">${on.map(a => `<a class="list-item pressable" href="#/alarms" style="color:inherit" data-alarm="${a.id}">${I('clock', 'sm')}<div class="grow"><div class="bold">${U.esc(a.time)}</div><div class="li-sub">${U.esc([a.daysLabel, a.label].filter(Boolean).join(' · '))}${a.nextAt ? ' · прозвонит ' + U.esc(U.fmtDateTime(a.nextAt).toLowerCase()) : ''}</div></div>${I('chevron', 'sm')}</a>`).join('')}</div>` : '';
    }
    const loadAlarms = () => repo.alarms.list(true).then(a => { alarms = a || []; if (el.isConnected) drawAlarms(); }).catch(() => {});

    function groupLabel(t) {
      if (!t.dueAt) return 'Без срока';
      const d = U.startOfDay(t.dueAt), today = U.startOfDay(new Date());
      const diff = Math.round((d - today) / 86400000);
      if (diff < 0) return 'Ранее';
      if (diff <= 1) return U.fmtRelDay(t.dueAt);
      if (diff < 7) return 'На этой неделе';
      return 'Позже';
    }

    function draw() {
      drawAlarms();
      ['active', 'overdue', 'done'].forEach(k => { const n = tasks.filter(t => t.status === k).length; el.querySelector(`[data-count="${k}"]`).textContent = n ? ` ${n}` : ''; });
      A.state.overdue = tasks.filter(t => t.status === 'overdue').length; A.router.renderTabbar('tasks');
      let list = tasks.filter(t => t.status === tab);
      if (tab === 'done') list.sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
      else list.sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
      if (!list.length) {
        listEl.innerHTML = ui.empty(tab === 'active' ? { icon: 'tasks', title: 'Нет активных задач', text: 'Создайте задачу или скажите Adis: «Напомни в пятницу оплатить интернет».', action: '<button class="btn btn-primary" data-add2>Новая задача</button>' }
          : tab === 'overdue' ? { icon: 'check', title: 'Просроченных нет', text: 'Отличная работа — всё под контролем.' } : { icon: 'history', title: 'Пока ничего не выполнено', text: 'Отмечайте задачи — здесь появится история.' });
        const a2 = listEl.querySelector('[data-add2]'); if (a2) a2.onclick = () => A.screens.taskSheet();
        return;
      }
      if (tab === 'active') {
        const groups = [];
        list.forEach(t => { const g = groupLabel(t); let gr = groups.find(x => x.g === g); if (!gr) groups.push(gr = { g, items: [] }); gr.items.push(t); });
        listEl.innerHTML = groups.map(g => `<div class="t-label mb-2 mt-4">${g.g}</div><div class="list task-list">${g.items.map(t => ui.taskRow(t, people)).join('')}</div>`).join('');
      } else {
        listEl.innerHTML = `${tab === 'overdue' ? `<button class="btn btn-secondary btn-sm mb-3" data-move-all>${I('clock', 'sm')}Перенести все на завтра</button>` : ''}<div class="list task-list">${list.map(t => ui.taskRow(t, people)).join('')}</div>`;
        const mv = listEl.querySelector('[data-move-all]');
        if (mv) mv.onclick = () => ui.guard(mv, async () => {
          for (const t of list) { const d = U.addDays(new Date(), 1); const o = new Date(t.dueAt); d.setHours(o.getHours(), o.getMinutes(), 0, 0); await repo.tasks.update(t.id, { dueAt: d.toISOString() }); }
          ui.toast('Перенесено на завтра', 'success');
        });
      }
      ui.bindTaskRows(listEl);
    }

    const load = () => ui.load(listEl, () => Promise.all([repo.tasks.list(true), repo.people.list()]), ([t, p]) => { tasks = t; people = p; draw(); }, { offline: () => { const t = repo.tasks.offline(); return t.length ? [t, repo.people.offline()] : null; } });
    load();
    loadAlarms();
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b)); A.router.replaceSilently('#/tasks?tab=' + tab); draw(); });
    el.querySelector('[data-add]').onclick = () => A.screens.taskSheet();
    if (ctx.query.new) setTimeout(() => A.screens.taskSheet(), 250);
    ctx.onLeave(A.bus.on('data:tasks', () => el.isConnected && load()));
    ctx.onLeave(A.bus.on('data:alarms', () => el.isConnected && loadAlarms()));
  }, { tab: 'tasks' });
})(window.Adis);
