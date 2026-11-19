/* Repositories: the only layer screens talk to. Wrap API calls, keep a small cache and broadcast changes
 * on the bus so every feature (home, chat, memory, tasks…) stays in sync with one data system. */
(function (A) {
  'use strict';
  const api = A.api, R = A.API;
  const cache = {};
  const changed = (topic, payload) => { delete cache[topic]; A.bus.emit('data:' + topic, payload); };

  async function cached(topic, loader, force) {
    if (!force && cache[topic]) return cache[topic];
    const v = await loader(); cache[topic] = v; A.storage.set('cache.' + topic, v); return v;
  }
  const offlineCopy = topic => A.storage.get('cache.' + topic);

  const auth = {
    user: null,
    async restore() {
      if (!(await api.hasSession())) return null;
      try { auth.user = await api.request(R.auth.me); A.storage.set('cache.user', auth.user); return auth.user; } catch (e) {
        if (e.code === 'network' || e.code === 'timeout') { auth.user = A.storage.get('cache.user'); return auth.user; }
        await api.saveTokens(null); return null;
      }
    },
    async login(email, password, { remember = true, demo = false } = {}) {
      api.setRemember(remember);
      const res = await api.request(R.auth.login, { body: { email, password, demo } });
      await api.saveTokens(res); auth.user = res.user; A.bus.emit('auth:changed', res.user); return res.user;
    },
    async register(name, email, password) {
      api.setRemember(true);
      const res = await api.request(R.auth.register, { body: { name, email, password } });
      await api.saveTokens(res); auth.user = res.user; A.bus.emit('auth:changed', res.user); return res.user;
    },
    forgot: email => api.request(R.auth.forgot, { body: { email } }),
    resetPassword: (token, password) => api.request(R.auth.resetPassword, { body: { token, password } }),
    changePassword: (current, next) => api.request(R.auth.changePassword, { body: { current, next } }),
    async updateMe(patch) { auth.user = await api.request(R.auth.updateMe, { body: patch }); A.bus.emit('auth:changed', auth.user); return auth.user; },
    devices: () => api.request(R.auth.devices),
    exportData: () => api.request(R.auth.exportData),
    async logout() {
      const t = await api.loadTokens();
      if (A.push) await A.push.forget();
      try { await api.request(R.auth.logout, { body: { refreshToken: t && t.refreshToken } }); } catch (_) { /* logout locally anyway */ }
      await auth.clearLocal();
    },
    async deleteAccount() { await api.request(R.auth.deleteMe); await auth.clearLocal(); },
    async clearLocal() {
      await api.saveTokens(null); auth.user = null;
      Object.keys(cache).forEach(k => delete cache[k]);
      ['user', 'tasks', 'memories', 'people', 'conversations', 'events', 'alarms'].forEach(k => A.storage.remove('cache.' + k));
      A.bus.emit('auth:changed', null);
    }
  };

  const chat = {
    list: force => cached('conversations', () => api.request(R.chat.list), force),
    offline: () => offlineCopy('conversations') || [],
    get: id => api.request(R.chat.get, { params: { id } }),
    send: body => api.request(R.chat.send, { body }).then(r => { changed('conversations'); return r; }),
    stream: (body, signal) => api.stream(body, signal),
    remove: id => api.request(R.chat.remove, { params: { id } }).then(r => { changed('conversations'); return r; }),
    setCard: (id, mid, cid, body) => api.request(R.chat.cardStatus, { params: { id, mid, cid }, body }),
    touched: () => changed('conversations')
  };

  const memory = {
    list: force => cached('memories', () => api.request(R.memory.list), force),
    offline: () => offlineCopy('memories') || [],
    search: (q, type) => api.request(R.memory.search, { query: { q, type } }),
    create: m => api.request(R.memory.create, { body: m }).then(r => { changed('memories', r); return r; }),
    update: (id, patch) => api.request(R.memory.update, { params: { id }, body: patch }).then(r => { changed('memories', r); return r; }),
    remove: id => api.request(R.memory.remove, { params: { id } }).then(r => { changed('memories'); return r; })
  };

  const people = {
    list: force => cached('people', () => api.request(R.people.list), force),
    offline: () => offlineCopy('people') || [],
    get: id => api.request(R.people.get, { params: { id } }),
    create: p => api.request(R.people.create, { body: p }).then(r => { changed('people', r); return r; }),
    update: (id, patch) => api.request(R.people.update, { params: { id }, body: patch }).then(r => { changed('people', r); return r; }),
    remove: id => api.request(R.people.remove, { params: { id } }).then(r => { changed('people'); changed('memories'); changed('tasks'); return r; })
  };

  const tasks = {
    list: force => cached('tasks', () => api.request(R.tasks.list), force),
    offline: () => offlineCopy('tasks') || [],
    create: t => api.request(R.tasks.create, { body: Object.assign({ timezone: A.settings.get('timezone') }, t) }).then(r => { changed('tasks', r); return r; }),
    update: (id, patch) => api.request(R.tasks.update, { params: { id }, body: patch }).then(r => { changed('tasks', r); return r; }),
    complete: (id, done = true) => api.request(R.tasks.update, { params: { id }, body: { done } }).then(r => { changed('tasks', r); return r; }),
    remove: id => api.request(R.tasks.remove, { params: { id } }).then(r => { changed('tasks'); return r; })
  };

  const events = {
    list: force => cached('events', () => api.request(R.events.list), force),
    create: e => api.request(R.events.create, { body: e }).then(r => { changed('events', r); return r; }),
    update: (id, patch) => api.request(R.events.update, { params: { id }, body: patch }).then(r => { changed('events', r); return r; }),
    remove: id => api.request(R.events.remove, { params: { id } }).then(r => { changed('events'); return r; })
  };

  const proactive = {
    list: () => api.request(R.proactive.list, { query: { frequency: A.settings.get('proactiveFrequency') } }),
    accept: id => api.request(R.proactive.accept, { params: { id } }).then(r => { changed('tasks'); A.bus.emit('data:proactive'); return r; }),
    dismiss: id => api.request(R.proactive.dismiss, { params: { id } }).then(r => { A.bus.emit('data:proactive'); return r; }),
    snooze: (id, hours = 24) => api.request(R.proactive.snooze, { params: { id }, body: { hours } }).then(r => { A.bus.emit('data:proactive'); return r; })
  };

  const agents = {
    list: () => api.request(R.agents.list),
    create: a => api.request(R.agents.create, { body: a }),
    update: (id, patch) => api.request(R.agents.update, { params: { id }, body: patch }),
    remove: id => api.request(R.agents.remove, { params: { id } }),
    run: id => api.request(R.agents.run, { params: { id } }),
    runs: id => api.request(R.agents.runs, { params: { id } }),
    stop: id => api.request(R.agents.stop, { params: { id } })
  };

  const documents = {
    list: () => api.request(R.documents.list),
    create: d => api.request(R.documents.create, { body: d }),
    update: (id, patch) => api.request(R.documents.update, { params: { id }, body: patch }),
    remove: id => api.request(R.documents.remove, { params: { id } })
  };

  const alarms = {
    list: force => cached('alarms', () => api.request(R.alarms.list), force),
    create: a => api.request(R.alarms.create, { body: Object.assign({ timezone: A.settings.get('timezone') }, a) }).then(r => { changed('alarms', r); return r; }),
    update: (id, patch) => api.request(R.alarms.update, { params: { id }, body: patch }).then(r => { changed('alarms', r); return r; }),
    remove: id => api.request(R.alarms.remove, { params: { id } }).then(r => { changed('alarms'); return r; }),
    dismiss: id => api.request(R.alarms.dismiss, { params: { id } }).then(r => { changed('alarms', r); return r; }),
    snooze: (id, minutes = 10) => api.request(R.alarms.snooze, { params: { id }, body: { minutes } }).then(r => { changed('alarms', r); return r; })
  };

  const finance = {
    transactions: q => api.request(R.finance.transactions, { query: q }),
    addTx: t => api.request(R.finance.addTx, { body: t }).then(r => { changed('finance', r); return r; }),
    updateTx: (id, patch) => api.request(R.finance.updateTx, { params: { id }, body: patch }).then(r => { changed('finance', r); return r; }),
    removeTx: id => api.request(R.finance.removeTx, { params: { id } }).then(r => { changed('finance'); return r; }),
    debts: q => api.request(R.finance.debts, { query: q }),
    addDebt: d => api.request(R.finance.addDebt, { body: d }).then(r => { changed('finance', r); return r; }),
    updateDebt: (id, patch) => api.request(R.finance.updateDebt, { params: { id }, body: patch }).then(r => { changed('finance', r); return r; }),
    repay: (id, amount) => api.request(R.finance.repay, { params: { id }, body: { amount: amount || null } }).then(r => { changed('finance', r); return r; }),
    removeDebt: id => api.request(R.finance.removeDebt, { params: { id } }).then(r => { changed('finance'); return r; }),
    summary: month => api.request(R.finance.summary, { query: { month } })
  };

  const push = {
    key: () => api.request(R.push.key),
    subscribe: sub => api.request(R.push.subscribe, { body: sub }),
    unsubscribe: endpoint => api.request(R.push.unsubscribe, { body: { endpoint } }),
    test: () => api.request(R.push.test)
  };

  const calendar = {
    feed: () => api.request(R.calendar.feed),
    enableFeed: () => api.request(R.calendar.enableFeed),
    disableFeed: () => api.request(R.calendar.disableFeed),
    importIcs: ics => api.request(R.calendar.importIcs, { body: { ics } }).then(r => { changed('events'); return r; })
  };

  /* Card confirmation = executing the AI-proposed tool call through the regular, permission-checked API */
  const actions = {
    async confirmEventCard(data) {
      const e = await events.create({ title: data.title, startAt: data.startAt, endAt: data.endAt, location: data.location || '', remindMinutes: data.remindMinutes == null ? 15 : data.remindMinutes, personId: data.personId || null });
      return { eventId: e.id };
    },
    async confirmEventUpdateCard(data) {
      if (data.cancel) { await events.remove(data.eventId); return { eventId: data.eventId, cancelled: true }; }
      await events.update(data.eventId, { startAt: data.startAt, endAt: data.endAt });
      return { eventId: data.eventId };
    },
    async confirmAlarmCard(data) {
      const a = await alarms.create({ hour: data.hour, minute: data.minute, days: data.days || [], label: data.label || '' });
      return { alarmId: a.id, nextAt: a.nextAt };
    },
    async confirmFinanceCard(data) {
      const t = await finance.addTx({ kind: data.kind, amount: data.amount, currency: data.currency || 'RUB', category: data.category, note: data.note || '', occurredAt: data.occurredAt, personId: data.personId || null });
      return { transactionId: t.id };
    },
    async confirmDebtCard(data) {
      const d = await finance.addDebt({ direction: data.direction, amount: data.amount, currency: data.currency || 'RUB', personId: data.personId || null, counterparty: data.counterparty || '', dueAt: data.dueAt || null, note: data.note || '' });
      return { debtId: d.id };
    },
    async confirmDebtRepayCard(data) {
      const d = await finance.repay(data.debtId, data.full ? null : data.amount);
      return { debtId: d.id, left: d.left, closed: d.status === 'closed' };
    },
    async confirmAlarmUpdateCard(data) {
      await alarms.update(data.alarmId, { enabled: data.enabled });
      return { alarmId: data.alarmId };
    },
    async confirmMemoryCard(data, source) {
      let personId = data.existingPersonId || null;
      if (data.person) {
        const input = Object.assign({}, data.person);
        if (personId) { input.id = personId; input.interaction = data.memory.content; delete input.name; delete input.metAt; }
        const p = await people.create(Object.assign({ name: data.person.name }, input));
        personId = p.id;
      }
      const m = await memory.create(Object.assign({}, data.memory, { personId: personId || data.memory.personId || null, source }));
      return { personId, memoryId: m.id };
    },
    async confirmTaskCard(data, source) {
      const t = await tasks.create({ title: data.title, dueAt: data.dueAt, repeat: data.repeat || 'none', remind: true, personId: data.personId, source });
      return { taskId: t.id };
    }
  };

  A.repo = { auth, chat, memory, people, tasks, events, proactive, agents, documents, alarms, finance, push, calendar, actions, invalidate: changed };
})(window.Adis);
