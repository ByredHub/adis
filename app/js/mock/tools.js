/* DEMO backend business logic: AI tools + CRUD, operating on the local mock DB.
 * The same functions back both the REST mock endpoints and the AI tool calls (no duplicated logic).
 * In production these are FastAPI services with permission checks; the model never touches SQL. */
(function (A) {
  'use strict';
  const U = A.util;
  const now = () => new Date().toISOString();

  function nextOccurrence(dueAt, repeat) {
    const d = new Date(dueAt);
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    else if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  }

  function score(query, fields) {
    const qs = A.nlu.keywords(query);
    if (!qs.length) return 0;
    const hay = U.words(fields.filter(Boolean).join(' '));
    let s = 0;
    qs.forEach(q => { if (hay.some(h => h === q)) s += 3; else if (hay.some(h => U.sameStem(h, q))) s += 2; });
    return s / qs.length;
  }

  function makeTools(d) {
    const T = {
      /* ---- memory ---- */
      memory_search({ query = '', types = null, limit = 20 } = {}) {
        let list = d.memories.slice();
        if (types) list = list.filter(m => types.includes(m.type));
        if (!query.trim()) return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
        return list.map(m => ({ m, s: score(query, [m.title, m.content, (m.tags || []).join(' '), A.MEMORY_TYPES[m.type] && A.MEMORY_TYPES[m.type].label]) }))
          .filter(x => x.s > 0.3).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.m);
      },
      memory_save(input) {
        const m = Object.assign({ id: U.uid('m'), type: 'fact', title: '', content: '', tags: [], confirmed: true, personId: null, source: { kind: 'manual' }, createdAt: now(), updatedAt: now() }, input);
        if (!m.title) m.title = A.nlu.memoryTitle(m.content || 'Без названия');
        if (!A.MEMORY_TYPES[m.type]) m.type = 'fact';
        d.memories.unshift(m);
        return m;
      },
      memory_update(id, patch) {
        const m = d.memories.find(x => x.id === id); if (!m) return null;
        Object.assign(m, patch, { id, updatedAt: now() }); return m;
      },
      memory_delete(id) {
        const i = d.memories.findIndex(x => x.id === id); if (i < 0) return false;
        d.memories.splice(i, 1); return true;
      },

      /* ---- people (entity_lookup) ---- */
      entity_lookup({ name, profession, skill, sinceDays } = {}) {
        let list = d.people.slice();
        if (name) list = list.filter(p => p.name.split(' ').some(part => U.sameStem(part, name)));
        if (profession) {
          const st = String(profession).toLowerCase();
          list = list.filter(p => (p.profession || '').toLowerCase().replace(/ё/g, 'е').includes(st) || (p.skills || []).some(s => s.toLowerCase().includes(st)));
        }
        if (skill) list = list.filter(p => (p.skills || []).some(s => s.toLowerCase() === String(skill).toLowerCase()));
        if (sinceDays) { const lim = Date.now() - sinceDays * 86400000; list = list.filter(p => new Date(p.metAt || p.createdAt).getTime() >= lim); }
        return list.sort((a, b) => (b.metAt || b.createdAt).localeCompare(a.metAt || a.createdAt));
      },
      person_save(input) {
        const existing = input.id ? d.people.find(p => p.id === input.id) : d.people.find(p => p.name.toLowerCase() === String(input.name || '').toLowerCase());
        if (existing) {
          const skills = Array.from(new Set([...(existing.skills || []), ...(input.skills || [])]));
          Object.assign(existing, Object.fromEntries(Object.entries(input).filter(([k, v]) => v && k !== 'id' && k !== 'skills')), { skills, updatedAt: now() });
          if (input.interaction) existing.interactions.unshift({ date: now(), text: input.interaction });
          return existing;
        }
        const p = Object.assign({ id: U.uid('p'), name: 'Без имени', photo: null, profession: '', skills: [], organization: '', metAt: now(), metWhere: '', notes: '', interactions: [], createdAt: now(), updatedAt: now() }, input);
        delete p.interaction;
        if (!p.interactions.length) p.interactions.push({ date: p.metAt, text: p.metWhere ? `Познакомились ${p.metWhere}` : 'Знакомство' });
        d.people.unshift(p);
        return p;
      },
      person_update(id, patch) {
        const p = d.people.find(x => x.id === id); if (!p) return null;
        Object.assign(p, patch, { id, updatedAt: now() }); return p;
      },
      person_delete(id) {
        const i = d.people.findIndex(x => x.id === id); if (i < 0) return false;
        d.people.splice(i, 1);
        d.memories.forEach(m => { if (m.personId === id) m.personId = null; });
        d.tasks.forEach(t => { if (t.personId === id) t.personId = null; });
        return true;
      },

      /* ---- tasks ---- */
      task_create(input) {
        const t = Object.assign({ id: U.uid('t'), title: 'Задача', notes: '', dueAt: null, repeat: 'none', remind: true, done: false, doneAt: null, personId: null, createdAt: now(), updatedAt: now() }, input);
        d.tasks.unshift(t);
        if (t.remind && t.dueAt) T.notification_schedule({ taskId: t.id, at: t.dueAt });
        return t;
      },
      task_update(id, patch) {
        const t = d.tasks.find(x => x.id === id); if (!t) return null;
        Object.assign(t, patch, { id, updatedAt: now() }); return t;
      },
      task_complete(id, done = true) {
        const t = d.tasks.find(x => x.id === id); if (!t) return null;
        if (done && t.repeat && t.repeat !== 'none' && t.dueAt) {
          T.task_create({ title: t.title, notes: t.notes, dueAt: nextOccurrence(t.dueAt, t.repeat), repeat: t.repeat, remind: t.remind, personId: t.personId });
          t.repeat = 'none';
        }
        t.done = done; t.doneAt = done ? now() : null; t.updatedAt = now();
        return t;
      },
      task_delete(id) {
        const i = d.tasks.findIndex(x => x.id === id); if (i < 0) return false;
        d.tasks.splice(i, 1); return true;
      },
      /* Server-side notification scheduling (in production: a Redis/RabbitMQ job → APNs/FCM push) */
      notification_schedule({ taskId, at }) {
        const t = d.tasks.find(x => x.id === taskId); if (t) t.notifyAt = at;
        return { scheduled: true, at };
      },

      /* ---- proactive ---- */
      proactive_suggestion() {
        const res = [];
        const nowMs = Date.now();
        const state = d.suggestionState;
        d.tasks.filter(t => !t.done && t.dueAt && new Date(t.dueAt) < nowMs).slice(0, 2).forEach(t => res.push({
          id: `sg_overdue_${t.id}`, kind: 'overdue', title: 'Есть незавершённая задача', text: `«${t.title}» — срок прошёл ${U.fmtAgo(t.dueAt).toLowerCase()}. Перенести на завтра или отметить выполненной?`,
          action: { type: 'reschedule_task', taskId: t.id }, actionLabel: 'Перенести на завтра', icon: 'clock'
        }));
        d.tasks.filter(t => !t.done && t.personId && t.dueAt && new Date(t.dueAt) > nowMs && new Date(t.dueAt) - nowMs < 3 * 86400000).slice(0, 1).forEach(t => {
          const p = d.people.find(pp => pp.id === t.personId);
          res.push({ id: `sg_person_${t.id}`, kind: 'person', title: p ? `Ты собирался связаться: ${p.name.split(' ')[0]}` : 'Запланированный контакт', text: `${t.title} — ${U.fmtDateTime(t.dueAt)}.`, action: { type: 'open', route: p ? `#/person/${p.id}` : '#/tasks' }, actionLabel: 'Открыть', icon: 'users' });
        });
        const plan = d.memories.find(m => (m.type === 'plan' || m.type === 'intention') && m.confirmed);
        if (plan) res.push({ id: `sg_plan_${plan.id}`, kind: 'plan', title: 'Продолжим твой план?', text: `Ты хотел: «${plan.title}». Могу разбить его на шаги и создать задачи.`, action: { type: 'chat', prompt: `Помоги разбить план «${plan.title}» на шаги` }, actionLabel: 'Продолжить', icon: 'flag' });
        const stale = d.people.find(p => (Date.now() - new Date(p.updatedAt)) > 14 * 86400000);
        if (stale) res.push({ id: `sg_stale_${stale.id}`, kind: 'network', title: `Давно не было контакта: ${stale.name}`, text: `${stale.profession || 'Знакомый'}${stale.organization ? ', ' + stale.organization : ''}. Напомнить написать на этой неделе?`, action: { type: 'create_task', title: `Написать ${stale.name.split(' ')[0]}`, personId: stale.id }, actionLabel: 'Напомнить', icon: 'bell' });
        (d.debts || []).filter(x => x.status === 'open' && x.dueAt && new Date(x.dueAt) < nowMs).slice(0, 2).forEach(x => {
          const left = U.money(x.amount - (x.paid || 0), x.currency);
          res.push({ id: `sg_debt_${x.id}`, kind: 'debt', title: 'Срок долга прошёл', text: x.direction === 'lent' ? `${x.counterparty} должен вернуть ${left}.` : `Ты собирался вернуть ${A.mockFinance.dative(x.counterparty)} ${left}.`, action: { type: 'open', route: '#/finance?tab=debts' }, actionLabel: 'Открыть долги', icon: 'wallet' });
        });
        const unconfirmed = d.memories.filter(m => !m.confirmed).length;
        if (unconfirmed) res.push({ id: `sg_confirm_${unconfirmed}`, kind: 'memory', title: 'Проверь, что я запомнил', text: `${unconfirmed} ${U.plural(unconfirmed, 'запись требует', 'записи требуют', 'записей требуют')} подтверждения.`, action: { type: 'open', route: '#/memory?filter=unconfirmed' }, actionLabel: 'Проверить', icon: 'memory' });
        if (d.tasks.some(t => t.done) || d.memories.length > 3) res.push({ id: `sg_report_week`, kind: 'report', title: 'Могу подготовить отчёт', text: 'Сводка за неделю на основе сохранённых данных: задачи, знакомства, планы.', action: { type: 'open', route: '#/workspace/reports' }, actionLabel: 'Подготовить', icon: 'report' });

        return res.filter(s => {
          const st = state[s.id];
          if (!st) return true;
          if (st.status === 'snoozed') return new Date(st.until) < nowMs;
          return false;
        });
      }
    };
    return T;
  }

  A.mockTools = { make: makeTools, nextOccurrence };
})(window.Adis);
