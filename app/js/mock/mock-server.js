/* DEMO MODE: in-browser emulation of the Adis REST API (TZ §9).
 * Same request/response contract as the future FastAPI backend, so switching to the real server
 * only requires changing API mode in settings. */
(function (A) {
  'use strict';
  const U = A.util;
  const DB = A.mockDb;
  const E = (code, msg, status) => { throw new A.ApiError(code, msg, status); };
  const iso = () => new Date().toISOString();

  const routes = [];
  const route = (spec, handler, opts = {}) => {
    const [method, path] = spec.split(' ');
    const keys = [];
    const rx = new RegExp('^' + path.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, rx, keys, handler, auth: opts.auth !== false });
  };

  function session(token) {
    const s = token && DB.get().sessions[token];
    if (!s) E('unauthorized', 'Unauthorized', 401);
    if (new Date(s.expiresAt) < Date.now()) { delete DB.get().sessions[token]; E('unauthorized', 'Token expired', 401); }
    const user = DB.get().users.find(u => u.id === s.userId);
    if (!user) E('unauthorized', 'Unauthorized', 401);
    return { user, d: DB.userData(user.id), tools: A.mockTools.make(DB.userData(user.id)) };
  }

  function issueTokens(user, device) {
    const db = DB.get();
    const accessToken = 'demo_at_' + U.uid('s');
    const refreshToken = 'demo_rt_' + U.uid('r');
    db.sessions[accessToken] = { userId: user.id, expiresAt: new Date(Date.now() + 3600 * 1000).toISOString() };
    db.refresh[refreshToken] = { userId: user.id };
    const d = DB.userData(user.id);
    const name = device || deviceName();
    const existing = d.devices.find(x => x.name === name);
    if (existing) existing.lastActiveAt = iso(); else d.devices.push({ id: U.uid('dev'), name, lastActiveAt: iso(), current: true });
    return { accessToken, refreshToken, expiresIn: 3600, user: A.dto.user(user) };
  }

  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'Устройство';
    const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : /Firefox/.test(ua) ? 'Firefox' : 'Браузер';
    return `${os} · ${br}`;
  }

  function validateEmail(email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) E('validation', 'Введите корректный email', 422); }

  /* ---------- Auth ---------- */
  route('POST /auth/register', async ({ body }) => {
    const db = DB.get();
    const email = String(body.email || '').trim().toLowerCase();
    validateEmail(email);
    if (!body.name || body.name.trim().length < 2) E('validation', 'Введите имя', 422);
    if (!body.password || body.password.length < 8) E('validation', 'Пароль должен быть не короче 8 символов', 422);
    if (db.users.some(u => u.email === email)) E('conflict', 'Пользователь с таким email уже существует', 409);
    const user = { id: U.uid('u'), name: body.name.trim(), email, passHash: await U.hash(email + ':' + body.password), createdAt: iso() };
    db.users.push(user);
    DB.userData(user.id).agents = DB.demoAgents();
    return issueTokens(user);
  }, { auth: false });

  route('POST /auth/login', async ({ body }) => {
    const db = DB.get();
    const email = String(body.email || '').trim().toLowerCase();
    validateEmail(email);
    let user = db.users.find(u => u.email === email);
    if (body.demo && !user) {
      user = { id: U.uid('u'), name: 'Алексей', email, passHash: await U.hash(email + ':' + body.password), createdAt: iso(), demo: true };
      db.users.push(user); DB.seedDemo(user.id);
    }
    if (!user || user.passHash !== await U.hash(email + ':' + (body.password || ''))) E('validation', 'Неверный email или пароль', 401);
    return issueTokens(user);
  }, { auth: false });

  route('POST /auth/refresh', ({ body }) => {
    const db = DB.get();
    const r = db.refresh[body.refreshToken];
    if (!r) E('unauthorized', 'Invalid refresh token', 401);
    delete db.refresh[body.refreshToken];
    const user = db.users.find(u => u.id === r.userId);
    if (!user) E('unauthorized', 'Unauthorized', 401);
    return issueTokens(user);
  }, { auth: false });

  route('POST /auth/logout', ({ token, body }) => {
    const db = DB.get(); delete db.sessions[token]; if (body && body.refreshToken) delete db.refresh[body.refreshToken]; return { ok: true };
  }, { auth: false });

  route('POST /auth/password/forgot', ({ body }) => {
    validateEmail(String(body.email || '').trim());
    return { ok: true, demoNote: 'В демо-режиме письмо не отправляется.' };
  }, { auth: false });

  route('POST /auth/password/reset', () => E('validation', 'В демо-режиме письма не отправляются, поэтому ссылка для сброса недействительна.', 400), { auth: false });

  route('POST /auth/password/change', async ({ s, body }) => {
    if (s.user.passHash !== await U.hash(s.user.email + ':' + (body.current || ''))) E('validation', 'Текущий пароль неверен', 422);
    if (!body.next || body.next.length < 8) E('validation', 'Новый пароль должен быть не короче 8 символов', 422);
    s.user.passHash = await U.hash(s.user.email + ':' + body.next); return { ok: true };
  });

  route('GET /users/me', ({ s }) => A.dto.user(s.user));
  route('PATCH /users/me', ({ s, body }) => {
    ['name', 'assistantName', 'avatar'].forEach(k => { if (body[k] !== undefined) s.user[k] = body[k]; });
    return A.dto.user(s.user);
  });
  route('DELETE /users/me', ({ s, token }) => {
    const db = DB.get();
    db.users = db.users.filter(u => u.id !== s.user.id);
    delete db.data[s.user.id];
    Object.keys(db.sessions).forEach(k => { if (db.sessions[k].userId === s.user.id) delete db.sessions[k]; });
    Object.keys(db.refresh).forEach(k => { if (db.refresh[k].userId === s.user.id) delete db.refresh[k]; });
    return { ok: true, token };
  });
  route('GET /users/me/devices', ({ s }) => s.d.devices.map(x => Object.assign({}, x, { current: x.name === deviceName() })));
  route('GET /users/me/export', ({ s }) => ({ exportedAt: iso(), user: A.dto.user(s.user), data: U.clone(Object.assign({}, s.d, { devices: undefined })) }));

  /* ---------- Chat ---------- */
  function convSummary(c) {
    const last = c.messages[c.messages.length - 1];
    return { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, lastMessage: last ? (last.content.replace(/[*#`>_-]/g, '').slice(0, 90) || ((last.attachments || []).some(a => a.image) ? 'Фото' : '')) : '', count: c.messages.length };
  }

  function prepareTurn(s, body) {
    const content = String(body.content || '').trim();
    const attachments = (body.attachments || []).slice(0, 5).map(f => ({ name: f.name, size: f.size, type: f.type, text: f.text, width: f.width, height: f.height, image: typeof f.image === 'string' && f.image.startsWith('data:image/') && f.image.length < 1500000 ? f.image : undefined }));
    if (!content && !attachments.length && !body.regenerate) E('validation', 'Пустое сообщение', 422);
    if (content.length > 8000) E('validation', 'Сообщение слишком длинное', 422);
    let conv = body.conversationId && s.d.conversations.find(c => c.id === body.conversationId);
    if (body.conversationId && !conv) E('not_found', 'Conversation not found', 404);
    if (!conv) {
      conv = { id: U.uid('cv'), title: (content || (attachments[0] && (attachments[0].image ? 'Фото' : attachments[0].name)) || 'Новый чат').slice(0, 48), createdAt: iso(), updatedAt: iso(), messages: [] };
      s.d.conversations.unshift(conv);
    }
    let userMsg;
    if (body.regenerate) {
      const lastIdx = conv.messages.length - 1;
      if (lastIdx >= 0 && conv.messages[lastIdx].role === 'assistant') conv.messages.pop();
      userMsg = [...conv.messages].reverse().find(m => m.role === 'user');
      if (!userMsg) E('validation', 'Нечего генерировать заново', 422);
    } else {
      if (body.clientMessageId && conv.messages.some(m => m.clientMessageId === body.clientMessageId)) E('conflict', 'Сообщение уже отправлено', 409);
      userMsg = { id: U.uid('msg'), role: 'user', content, attachments: attachments.map(({ name, size, type, image, width, height }) => ({ name, size, type, image, width, height })), createdAt: iso(), clientMessageId: body.clientMessageId, source: body.source || 'text' };
      conv.messages.push(userMsg);
    }
    const reply = A.aiEngine.respond({
      d: s.d, user: s.user, text: userMsg.content, attachments: body.regenerate ? [] : attachments,
      autoSave: !!body.autoSave, sensitiveGuard: body.sensitiveGuard !== false, variant: body.regenerate ? Math.floor(Math.random() * 3) + 1 : 0,
      conversationId: conv.id, source: body.source
    });
    const assistantMsg = { id: U.uid('msg'), role: 'assistant', content: reply.content, cards: reply.cards, toolCalls: reply.toolCalls, createdAt: iso(), engine: 'demo' };
    return { conv, userMsg, assistantMsg };
  }

  route('POST /chat/messages', ({ s, body }) => {
    const { conv, userMsg, assistantMsg } = prepareTurn(s, body);
    conv.messages.push(assistantMsg); conv.updatedAt = iso();
    return { conversation: convSummary(conv), userMessage: userMsg, assistantMessage: assistantMsg };
  });

  route('GET /chat/conversations', ({ s }) => s.d.conversations.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(convSummary));
  route('GET /chat/conversations/{id}', ({ s, params }) => {
    const c = s.d.conversations.find(x => x.id === params.id); if (!c) E('not_found', 'Not found', 404); return c;
  });
  route('DELETE /chat/conversations/{id}', ({ s, params }) => {
    s.d.conversations = s.d.conversations.filter(x => x.id !== params.id); return { ok: true };
  });
  route('PATCH /chat/conversations/{id}/messages/{mid}/cards/{cid}', ({ s, params, body }) => {
    const c = s.d.conversations.find(x => x.id === params.id); if (!c) E('not_found', 'Not found', 404);
    const m = c.messages.find(x => x.id === params.mid); if (!m) E('not_found', 'Not found', 404);
    const cd = (m.cards || []).find(x => x.id === params.cid); if (!cd) E('not_found', 'Not found', 404);
    Object.assign(cd, { status: body.status || cd.status, result: body.result || cd.result, data: body.data || cd.data });
    return cd;
  });

  /* ---------- Memory ---------- */
  route('GET /memory', ({ s, query }) => {
    let list = s.d.memories.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.type) list = list.filter(m => m.type === query.type);
    if (query.personId) list = list.filter(m => m.personId === query.personId);
    return list;
  });
  route('GET /memory/search', ({ s, query }) => s.tools.memory_search({ query: query.q || '', types: query.type ? [query.type] : null, limit: 50 }));
  route('POST /memory', ({ s, body }) => {
    if (!(body.title || body.content)) E('validation', 'Заполните запись', 422);
    return s.tools.memory_save(body);
  });
  route('PATCH /memory/{id}', ({ s, params, body }) => s.tools.memory_update(params.id, body) || E('not_found', 'Not found', 404));
  route('DELETE /memory/{id}', ({ s, params }) => s.tools.memory_delete(params.id) ? { ok: true } : E('not_found', 'Not found', 404));

  /* ---------- People ---------- */
  route('GET /people', ({ s }) => s.tools.entity_lookup({}));
  route('GET /people/{id}', ({ s, params }) => s.d.people.find(p => p.id === params.id) || E('not_found', 'Not found', 404));
  route('POST /people', ({ s, body }) => {
    if (!body.name || !body.name.trim()) E('validation', 'Введите имя', 422);
    return s.tools.person_save(body);
  });
  route('PATCH /people/{id}', ({ s, params, body }) => s.tools.person_update(params.id, body) || E('not_found', 'Not found', 404));
  route('DELETE /people/{id}', ({ s, params }) => s.tools.person_delete(params.id) ? { ok: true } : E('not_found', 'Not found', 404));

  /* ---------- Tasks ---------- */
  route('GET /tasks', ({ s }) => s.d.tasks.map(A.dto.task));
  route('POST /tasks', ({ s, body }) => {
    if (!body.title || !body.title.trim()) E('validation', 'Введите название', 422);
    return A.dto.task(s.tools.task_create(body));
  });
  route('PATCH /tasks/{id}', ({ s, params, body }) => {
    let t;
    if (body.done !== undefined && Object.keys(body).length === 1) t = s.tools.task_complete(params.id, body.done);
    else { t = s.tools.task_update(params.id, body); if (t && body.dueAt && t.remind) s.tools.notification_schedule({ taskId: t.id, at: body.dueAt }); }
    return t ? A.dto.task(t) : E('not_found', 'Not found', 404);
  });
  route('DELETE /tasks/{id}', ({ s, params }) => s.tools.task_delete(params.id) ? { ok: true } : E('not_found', 'Not found', 404));

  /* ---------- Events ---------- */
  route('GET /events', ({ s }) => s.d.events.slice().sort((a, b) => a.startAt.localeCompare(b.startAt)));
  route('POST /events', ({ s, body }) => {
    if (!body.title || !body.startAt) E('validation', 'Укажите название и время', 422);
    const e = Object.assign({ id: U.uid('e'), location: '', notes: '', remindMinutes: 15, createdAt: iso(), updatedAt: iso() }, body);
    if (!e.endAt) e.endAt = new Date(new Date(e.startAt).getTime() + 3600000).toISOString();
    s.d.events.push(e); return e;
  });
  route('PATCH /events/{id}', ({ s, params, body }) => {
    const e = s.d.events.find(x => x.id === params.id); if (!e) E('not_found', 'Not found', 404);
    return Object.assign(e, body, { id: e.id, updatedAt: iso() });
  });
  route('DELETE /events/{id}', ({ s, params }) => { s.d.events = s.d.events.filter(x => x.id !== params.id); return { ok: true }; });

  /* ---------- Proactive ---------- */
  route('GET /proactive/suggestions', ({ s, query }) => {
    if (query.frequency === 'off') return [];
    const list = s.tools.proactive_suggestion();
    return query.frequency === 'rare' ? list.slice(0, 2) : list;
  });
  route('POST /proactive/{id}/accept', ({ s, params }) => {
    const sug = s.tools.proactive_suggestion().find(x => x.id === params.id);
    s.d.suggestionState[params.id] = { status: 'accepted', at: iso() };
    let result = null;
    if (sug && sug.action.type === 'reschedule_task') {
      const t = s.d.tasks.find(x => x.id === sug.action.taskId);
      if (t) { const d = U.addDays(new Date(), 1); const old = new Date(t.dueAt); d.setHours(old.getHours(), old.getMinutes(), 0, 0); result = A.dto.task(s.tools.task_update(t.id, { dueAt: d.toISOString() })); }
    } else if (sug && sug.action.type === 'create_task') {
      const d = U.addDays(new Date(), 1); d.setHours(10, 0, 0, 0);
      result = A.dto.task(s.tools.task_create({ title: sug.action.title, personId: sug.action.personId, dueAt: d.toISOString() }));
    }
    return { ok: true, action: sug ? sug.action : null, result };
  });
  route('POST /proactive/{id}/dismiss', ({ s, params }) => { s.d.suggestionState[params.id] = { status: 'dismissed', at: iso() }; return { ok: true }; });
  route('POST /proactive/{id}/snooze', ({ s, params, body }) => {
    s.d.suggestionState[params.id] = { status: 'snoozed', until: new Date(Date.now() + (body.hours || 24) * 3600000).toISOString() }; return { ok: true };
  });

  /* ---------- Agents ---------- */
  route('GET /agents', ({ s }) => s.d.agents);
  route('POST /agents', ({ s, body }) => {
    if (!body.name || !body.name.trim()) E('validation', 'Введите название агента', 422);
    const a = { id: U.uid('ag'), name: body.name.trim(), description: body.description || '', instructions: body.instructions || '', tools: body.tools || [], icon: 'bot', demo: false, builtin: null, createdAt: iso() };
    s.d.agents.push(a); return a;
  });
  route('PATCH /agents/{id}', ({ s, params, body }) => {
    const a = s.d.agents.find(x => x.id === params.id); if (!a) E('not_found', 'Not found', 404);
    ['name', 'description', 'instructions', 'tools'].forEach(k => { if (body[k] !== undefined) a[k] = body[k]; }); return a;
  });
  route('DELETE /agents/{id}', ({ s, params }) => { s.d.agents = s.d.agents.filter(x => x.id !== params.id); s.d.agentRuns = s.d.agentRuns.filter(r => r.agentId !== params.id); return { ok: true }; });
  route('GET /agents/{id}/runs', ({ s, params }) => s.d.agentRuns.filter(r => r.agentId === params.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
  route('POST /agents/{id}/runs', ({ s, params }) => {
    const a = s.d.agents.find(x => x.id === params.id); if (!a) E('not_found', 'Not found', 404);
    const run = { id: U.uid('run'), agentId: a.id, status: 'completed', startedAt: iso(), finishedAt: iso(), steps: [], result: '' };
    Object.assign(run, A.agentRunner.run(a, s.d, s.user));
    s.d.agentRuns.unshift(run); return run;
  });
  route('POST /agents/runs/{id}/stop', ({ s, params }) => {
    const r = s.d.agentRuns.find(x => x.id === params.id); if (r) { r.status = 'stopped'; r.result = r.result || 'Остановлено пользователем.'; }
    return r || { ok: true };
  });

  /* ---------- Alarms (same rules as server/adis/services/alarms.py, in the device time zone) ---------- */
  function alarmNext(a, after = new Date()) {
    if (!a.enabled) return null;
    for (let i = 0; i < 8; i++) {
      const d = U.addDays(after, i); d.setHours(a.hour, a.minute, 0, 0);
      if (d > after && (!a.days.length || a.days.includes(d.getDay()))) return d.toISOString();
    }
    return null;
  }
  const alarmDue = a => (a.enabled ? [a.nextAt, a.snoozeUntil].filter(Boolean).sort()[0] || null : null);
  function alarmFire(a) {
    const ring = alarmDue(a) || iso();
    Object.assign(a, { ringAt: ring, ackedAt: null, snoozeUntil: null, updatedAt: iso() });
    if (a.days.length) a.nextAt = alarmNext(a, new Date(Math.max(Date.now(), new Date(ring).getTime())));
    else Object.assign(a, { enabled: false, nextAt: null });
  }
  function alarmOut(a) {
    const due = alarmDue(a);
    if (due && new Date(due) < Date.now() - 10 * 60000) { alarmFire(a); }  // missed while the app was closed
    const ringing = !!(a.ringAt && Date.now() - new Date(a.ringAt) < 10 * 60000 && (!a.ackedAt || a.ackedAt < a.ringAt));
    return Object.assign({}, a, { time: `${U.pad(a.hour)}:${U.pad(a.minute)}`, daysLabel: A.nlu.describeDays(a.days), nextAt: alarmDue(a), ringing });
  }
  const findAlarm = (s, id) => s.d.alarms.find(x => x.id === id) || E('not_found', 'Not found', 404);
  const fireIfDue = a => { const due = alarmDue(a); if (due && new Date(due) <= Date.now()) alarmFire(a); };
  route('GET /alarms', ({ s }) => s.d.alarms.map(alarmOut).sort((a, b) => a.time.localeCompare(b.time)));
  route('POST /alarms', ({ s, body }) => {
    if (!(body.hour >= 0 && body.hour <= 23)) E('validation', 'Укажите время', 422);
    const a = { id: U.uid('al'), hour: +body.hour, minute: +(body.minute || 0), days: Array.from(new Set((body.days || []).map(Number))).filter(d => d >= 0 && d <= 6).sort(), label: (body.label || '').slice(0, 120), enabled: body.enabled !== false, snoozeUntil: null, ringAt: null, ackedAt: null, createdAt: iso(), updatedAt: iso() };
    a.nextAt = alarmNext(a); s.d.alarms.push(a); return alarmOut(a);
  });
  route('PATCH /alarms/{id}', ({ s, params, body }) => {
    const a = findAlarm(s, params.id);
    ['hour', 'minute', 'label', 'enabled'].forEach(k => { if (body[k] !== undefined && body[k] !== null) a[k] = body[k]; });
    if (body.days) a.days = Array.from(new Set(body.days.map(Number))).sort();
    if (['hour', 'minute', 'days', 'enabled'].some(k => k in body)) { a.snoozeUntil = null; a.nextAt = alarmNext(a); }
    a.updatedAt = iso(); return alarmOut(a);
  });
  route('DELETE /alarms/{id}', ({ s, params }) => { s.d.alarms = s.d.alarms.filter(x => x.id !== params.id); return { ok: true }; });
  route('POST /alarms/{id}/dismiss', ({ s, params }) => { const a = findAlarm(s, params.id); fireIfDue(a); a.ackedAt = iso(); return alarmOut(a); });
  route('POST /alarms/{id}/snooze', ({ s, params, body }) => {
    const a = findAlarm(s, params.id); fireIfDue(a);
    Object.assign(a, { ackedAt: iso(), snoozeUntil: new Date(Date.now() + (body.minutes || 10) * 60000).toISOString(), enabled: true });
    return alarmOut(a);
  });

  /* ---------- Finance (same contract as server/adis/routers/finance.py) ---------- */
  const fin = s => A.mockFinance.make(s.d);
  route('GET /finance/transactions', ({ s, query }) => fin(s).transactions(query));
  route('POST /finance/transactions', ({ s, body }) => { if (!(+body.amount > 0)) E('validation', 'Введите сумму', 422); return fin(s).addTx(body); });
  route('PATCH /finance/transactions/{id}', ({ s, params, body }) => {
    const t = s.d.transactions.find(x => x.id === params.id) || E('not_found', 'Not found', 404);
    ['kind', 'category', 'note', 'currency', 'occurredAt', 'personId'].forEach(k => { if (body[k] !== undefined) t[k] = body[k]; });
    if (body.amount) t.amount = Math.round(+body.amount * 100) / 100;
    t.updatedAt = iso(); return t;
  });
  route('DELETE /finance/transactions/{id}', ({ s, params }) => { s.d.transactions = s.d.transactions.filter(x => x.id !== params.id); return { ok: true }; });
  route('GET /finance/debts', ({ s, query }) => fin(s).debts(query));
  route('POST /finance/debts', ({ s, body }) => {
    if (!(+body.amount > 0)) E('validation', 'Введите сумму', 422);
    if (!body.personId && !(body.counterparty || '').trim()) E('validation', 'Укажите, кто должен или кому вы должны', 422);
    return fin(s).addDebt(body);
  });
  route('PATCH /finance/debts/{id}', ({ s, params, body }) => {
    const x = s.d.debts.find(y => y.id === params.id) || E('not_found', 'Not found', 404);
    ['counterparty', 'note', 'remind', 'dueAt', 'personId'].forEach(k => { if (body[k] !== undefined) x[k] = body[k]; });
    if (body.amount) x.amount = +body.amount;
    if (body.status) { x.status = body.status; x.closedAt = body.status === 'closed' ? iso() : null; }
    return fin(s).debts().find(y => y.id === x.id);
  });
  route('POST /finance/debts/{id}/repay', ({ s, params, body }) => fin(s).repay(params.id, body.amount) || E('not_found', 'Not found', 404));
  route('DELETE /finance/debts/{id}', ({ s, params }) => { s.d.debts = s.d.debts.filter(x => x.id !== params.id); return { ok: true }; });
  route('GET /finance/summary', ({ s, query }) => {
    const now = new Date();
    const [y, m] = query.month ? query.month.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1];
    if (!(m >= 1 && m <= 12)) E('validation', 'Месяц в формате ГГГГ-ММ', 422);
    const start = new Date(y, m - 1, 1), end = new Date(y, m, 1);
    return Object.assign({ month: `${y}-${U.pad(m)}` }, fin(s).summary(start, end));
  });

  /* ---------- Push & calendar sync need the real server ---------- */
  const needServer = what => () => E('not_supported', `${what} работает при подключении к AI Backend (Профиль → Подключение).`, 501);
  route('GET /push/vapid-key', needServer('Push-уведомление'));
  route('POST /push/subscriptions', needServer('Push-уведомление'));
  route('POST /push/unsubscribe', () => ({ ok: true }));
  route('POST /push/test', needServer('Push-уведомление'));
  route('GET /calendar/feed', () => ({ enabled: false, demo: true }));
  route('POST /calendar/feed', needServer('Подписка календаря'));
  route('DELETE /calendar/feed', () => ({ enabled: false }));
  route('POST /calendar/import', needServer('Импорт календаря'));

  /* ---------- Documents ---------- */
  route('GET /documents', ({ s }) => s.d.documents.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  route('POST /documents', ({ s, body }) => { const doc = { id: U.uid('doc'), title: body.title || 'Без названия', content: body.content || '', createdAt: iso(), updatedAt: iso() }; s.d.documents.unshift(doc); return doc; });
  route('PATCH /documents/{id}', ({ s, params, body }) => {
    const doc = s.d.documents.find(x => x.id === params.id); if (!doc) E('not_found', 'Not found', 404);
    ['title', 'content'].forEach(k => { if (body[k] !== undefined) doc[k] = body[k]; }); doc.updatedAt = iso(); return doc;
  });
  route('DELETE /documents/{id}', ({ s, params }) => { s.d.documents = s.d.documents.filter(x => x.id !== params.id); return { ok: true }; });

  /* ---------- Dispatcher ---------- */
  async function latency() {
    const st = A.settings.get();
    await U.sleep(st.simulateSlowNetwork ? 1800 + Math.random() * 1200 : 120 + Math.random() * 220);
    if (st.simulateNetworkErrors && Math.random() < 0.35) throw new A.ApiError('network', 'Simulated network error');
  }

  async function handle(method, fullPath, body, token) {
    await latency();
    const [path, qs] = fullPath.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const r = routes.find(x => x.method === method && x.rx.test(path));
    if (!r) E('not_found', `No route ${method} ${path}`, 404);
    const m = path.match(r.rx);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const s = r.auth ? session(token) : null;
    const res = await r.handler({ s, params, query, body: body || {}, token });
    DB.save();
    return U.clone(res);
  }

  /* Streaming emulation of POST /chat/stream (SSE in production) */
  async function* stream(body, token, signal) {
    await latency();
    const s = session(token);
    const { conv, userMsg, assistantMsg } = prepareTurn(s, body);
    DB.save();
    yield { type: 'start', conversation: convSummary(conv), userMessage: U.clone(userMsg), messageId: assistantMsg.id };
    yield { type: 'status', text: 'Adis думает…' };
    await U.sleep(450);
    const toolLabels = { memory_search: 'Ищу в памяти…', entity_lookup: 'Ищу людей…', task_create: 'Готовлю напоминание…', memory_save: 'Сохраняю в память…', notification_schedule: '' };
    for (const tc of assistantMsg.toolCalls || []) {
      if (!toolLabels[tc.name]) continue;
      yield { type: 'status', text: toolLabels[tc.name], tool: tc.name };
      await U.sleep(380);
    }
    const tokens = assistantMsg.content.match(/\s*\S+/g) || [];
    let acc = '';
    for (let i = 0; i < tokens.length; i++) {
      if (signal && signal.aborted) {
        assistantMsg.content = acc + ' …'; assistantMsg.cards = []; assistantMsg.stopped = true;
        conv.messages.push(assistantMsg); conv.updatedAt = iso(); DB.save();
        yield { type: 'done', message: U.clone(assistantMsg), conversation: convSummary(conv) };
        return;
      }
      acc += tokens[i];
      yield { type: 'delta', text: tokens[i] };
      await U.sleep(tokens[i].includes('\n') ? 30 : 22 + Math.random() * 30);
    }
    conv.messages.push(assistantMsg); conv.updatedAt = iso(); DB.save();
    yield { type: 'done', message: U.clone(assistantMsg), conversation: convSummary(conv) };
  }

  A.mockServer = { handle, stream };
})(window.Adis);
