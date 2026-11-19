/* Interactive assistant action cards: shared between Chat and Voice screens so users can
 * confirm, edit or dismiss reminders, events, alarms, memories, people and finance items anywhere. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;

  function personMini(p) {
    return `<a class="mini" href="#/person/${p.id}">${ui.avatar(p, 'sm')}<div class="grow" style="min-width:0"><div class="bold small ellipsis">${U.esc(p.name)}</div><div class="tiny muted ellipsis">${U.esc([p.profession, (p.skills || []).slice(0, 3).join(', ')].filter(Boolean).join(' · '))}</div></div>${I('chevron', 'sm')}</a>`;
  }

  function cardHtml(c, refs) {
    const st = refs || { people: [], memories: [], tasks: [] };
    const d = c.data || {};
    if (c.type === 'people') {
      const ps = (d.ids || []).map(id => (st.people || []).find(p => p.id === id)).filter(Boolean);
      return ps.length ? `<div class="acard">${ps.map(personMini).join('')}</div>` : '';
    }
    if (c.type === 'memories') {
      const ms = (d.ids || []).map(id => (st.memories || []).find(x => x.id === id)).filter(Boolean);
      return ms.length ? `<div class="acard">${ms.map(x => `<a class="mini" href="#/memory/${x.id}">${ui.memIcon(x.type)}<div class="grow" style="min-width:0"><div class="bold small ellipsis">${U.esc(x.title)}</div><div class="tiny muted">${A.MEMORY_TYPES[x.type].one} · ${U.fmtDate(x.createdAt)}</div></div>${I('chevron', 'sm')}</a>`).join('')}</div>` : '';
    }
    if (c.type === 'tasks') {
      const ts = (d.ids || []).map(id => (st.tasks || []).find(x => x.id === id)).filter(Boolean);
      return ts.length ? `<div class="acard list task-list">${ts.map(t => ui.taskRow(t, st.people || [])).join('')}</div>` : '';
    }
    if (c.type === 'open') return `<a class="btn btn-secondary btn-sm" href="${U.esc(d.route)}">${I(d.icon || 'chevron', 'sm')}${U.esc(d.label)}</a>`;

    const done = c.status === 'confirmed', dismissed = c.status === 'dismissed';
    const cls = `acard action${done ? ' done' : ''}${dismissed ? ' dismissed' : ''}`;
    if (c.type === 'memory_save') {
      const p = d.person, mm = d.memory || {};
      const fields = p ? [
        ['user', 'Имя', p.name], ['briefcase', 'Профессия', p.profession], ['zap', 'Навыки', (p.skills || []).join(', ')], ['building', 'Организация', p.organization],
        ['pin', 'Где познакомились', p.metWhere], ['calendar', 'Дата знакомства', p.metAt && U.fmtDate(p.metAt)]
      ] : [['tag', 'Тип', (A.MEMORY_TYPES[mm.type] || A.MEMORY_TYPES.fact).one], ['file', 'Запись', mm.content || mm.title]];
      const linkTo = c.result && (c.result.personId ? `#/person/${c.result.personId}` : c.result.memoryId ? `#/memory/${c.result.memoryId}` : null);
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I(p ? 'users' : 'memory', 'sm')}<span>${p ? (d.existingPersonId ? 'Обновить человека в памяти' : 'Сохранить человека в память') : 'Сохранить в память'}</span>${mm.confirmed === false ? '<span class="tag warning">Требует подтверждения</span>' : ''}</div>
        ${d.sensitive ? `<div class="banner danger mt-2">${I('lock', 'sm')}<span>Чувствительные данные. Не рекомендуем хранить пароли и документы.</span></div>` : ''}
        ${mm.photo ? `<img class="ac-photo" src="${U.esc(mm.photo)}" alt="">` : ''}
        <div class="ac-fields">${fields.filter(f => f[2]).map(([ic, k, v]) => `<div class="acf">${I(ic, 'sm')}<span class="k">${k}</span><span class="v">${U.esc(v)}</span></div>`).join('')}</div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}Сохранено в память${linkTo ? ` · <a href="${linkTo}">Открыть</a>` : ''}</div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Не сохранено</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok>${d.sensitive ? 'Всё равно сохранить' : 'Сохранить'}</button><button class="btn btn-outline btn-sm" data-edit>Изменить</button><button class="btn btn-ghost btn-sm" data-no>Не нужно</button></div>`}
      </div>`;
    }
    if (c.type === 'task_create') {
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I('bell', 'sm')}<span>Создать напоминание?</span></div>
        <div class="ac-task"><div class="bold">${U.esc(d.title)}</div>
          <div class="ac-when"><span>${I('calendar', 'sm')}${d.dueAt ? U.fmtRelDay(d.dueAt) : 'Дата не указана'}</span><span>${I('clock', 'sm')}${d.dueAt ? U.fmtTime(d.dueAt) : '—'}</span>${d.repeat && d.repeat !== 'none' ? `<span>${I('repeat', 'sm')}${ui.repeatLabel(d.repeat)}</span>` : ''}</div>
          ${d.personName ? `<div class="small muted mt-1">${I('link', 'sm')} Связано с: ${U.esc(d.personName)}</div>` : ''}
          <div class="tiny faint mt-1">Часовой пояс: ${U.esc(A.settings.get('timezone'))}</div></div>
        ${!done && !dismissed && d.dueAt && (!d.repeat || d.repeat === 'none') && new Date(d.dueAt) < Date.now()
          ? `<div class="banner danger mt-2" data-past>${I('alert', 'sm')}<span>Это время уже прошло — напоминание сразу станет просроченным.</span><button class="btn btn-secondary btn-sm" data-tomorrow>На завтра</button></div>` : ''}
        ${done ? `<div class="ac-status success">${I('check', 'sm')}Напоминание создано · <a href="#/tasks">Задачи</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Отменено</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok ${d.dueAt ? '' : 'disabled'}>Создать</button><button class="btn btn-outline btn-sm" data-edit>${d.dueAt ? 'Изменить' : 'Указать время'}</button><button class="btn btn-ghost btn-sm" data-no>Отмена</button></div>`}
      </div>`;
    }
    const span = (s, e) => s ? `<span>${I('calendar', 'sm')}${U.fmtRelDay(s)}</span><span>${I('clock', 'sm')}${U.fmtTime(s)}${e && U.isSameDay(s, e) ? '–' + U.fmtTime(e) : ''}</span>` : `<span>${I('calendar', 'sm')}Дата не указана</span>`;
    if (c.type === 'event_create') {
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I('calendar', 'sm')}<span>Добавить в календарь?</span></div>
        <div class="ac-task"><div class="bold">${U.esc(d.title)}</div>
          <div class="ac-when">${span(d.startAt, d.endAt)}${d.remindMinutes ? `<span>${I('bell', 'sm')}за ${d.remindMinutes >= 60 && d.remindMinutes % 60 === 0 ? d.remindMinutes / 60 + ' ч' : d.remindMinutes + ' мин'}</span>` : ''}</div>
          ${d.location ? `<div class="small muted mt-1">${I('pin', 'sm')} ${U.esc(d.location)}</div>` : ''}
          ${d.personName ? `<div class="small muted mt-1">${I('link', 'sm')} Связано с: ${U.esc(d.personName)}</div>` : ''}</div>
        ${d.conflicts && d.conflicts.length && !done ? `<div class="banner danger mt-2">${I('alert', 'sm')}<span>В это время: ${d.conflicts.map(U.esc).join(', ')}</span></div>` : ''}
        ${done ? `<div class="ac-status success">${I('check', 'sm')}Добавлено · <a href="#/calendar?date=${U.toLocalDateInput(d.startAt)}">Календарь</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Отменено</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok ${d.startAt ? '' : 'disabled'}>Добавить</button><button class="btn btn-outline btn-sm" data-edit>${d.startAt ? 'Изменить' : 'Указать время'}</button><button class="btn btn-ghost btn-sm" data-no>Отмена</button></div>`}
      </div>`;
    }
    if (c.type === 'event_update') {
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I(d.cancel ? 'trash' : 'clock', 'sm')}<span>${d.cancel ? 'Отменить событие?' : 'Перенести событие?'}</span></div>
        <div class="ac-task"><div class="bold">${U.esc(d.title)}</div>
          <div class="ac-when${d.cancel ? '' : ' strike'}">${span(d.oldStartAt, d.oldEndAt)}</div>
          ${d.cancel ? '' : `<div class="ac-when">${I('chevron', 'sm')}${span(d.startAt, d.endAt)}</div>`}</div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}${d.cancel ? 'Событие отменено' : 'Перенесено'} · <a href="#/calendar">Календарь</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Оставлено как было</div>`
          : `<div class="ac-btns"><button class="btn ${d.cancel ? 'btn-danger' : 'btn-primary'} btn-sm" data-ok ${d.cancel || d.startAt ? '' : 'disabled'}>${d.cancel ? 'Отменить событие' : 'Перенести'}</button>${d.cancel ? '' : `<button class="btn btn-outline btn-sm" data-edit>${d.startAt ? 'Изменить' : 'Выбрать время'}</button>`}<button class="btn btn-ghost btn-sm" data-no>Не нужно</button></div>`}
      </div>`;
    }
    if (c.type === 'finance_tx') {
      const inc = d.kind === 'income';
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I(inc ? 'upload' : 'download', 'sm')}<span>${inc ? 'Записать доход?' : 'Записать расход?'}</span></div>
        <div class="ac-task"><div class="ac-money ${inc ? 'pos-text' : ''}">${inc ? '+' : '−'}${U.money(d.amount, d.currency)}</div>
          <div class="small muted">${U.esc([d.category, d.note && d.note !== d.category ? d.note : ''].filter(Boolean).join(' · '))}</div></div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}Записано · <a href="#/finance">Финансы</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Не записано</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok>Записать</button><button class="btn btn-outline btn-sm" data-edit>Изменить</button><button class="btn btn-ghost btn-sm" data-no>Не нужно</button></div>`}
      </div>`;
    }
    if (c.type === 'debt_create') {
      const lent = d.direction === 'lent';
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I(lent ? 'users' : 'wallet', 'sm')}<span>${lent ? 'Записать: вам должны' : 'Записать: вы должны'}</span></div>
        <div class="ac-task"><div class="bold">${U.esc(d.counterparty)}</div><div class="ac-money ${lent ? 'pos-text' : 'neg-text'}">${U.money(d.amount, d.currency)}</div>
          <div class="small muted">${d.dueAt ? `Вернуть до ${U.fmtDate(d.dueAt)} — напомню` : 'Без срока'}</div></div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}Долг записан · <a href="#/finance?tab=debts">Долги</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Не записано</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok>Записать</button><button class="btn btn-outline btn-sm" data-edit>Изменить</button><button class="btn btn-ghost btn-sm" data-no>Не нужно</button></div>`}
      </div>`;
    }
    if (c.type === 'debt_repay') {
      const lent = d.direction === 'lent';
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I('check', 'sm')}<span>${lent ? 'Отметить возврат долга?' : 'Отметить, что вы вернули?'}</span></div>
        <div class="ac-task"><div class="bold">${U.esc(d.counterparty)}</div><div class="ac-money">${U.money(d.amount, d.currency)}</div>
          <div class="small muted">${d.full ? 'Долг будет закрыт' : `Останется ${U.money(d.left - d.amount, d.currency)}`}</div></div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}${c.result && c.result.closed ? 'Долг закрыт' : 'Возврат отмечен'} · <a href="#/finance?tab=debts">Долги</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Отменено</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok>Отметить</button><button class="btn btn-ghost btn-sm" data-no>Не нужно</button></div>`}
      </div>`;
    }
    if (c.type === 'alarm_set' || c.type === 'alarm_update') {
      const off = c.type === 'alarm_update';
      const time = off ? d.time : `${U.pad(d.hour)}:${U.pad(d.minute)}`;
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I('clock', 'sm')}<span>${off ? 'Выключить будильник?' : 'Поставить будильник?'}</span></div>
        <div class="ac-task"><div class="alarm-time">${U.esc(time)}</div><div class="small muted">${U.esc([off ? '' : d.daysLabel, d.label].filter(Boolean).join(' · '))}</div></div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}${off ? 'Будильник выключен' : 'Будильник поставлен'} · <a href="#/alarms">Будильники</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Отменено</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok>${off ? 'Выключить' : 'Поставить'}</button>${off ? '' : '<button class="btn btn-outline btn-sm" data-edit>Изменить</button>'}<button class="btn btn-ghost btn-sm" data-no>Отмена</button></div>`}
      </div>`;
    }
    if (c.type === 'person_photo') {
      return `<div class="${cls}" data-cid="${c.id}">
        <div class="ac-head">${I('camera', 'sm')}<span>Фото для контакта</span></div>
        <div class="row mt-2"><img class="ac-avatar" src="${U.esc(d.photo)}" alt=""><div class="grow"><div class="bold">${U.esc(d.personName)}</div><div class="small muted">Поставить это фото на карточку человека?</div></div></div>
        ${done ? `<div class="ac-status success">${I('check', 'sm')}Фото обновлено · <a href="#/person/${d.personId}">Открыть</a></div>`
        : dismissed ? `<div class="ac-status">${I('x', 'sm')}Не нужно</div>`
          : `<div class="ac-btns"><button class="btn btn-primary btn-sm" data-ok>Поставить фото</button><button class="btn btn-ghost btn-sm" data-no>Не нужно</button></div>`}
      </div>`;
    }
    return '';
  }

  function editEventCard(c, done) {
    const d = c.data, move = c.type === 'event_update';
    const start = d.startAt ? new Date(d.startAt) : d.oldStartAt ? new Date(d.oldStartAt) : (() => { const x = U.addDays(new Date(), 1); x.setHours(10, 0, 0, 0); return x; })();
    const len = d.startAt && d.endAt ? new Date(d.endAt) - new Date(d.startAt) : d.oldStartAt && d.oldEndAt ? new Date(d.oldEndAt) - new Date(d.oldStartAt) : 3600000;
    ui.sheet({
      title: move ? 'Перенести событие' : 'Событие',
      body: `<form novalidate>${move ? `<div class="bold mb-3">${U.esc(d.title)}</div>` : `<div class="field"><label>Название</label><input class="input" name="title" value="${U.esc(d.title)}"></div>`}
        <div class="field"><label>Начало</label><input class="input" type="datetime-local" name="startAt" value="${U.toLocalInput(start)}"></div>
        <div class="field"><label>Окончание</label><input class="input" type="datetime-local" name="endAt" value="${U.toLocalInput(new Date(start.getTime() + len))}"></div>
        ${move ? '' : `<div class="field"><label>Место</label><input class="input" name="location" value="${U.esc(d.location || '')}"></div>`}
        <button class="btn btn-primary btn-block" type="submit">${move ? 'Перенести' : 'Добавить в календарь'}</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!move && !v.title) return ui.fieldError(f, 'title', 'Введите название');
          if (!v.startAt) return ui.fieldError(f, 'startAt', 'Укажите время');
          if (v.endAt && new Date(v.endAt) < new Date(v.startAt)) return ui.fieldError(f, 'endAt', 'Окончание раньше начала');
          Object.assign(d, { startAt: new Date(v.startAt).toISOString(), endAt: new Date(v.endAt || new Date(new Date(v.startAt).getTime() + len)).toISOString() });
          if (!move) Object.assign(d, { title: v.title, location: v.location, conflicts: [] });
          close(); done();
        };
      }
    });
  }

  function editMoneyCard(c, done) {
    const d = c.data, debt = c.type === 'debt_create';
    ui.sheet({
      title: debt ? 'Долг' : d.kind === 'income' ? 'Доход' : 'Расход',
      body: `<form novalidate>${debt ? `<div class="field"><label>${d.direction === 'lent' ? 'Кто должен' : 'Кому вы должны'}</label><input class="input" name="counterparty" value="${U.esc(d.counterparty || '')}"></div>` : ''}
        <div class="field"><label>Сумма</label><input class="input fin-amount-input" name="amount" inputmode="decimal" value="${d.amount}"></div>
        ${debt ? `<div class="field"><label>Вернуть до</label><input class="input" type="date" name="dueAt" value="${d.dueAt ? U.toLocalDateInput(d.dueAt) : ''}"></div>`
          : `<div class="field"><label>Категория</label><input class="input" name="category" value="${U.esc(d.category || '')}"></div><div class="field"><label>Комментарий</label><input class="input" name="note" value="${U.esc(d.note || '')}"></div>`}
        <button class="btn btn-primary btn-block" type="submit">Записать</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          const amount = parseFloat(String(v.amount || '').replace(/\s/g, '').replace(',', '.'));
          if (!(amount > 0)) return ui.fieldError(f, 'amount', 'Введите сумму');
          if (debt && !v.counterparty) return ui.fieldError(f, 'counterparty', 'Укажите человека');
          Object.assign(d, { amount }, debt ? { counterparty: v.counterparty, personId: v.counterparty === c.data.counterparty ? d.personId : null, dueAt: v.dueAt ? new Date(v.dueAt + 'T12:00').toISOString() : null } : { category: v.category || 'Другое', note: v.note || '' });
          close(); done();
        };
      }
    });
  }

  function editAlarmCard(c, done) {
    const d = c.data;
    ui.sheet({
      title: 'Будильник',
      body: `<form novalidate><div class="field"><label>Время</label><input class="input alarm-time-input" type="time" name="time" value="${U.pad(d.hour)}:${U.pad(d.minute)}"></div>
        <div class="field"><label>Подпись</label><input class="input" name="label" value="${U.esc(d.label || '')}"></div>
        <button class="btn btn-primary btn-block" type="submit">Поставить</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          const mm = /^(\d{1,2}):(\d{2})/.exec(v.time || '');
          if (!mm) return ui.fieldError(f, 'time', 'Укажите время');
          Object.assign(d, { hour: +mm[1], minute: +mm[2], label: v.label || '' });
          close(); done();
        };
      }
    });
  }

  function editTaskCard(c, done) {
    const d = c.data;
    const def = d.dueAt ? new Date(d.dueAt) : (() => { const x = U.addDays(new Date(), 1); x.setHours(9, 0, 0, 0); return x; })();
    ui.sheet({
      title: 'Напоминание',
      body: `<form novalidate><div class="field"><label>Что напомнить</label><input class="input" name="title" value="${U.esc(d.title)}"></div>
        <div class="field"><label>Когда</label><input class="input" type="datetime-local" name="dueAt" value="${U.toLocalInput(def)}"></div>
        <div class="field"><label>Повтор</label><select class="select" name="repeat">${[['none', 'Не повторять'], ['daily', 'Каждый день'], ['weekly', 'Каждую неделю'], ['monthly', 'Каждый месяц']].map(([v, l]) => `<option value="${v}" ${d.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <button class="btn btn-primary btn-block" type="submit">Создать напоминание</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!v.title) return ui.fieldError(f, 'title', 'Введите текст');
          if (!v.dueAt) return ui.fieldError(f, 'dueAt', 'Укажите время');
          Object.assign(d, { title: v.title, dueAt: new Date(v.dueAt).toISOString(), repeat: v.repeat });
          close(); done();
        };
      }
    });
  }

  function editMemoryCard(c, done) {
    const d = c.data, p = d.person, m = d.memory;
    ui.sheet({
      title: p ? 'Данные о человеке' : 'Запись в память',
      body: `<form novalidate>${p ? `
        <div class="field"><label>Имя</label><input class="input" name="name" value="${U.esc(p.name)}"></div>
        <div class="field"><label>Профессия</label><input class="input" name="profession" value="${U.esc(p.profession)}"></div>
        <div class="field"><label>Навыки (через запятую)</label><input class="input" name="skills" value="${U.esc((p.skills || []).join(', '))}"></div>
        <div class="field"><label>Организация</label><input class="input" name="organization" value="${U.esc(p.organization)}"></div>
        <div class="field"><label>Где познакомились</label><input class="input" name="metWhere" value="${U.esc(p.metWhere)}"></div>` : `
        <div class="field"><label>Тип</label><select class="select" name="type">${Object.entries(A.MEMORY_TYPES).filter(([k]) => k !== 'person').map(([k, t]) => `<option value="${k}" ${m.type === k ? 'selected' : ''}>${t.one}</option>`).join('')}</select></div>
        <div class="field"><label>Заголовок</label><input class="input" name="title" value="${U.esc(m.title)}"></div>
        <div class="field"><label>Содержание</label><textarea class="textarea" name="content">${U.esc(m.content)}</textarea></div>`}
        <button class="btn btn-primary btn-block" type="submit">Сохранить в память</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (p) {
            if (!v.name) return ui.fieldError(f, 'name', 'Введите имя');
            Object.assign(p, { name: v.name, profession: v.profession, organization: v.organization, metWhere: v.metWhere, skills: v.skills.split(',').map(s => s.trim()).filter(Boolean) });
            m.title = `Знакомство: ${v.name}`;
          } else {
            if (!v.title && !v.content) return ui.fieldError(f, 'title', 'Заполните запись');
            Object.assign(m, { type: v.type, title: v.title || A.nlu.memoryTitle(v.content), content: v.content, confirmed: true });
          }
          close(); done();
        };
      }
    });
  }

  const EDITORS = {
    task_create: editTaskCard,
    memory_save: editMemoryCard,
    event_create: editEventCard,
    event_update: editEventCard,
    alarm_set: editAlarmCard,
    finance_tx: editMoneyCard,
    debt_create: editMoneyCard
  };

  function bindCard(node, m, { convId, source, onUpdate, root }) {
    const c = (m.cards || []).find(x => x.id === node.dataset.cid);
    if (!c || c.status !== 'pending') return;
    const ok = node.querySelector('[data-ok]'), edit = node.querySelector('[data-edit]'), no = node.querySelector('[data-no]');
    const getSource = () => (typeof source === 'function' ? source(m) : source || { kind: 'chat', conversationId: convId, messageId: m.id, excerpt: '' });
    const persist = async patch => {
      Object.assign(c, patch);
      if (convId && m.id) {
        try { await repo.chat.setCard(convId, m.id, c.id, patch); } catch (e) { A.log.warn('cards', 'card sync', e && e.code); }
      }
      if (onUpdate) await onUpdate(c, m);
    };
    const confirm = btn => ui.guard(btn, async () => {
      if (c.type === 'memory_save') {
        const result = await repo.actions.confirmMemoryCard(c.data, getSource());
        await persist({ status: 'confirmed', result });
        ui.toast(c.data.person ? `${c.data.person.name.split(' ')[0]} сохранён в памяти` : 'Сохранено в память', 'success', { label: 'Открыть', onClick: () => A.router.go(result.personId ? `#/person/${result.personId}` : `#/memory/${result.memoryId}`) });
      } else if (c.type === 'person_photo') {
        await repo.people.update(c.data.personId, { photo: await A.ui.squareAvatar(c.data.photo) });
        await persist({ status: 'confirmed', result: { personId: c.data.personId } });
        ui.toast('Фото контакта обновлено', 'success');
      } else if (c.type === 'event_create') {
        const result = await repo.actions.confirmEventCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast(`Добавлено в календарь: ${U.fmtDateTime(c.data.startAt).toLowerCase()}`, 'success');
      } else if (c.type === 'event_update') {
        const result = await repo.actions.confirmEventUpdateCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast(c.data.cancel ? 'Событие отменено' : `Перенесено на ${U.fmtDateTime(c.data.startAt).toLowerCase()}`, 'success');
      } else if (c.type === 'alarm_set') {
        const result = await repo.actions.confirmAlarmCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast(result.nextAt ? `Будильник прозвонит ${U.fmtDateTime(result.nextAt).toLowerCase()}` : 'Будильник поставлен', 'success', { label: 'Открыть', onClick: () => A.router.go('#/alarms') });
      } else if (c.type === 'finance_tx') {
        const result = await repo.actions.confirmFinanceCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast(`${c.data.kind === 'income' ? 'Доход' : 'Расход'} ${U.money(c.data.amount, c.data.currency)} записан`, 'success');
      } else if (c.type === 'debt_create') {
        const result = await repo.actions.confirmDebtCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast('Долг записан', 'success', { label: 'Открыть', onClick: () => A.router.go('#/finance?tab=debts') });
      } else if (c.type === 'debt_repay') {
        const result = await repo.actions.confirmDebtRepayCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast(result.closed ? 'Долг закрыт' : `Осталось ${U.money(result.left, c.data.currency)}`, 'success');
      } else if (c.type === 'alarm_update') {
        const result = await repo.actions.confirmAlarmUpdateCard(c.data);
        await persist({ status: 'confirmed', result });
        ui.toast('Будильник выключен', 'success');
      } else {
        const result = await repo.actions.confirmTaskCard(c.data, getSource());
        await persist({ status: 'confirmed', result });
        ui.toast(`Напомню ${U.fmtDateTime(c.data.dueAt).toLowerCase()}`, 'success');
      }
    });
    if (ok) ok.onclick = () => confirm(ok);
    if (no) no.onclick = () => ui.guard(no, () => persist({ status: 'dismissed' }));
    const tomorrow = node.querySelector('[data-tomorrow]');
    if (tomorrow) tomorrow.onclick = () => ui.guard(tomorrow, async () => {
      const due = new Date(c.data.dueAt); due.setDate(due.getDate() + 1);
      await persist({ data: Object.assign({}, c.data, { dueAt: due.toISOString() }) });
    });
    const ready = () => (c.type === 'task_create' ? !!c.data.dueAt : c.type.startsWith('event_') ? !!c.data.startAt : true);
    if (edit && EDITORS[c.type]) {
      edit.onclick = () => EDITORS[c.type](c, async () => {
        if (onUpdate) await onUpdate(c, m);
        if (ready()) {
          const host = root || document;
          const nextOk = host.querySelector(`[data-cid="${c.id}"] [data-ok]`);
          if (nextOk) confirm(nextOk);
        }
      });
    }
  }

  A.cards = {
    html: cardHtml,
    renderList(cards, refs) { return (cards || []).map(c => cardHtml(c, refs)).join(''); },
    bind(container, m, opts = {}) {
      container.querySelectorAll('.acard.action').forEach(cn => bindCard(cn, m, Object.assign({ root: container }, opts)));
      ui.bindTaskRows(container, opts.onTaskChange);
    }
  };
})(window.Adis);
