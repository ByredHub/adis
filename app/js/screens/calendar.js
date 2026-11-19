/* Calendar: month / week views, day agenda (events + tasks), create & edit events with reminders. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;

  function eventSheet(ev, defaultDate, onSaved) {
    const start = ev ? new Date(ev.startAt) : (() => { const d = new Date(defaultDate || new Date()); d.setHours(Math.max(9, new Date().getHours() + 1), 0, 0, 0); return d; })();
    const end = ev ? new Date(ev.endAt) : new Date(start.getTime() + 3600000);
    ui.sheet({
      title: ev ? 'Событие' : 'Новое событие',
      body: `<form novalidate>
        <div class="field"><label>Название</label><input class="input" name="title" value="${U.esc(ev ? ev.title : '')}" ${ev ? '' : 'autofocus'}></div>
        <div class="row gap-2"><div class="field grow"><label>Начало</label><input class="input" type="datetime-local" name="startAt" value="${U.toLocalInput(start)}"></div></div>
        <div class="field"><label>Окончание</label><input class="input" type="datetime-local" name="endAt" value="${U.toLocalInput(end)}"></div>
        <div class="field"><label>Место</label><input class="input" name="location" value="${U.esc(ev ? ev.location : '')}"></div>
        <div class="field"><label>Напомнить</label><select class="select" name="remindMinutes">${[[0, 'Не напоминать'], [10, 'За 10 минут'], [30, 'За 30 минут'], [60, 'За час'], [1440, 'За день']].map(([v, l]) => `<option value="${v}" ${(ev ? ev.remindMinutes : 30) == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Заметки</label><textarea class="textarea" name="notes" style="min-height:70px">${U.esc(ev ? ev.notes : '')}</textarea></div>
        <button class="btn btn-primary btn-block" type="submit">${ev ? 'Сохранить' : 'Создать событие'}</button>
        ${ev ? '<button type="button" class="btn btn-danger btn-block mt-3" data-delete>Удалить событие</button>' : ''}
      </form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!v.title) return ui.fieldError(f, 'title', 'Введите название');
          if (!v.startAt) return ui.fieldError(f, 'startAt', 'Укажите время');
          if (v.endAt && new Date(v.endAt) < new Date(v.startAt)) return ui.fieldError(f, 'endAt', 'Окончание раньше начала');
          const payload = { title: v.title, startAt: new Date(v.startAt).toISOString(), endAt: v.endAt ? new Date(v.endAt).toISOString() : null, location: v.location, notes: v.notes, remindMinutes: +v.remindMinutes };
          ui.guard(f.querySelector('[type=submit]'), async () => {
            if (ev) await repo.events.update(ev.id, payload); else await repo.events.create(payload);
            close(); ui.toast(ev ? 'Событие обновлено' : 'Событие создано', 'success'); onSaved && onSaved();
          });
        };
        const del = f.querySelector('[data-delete]');
        if (del) del.onclick = async () => {
          if (!(await ui.confirmDanger('Удалить событие?', `«${ev.title}» будет удалено из календаря.`))) return;
          ui.guard(del, async () => { await repo.events.remove(ev.id); close(); ui.toast('Событие удалено', 'success'); onSaved && onSaved(); });
        };
      }
    });
  }

  /* Phone calendar sync: read-only iCal subscription (iPhone Calendar, Google Calendar) + .ics import */
  function syncSheet(onImported) {
    ui.sheet({
      title: 'Синхронизация с телефоном',
      body: `<div data-feed>${ui.loading()}</div>
        <div class="section"><div class="t-label mb-2">Импорт из другого календаря</div>
          <p class="small muted">Выгрузите календарь в файл .ics (Google Календарь: Настройки → Импорт и экспорт; iPhone: через iCloud.com) и выберите его здесь.</p>
          <label class="btn btn-outline btn-block">${I('upload', 'sm')}Выбрать файл .ics<input type="file" accept=".ics,text/calendar" data-ics hidden></label>
          <div data-import-res></div></div>`,
      onMount(body) {
        const feedEl = body.querySelector('[data-feed]');
        const render = info => {
          if (A.api.isDemo()) {
            feedEl.innerHTML = `<div class="banner info">${I('info', 'sm')}<span>Подписка для календаря телефона работает при подключении к AI Backend (Профиль → Подключение).</span></div>`;
            return;
          }
          if (!info.enabled) {
            feedEl.innerHTML = `<p class="small muted">Включите подписку — события и задачи Adis появятся в «Календаре» iPhone или в Google Календаре и будут обновляться сами, с напоминаниями телефона.</p>
              <button class="btn btn-primary btn-block" data-enable>${I('link', 'sm')}Включить подписку</button>`;
            feedEl.querySelector('[data-enable]').onclick = e => ui.guard(e.currentTarget, async () => render(await repo.calendar.enableFeed()));
            return;
          }
          feedEl.innerHTML = `${info.public ? '' : `<div class="banner danger mb-3">${I('alert', 'sm')}<span>Ссылка ведёт на этот компьютер. Календарь телефона сможет её загрузить, только когда сервер будет доступен из интернета по HTTPS.</span></div>`}
            <div class="field"><label>Ссылка подписки</label><input class="input" readonly value="${U.esc(info.url)}" data-url></div>
            <a class="btn btn-primary btn-block" href="${U.esc(info.webcal)}">${I('calendar', 'sm')}Добавить в Календарь iPhone</a>
            <button class="btn btn-outline btn-block mt-3" data-copy>${I('copy', 'sm')}Скопировать ссылку</button>
            <p class="tiny muted mt-2">Google Календарь: на компьютере «Другие календари» → «+» → «Добавить по URL» и вставьте ссылку. Ссылка секретная — не публикуйте её.</p>
            <div class="row gap-2 mt-3"><button class="btn btn-ghost btn-sm" data-rotate>Сменить ссылку</button><button class="btn btn-ghost btn-sm" data-disable>Отключить</button></div>`;
          feedEl.querySelector('[data-copy]').onclick = async () => ui.toast((await U.copy(info.url)) ? 'Ссылка скопирована' : 'Не удалось скопировать', 'success');
          feedEl.querySelector('[data-rotate]').onclick = async e => {
            if (!(await ui.confirmDanger('Сменить ссылку?', 'Старая ссылка перестанет работать — подписку на телефоне нужно будет добавить заново.', 'Сменить'))) return;
            ui.guard(e.target, async () => render(await repo.calendar.enableFeed()));
          };
          feedEl.querySelector('[data-disable]').onclick = e => ui.guard(e.currentTarget, async () => render(await repo.calendar.disableFeed()));
        };
        if (A.api.isDemo()) render({}); else repo.calendar.feed().then(render).catch(e => { feedEl.innerHTML = ui.error(e, false); });

        const input = body.querySelector('[data-ics]'), res = body.querySelector('[data-import-res]');
        input.onchange = () => {
          const f = input.files && input.files[0]; if (!f) return;
          if (f.size > 3000000) { ui.toast('Файл слишком большой (до 3 МБ)', 'error'); return; }
          res.innerHTML = `<p class="small muted mt-3">Импортирую…</p>`;
          ui.guard(null, async () => {
            const r = await repo.calendar.importIcs(await f.text());
            res.innerHTML = `<div class="banner info mt-3">${I('check', 'sm')}<span>Добавлено: ${r.created}${r.updated ? `, обновлено: ${r.updated}` : ''}${r.skipped ? `, пропущено: ${r.skipped}` : ''}.${r.recurring ? ` Повторяющиеся события (${r.recurring}) импортированы одним, первым повторением.` : ''}</span></div>`;
            input.value = ''; onImported && onImported();
          }).then(() => { if (/Импортирую/.test(res.textContent)) res.innerHTML = ''; });
        };
      }
    });
  }

  A.router.register('/calendar', (el, ctx) => {
    let view = 'month';
    let sel = ctx.query.date ? new Date(ctx.query.date + 'T12:00') : new Date();
    let cursor = new Date(sel.getFullYear(), sel.getMonth(), 1);
    let events = [], tasks = [];

    el.innerHTML = `${ui.appbar({ back: true, title: 'Календарь', demo: true, actions: `<button class="icon-btn" data-sync aria-label="Синхронизация с телефоном">${I('refresh')}</button><button class="icon-btn soft" data-add aria-label="Новое событие">${I('plus')}</button>` })}
      <main class="content">
        <div class="segmented"><button data-view="month" class="active">Месяц</button><button data-view="week">Неделя</button><button data-view="list">Список</button></div>
        <div class="cal-nav row between mt-4"><button class="icon-btn" data-prev aria-label="Назад">${I('back')}</button><div class="bold" data-label></div><button class="icon-btn" data-next aria-label="Вперёд">${I('chevron')}</button></div>
        <div data-grid></div>
        <div class="section" data-day></div>
      </main>`;
    const grid = el.querySelector('[data-grid]'), dayEl = el.querySelector('[data-day]');

    const itemsOn = d => [
      ...events.filter(e => U.isSameDay(e.startAt, d)).map(e => ({ kind: 'event', at: e.startAt, e })),
      ...tasks.filter(t => t.dueAt && !t.done && U.isSameDay(t.dueAt, d)).map(t => ({ kind: 'task', at: t.dueAt, t }))
    ].sort((a, b) => a.at.localeCompare(b.at));

    function cell(d, inMonth) {
      const items = itemsOn(d);
      const today = U.isSameDay(d, new Date()), active = U.isSameDay(d, sel);
      return `<button class="cal-cell${inMonth ? '' : ' out'}${today ? ' today' : ''}${active ? ' sel' : ''}" data-date="${U.toLocalDateInput(d)}" aria-label="${U.fmtDate(d)}${items.length ? ', ' + items.length + ' дел' : ''}"><span>${d.getDate()}</span><i class="dots">${items.slice(0, 3).map(x => `<b class="${x.kind}"></b>`).join('')}</i></button>`;
    }

    function draw() {
      el.querySelector('.cal-nav').classList.toggle('hidden', view === 'list');
      const head = `<div class="cal-head">${U.WEEKDAYS_SHORT.map(w => `<span>${w}</span>`).join('')}</div>`;
      if (view === 'month') {
        el.querySelector('[data-label]').textContent = `${U.MONTHS_NOM[cursor.getMonth()]} ${cursor.getFullYear()}`;
        const first = new Date(cursor); const shift = (first.getDay() + 6) % 7;
        const start = U.addDays(first, -shift);
        const cells = Array.from({ length: 42 }, (_, i) => U.addDays(start, i));
        const rows = cells[35].getMonth() !== cursor.getMonth() ? cells.slice(0, 35) : cells;
        grid.innerHTML = `${head}<div class="cal-grid">${rows.map(d => cell(d, d.getMonth() === cursor.getMonth())).join('')}</div>`;
      } else if (view === 'week') {
        const start = U.addDays(U.startOfDay(sel), -((sel.getDay() + 6) % 7));
        const days = Array.from({ length: 7 }, (_, i) => U.addDays(start, i));
        el.querySelector('[data-label]').textContent = `${U.fmtDate(days[0])} — ${U.fmtDate(days[6])}`;
        grid.innerHTML = `${head}<div class="cal-grid week">${days.map(d => cell(d, true)).join('')}</div>`;
      } else {
        const upcoming = [...events.filter(e => new Date(e.endAt || e.startAt) >= U.startOfDay(new Date())).map(e => ({ kind: 'event', at: e.startAt, e }))].sort((a, b) => a.at.localeCompare(b.at));
        grid.innerHTML = upcoming.length ? upcoming.map((x, i) => `${i === 0 || !U.isSameDay(upcoming[i - 1].at, x.at) ? `<div class="t-label mt-4 mb-2">${U.fmtRelDay(x.at)}</div>` : ''}${evRow(x)}`).join('') : ui.empty({ icon: 'calendar', title: 'Нет предстоящих событий', action: '<button class="btn btn-primary" data-add2>Создать событие</button>' });
        dayEl.innerHTML = '';
        bindRows(grid);
        const a2 = grid.querySelector('[data-add2]'); if (a2) a2.onclick = () => eventSheet(null, sel, load);
        return;
      }
      grid.querySelectorAll('[data-date]').forEach(b => b.onclick = () => { sel = new Date(b.dataset.date + 'T12:00'); if (sel.getMonth() !== cursor.getMonth() && view === 'month') cursor = new Date(sel.getFullYear(), sel.getMonth(), 1); draw(); });
      drawDay();
    }

    const evRow = x => x.kind === 'event'
      ? `<button class="card row pressable mb-2 ev-row" data-ev="${x.e.id}" style="width:100%;text-align:left"><div class="ev-time"><b>${U.fmtTime(x.e.startAt)}</b><span>${x.e.endAt ? U.fmtTime(x.e.endAt) : ''}</span></div><div class="grow" style="min-width:0"><div class="bold ellipsis">${U.esc(x.e.title)}</div><div class="small muted ellipsis">${U.esc(x.e.location || '')}${x.e.remindMinutes ? ` · ${I('bell', 'sm')} напомнить` : ''}</div></div></button>`
      : `<button class="card row pressable mb-2 ev-row task" data-task-open="${x.t.id}" style="width:100%;text-align:left"><div class="ev-time"><b>${U.fmtTime(x.t.dueAt)}</b><span>задача</span></div><div class="grow bold ellipsis">${U.esc(x.t.title)}</div></button>`;

    function bindRows(root) {
      root.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => eventSheet(events.find(e => e.id === b.dataset.ev), null, load));
      root.querySelectorAll('[data-task-open]').forEach(b => b.onclick = () => A.screens.taskSheet(b.dataset.taskOpen));
    }

    function drawDay() {
      const items = itemsOn(sel);
      dayEl.innerHTML = `<div class="section-head"><h3>${U.fmtRelDay(sel)}${U.fmtRelDay(sel) !== U.fmtDate(sel) ? ', ' + U.fmtDate(sel) : ''}</h3><button class="link-btn" data-add-day>${I('plus', 'sm')} Событие</button></div>
        ${items.length ? items.map(evRow).join('') : '<p class="muted small">Нет событий и задач на этот день.</p>'}`;
      bindRows(dayEl);
      dayEl.querySelector('[data-add-day]').onclick = () => eventSheet(null, sel, load);
    }

    const load = () => ui.load(grid, () => Promise.all([repo.events.list(true), repo.tasks.list()]), ([e, t]) => { events = e; tasks = t; draw(); }, { skeleton: '<div class="skeleton" style="height:300px"></div>' });
    load();
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; el.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === b)); draw(); });
    el.querySelector('[data-prev]').onclick = () => { if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); else { sel = U.addDays(sel, -7); } draw(); };
    el.querySelector('[data-next]').onclick = () => { if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); else { sel = U.addDays(sel, 7); } draw(); };
    el.querySelector('[data-add]').onclick = () => eventSheet(null, sel, load);
    el.querySelector('[data-sync]').onclick = () => syncSheet(load);
    ctx.onLeave(A.bus.on('data:events', () => el.isConnected && load()));
    ctx.onLeave(A.bus.on('data:tasks', () => el.isConnected && load()));
  }, { backTo: '#/home' });
})(window.Adis);
