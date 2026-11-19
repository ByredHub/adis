/* Alarms: list, on/off, create & edit (time, weekdays, label). Ringing itself lives in services/alarm-clock.js. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];

  function alarmSheet(a, onSaved) {
    const days = new Set(a ? a.days : []);
    const time = a ? a.time : '07:00';
    ui.sheet({
      title: a ? 'Будильник' : 'Новый будильник',
      body: `<form novalidate>
        <div class="field"><label>Время</label><input class="input alarm-time-input" type="time" name="time" value="${U.esc(time)}" required></div>
        <div class="field"><label>Повтор</label><div class="chips wrap" data-days>${DAYS.map(([d, l]) => `<button type="button" class="chip${days.has(d) ? ' active' : ''}" data-d="${d}" aria-pressed="${days.has(d)}">${l}</button>`).join('')}</div>
          <div class="hint">Не выбрано — прозвонит один раз</div></div>
        <div class="field"><label>Подпись</label><input class="input" name="label" maxlength="120" value="${U.esc(a ? a.label : '')}" placeholder="Например: Пробежка"></div>
        <button class="btn btn-primary btn-block" type="submit">${a ? 'Сохранить' : 'Поставить будильник'}</button>
        ${a ? '<button type="button" class="btn btn-danger btn-block mt-3" data-delete>Удалить будильник</button>' : ''}
      </form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
          const d = +b.dataset.d; days.has(d) ? days.delete(d) : days.add(d);
          b.classList.toggle('active', days.has(d)); b.setAttribute('aria-pressed', days.has(d));
        });
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          const m = /^(\d{1,2}):(\d{2})/.exec(v.time || '');
          if (!m) return ui.fieldError(f, 'time', 'Укажите время');
          const payload = { hour: +m[1], minute: +m[2], days: Array.from(days), label: v.label || '' };
          ui.guard(f.querySelector('[type=submit]'), async () => {
            const r = a ? await repo.alarms.update(a.id, Object.assign({ enabled: true }, payload)) : await repo.alarms.create(payload);
            close(); ui.toast(r.nextAt ? `Прозвонит ${U.fmtDateTime(r.nextAt).toLowerCase()}` : 'Будильник сохранён', 'success'); onSaved && onSaved();
          });
        };
        const del = f.querySelector('[data-delete]');
        if (del) del.onclick = async () => {
          if (!(await ui.confirmDanger('Удалить будильник?', `Будильник на ${a.time} будет удалён.`))) return;
          ui.guard(del, async () => { await repo.alarms.remove(a.id); close(); ui.toast('Будильник удалён', 'success'); onSaved && onSaved(); });
        };
      }
    });
  }

  function rowHtml(a) {
    const sub = [a.daysLabel, a.label].filter(Boolean).join(' · ');
    const next = a.enabled && a.nextAt ? `<div class="tiny faint">${a.snoozeUntil ? 'Отложен до' : 'Прозвонит'} ${U.esc(U.fmtDateTime(a.nextAt).toLowerCase())}</div>` : '';
    return `<div class="list-item alarm-row${a.enabled ? '' : ' off'}" data-id="${a.id}">
      <button class="grow alarm-open" data-open aria-label="Изменить будильник ${U.esc(a.time)}"><div class="alarm-time">${U.esc(a.time)}</div><div class="li-sub">${U.esc(sub)}</div>${next}</button>
      ${ui.switchHtml('enabled-' + a.id, a.enabled, 'Будильник ' + a.time)}</div>`;
  }

  A.router.register('/alarms', el => {
    el.innerHTML = `${ui.appbar({ back: true, title: 'Будильники', demo: true, actions: `<button class="icon-btn soft" data-add aria-label="Новый будильник">${I('plus')}</button>` })}
      <main class="content">
        <div data-list></div>
        <div class="banner info mt-4">${I('info', 'sm')}<span>${A.api.isDemo()
          ? 'В демо-режиме будильник звонит, только пока Adis открыт.'
          : 'Пока Adis открыт, будильник звонит со звуком и вибрацией. Если приложение закрыто, придёт push-уведомление — включите его в «Профиль → Уведомления». Звонить в беззвучном режиме и будить заблокированный телефон, как системные часы, веб-приложение не может.'}</span></div>
      </main>`;
    const listEl = el.querySelector('[data-list]');
    const load = () => ui.load(listEl, () => repo.alarms.list(true), list => {
      if (!list.length) {
        listEl.innerHTML = ui.empty({ icon: 'clock', title: 'Будильников нет', text: 'Добавьте будильник или скажите Adis: «Поставь будильник на 7:30 по будням».', action: '<button class="btn btn-primary" data-add2>Новый будильник</button>' });
        listEl.querySelector('[data-add2]').onclick = () => alarmSheet(null, load);
        return;
      }
      listEl.innerHTML = `<div class="list">${list.map(rowHtml).join('')}</div>`;
      list.forEach(a => {
        const row = listEl.querySelector(`[data-id="${a.id}"]`);
        row.querySelector('[data-open]').onclick = () => alarmSheet(a, load);
        row.querySelector(`[name="enabled-${a.id}"]`).onchange = e => ui.guard(null, async () => {
          const r = await repo.alarms.update(a.id, { enabled: e.target.checked });
          if (r.enabled && r.nextAt) ui.toast(`Прозвонит ${U.fmtDateTime(r.nextAt).toLowerCase()}`, 'success');
          load();
        });
      });
    });
    el.querySelector('[data-add]').onclick = () => alarmSheet(null, load);
    load();
  }, { backTo: '#/tasks' });

  /* Opened from a push notification: ring if it is still ringing, then show the list */
  A.router.register('/alarm/:id', async (el, ctx) => {
    el.innerHTML = ui.loading();
    try {
      const a = (await repo.alarms.list(true)).find(x => x.id === ctx.params.id);
      A.router.go('#/alarms', { replace: true });
      if (a && a.ringing) A.alarmClock.ring(a);
    } catch (e) { el.innerHTML = ui.error(e); }
  });

  A.screens = A.screens || {};
  A.screens.alarmSheet = alarmSheet;
})(window.Adis);
