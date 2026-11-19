/* DEMO MODE ONLY. Local database that emulates the future PostgreSQL backend.
 * Everything stored here lives only on this device and is clearly marked "Демо" in the UI. */
(function (A) {
  'use strict';
  const U = A.util;
  const KEY = 'mockdb.v1';

  let db = A.storage.get(KEY) || { users: [], sessions: {}, refresh: {}, data: {}, resetCodes: {} };

  function save() { A.storage.set(KEY, db); }

  function emptyData() {
    return { conversations: [], memories: [], people: [], tasks: [], events: [], alarms: [], transactions: [], debts: [], suggestionState: {}, agents: [], agentRuns: [], documents: [], devices: [] };
  }

  function userData(userId) {
    if (!db.data[userId]) db.data[userId] = emptyData();
    const d = db.data[userId];
    Object.keys(emptyData()).forEach(k => { if (!d[k]) d[k] = emptyData()[k]; });
    return d;
  }

  function at(daysFromNow, h, m = 0) {
    const d = U.addDays(new Date(), daysFromNow); d.setHours(h, m, 0, 0); return d.toISOString();
  }

  const DEMO_AGENTS = () => [
    { id: U.uid('ag'), name: 'Планировщик дня', icon: 'calendar', demo: true, builtin: 'planner', description: 'Собирает план на день из задач, событий и напоминаний с учётом твоих предпочтений.', instructions: 'Составь реалистичный план дня. Учитывай предпочтения по времени встреч.', tools: ['memory_search', 'task_update'], createdAt: new Date().toISOString() },
    { id: U.uid('ag'), name: 'Нетворкинг-ассистент', icon: 'users', demo: true, builtin: 'network', description: 'Подсказывает, с кем из знакомых стоит связаться, и готовит короткое сообщение.', instructions: 'Найди людей, с которыми давно не было контакта.', tools: ['entity_lookup', 'task_create'], createdAt: new Date().toISOString() },
    { id: U.uid('ag'), name: 'Аналитик памяти', icon: 'memory', demo: true, builtin: 'memory', description: 'Анализирует личную память: что запомнено, что требует подтверждения, какие темы важны.', instructions: 'Проанализируй структуру памяти.', tools: ['memory_search'], createdAt: new Date().toISOString() },
    { id: U.uid('ag'), name: 'Недельный отчёт', icon: 'report', demo: true, builtin: 'weekly', description: 'Готовит отчёт за неделю: выполненные задачи, новые знакомства, планы.', instructions: 'Сформируй отчёт за последние 7 дней.', tools: ['memory_search', 'entity_lookup'], createdAt: new Date().toISOString() }
  ];

  function seedDemo(userId) {
    const d = userData(userId);
    const now = new Date().toISOString();
    const src = (excerpt, kind = 'chat') => ({ kind, excerpt, conversationId: null });

    const maria = { id: U.uid('p'), name: 'Мария Ковалёва', photo: null, profession: 'Дизайнер', skills: ['Figma', 'UX-исследования', 'Мобильные интерфейсы'], organization: 'Studio North', metAt: at(-12, 19), metWhere: 'на дизайн-митапе', notes: 'Готова помочь с дизайном онбординга.', interactions: [{ date: at(-12, 19), text: 'Познакомились на дизайн-митапе' }, { date: at(-3, 14), text: 'Обсудили прототип онбординга' }], createdAt: at(-12, 20), updatedAt: at(-3, 14) };
    const dmitry = { id: U.uid('p'), name: 'Дмитрий Орлов', photo: null, profession: 'Инвестор', skills: ['Венчурные инвестиции', 'SaaS', 'AI-стартапы'], organization: 'Orbit Capital', metAt: at(-20, 11), metWhere: 'на конференции Startup Village', notes: 'Интересуется AI-ассистентами. Просил прислать метрики.', interactions: [{ date: at(-20, 11), text: 'Познакомились на конференции' }], createdAt: at(-20, 12), updatedAt: at(-20, 12) };
    const igor = { id: U.uid('p'), name: 'Игорь Смирнов', photo: null, profession: 'Программист', skills: ['Go', 'Kubernetes', 'Backend'], organization: 'Fintech Lab', metAt: at(-95, 18), metWhere: 'на хакатоне', notes: '', interactions: [{ date: at(-95, 18), text: 'Вместе участвовали в хакатоне' }], createdAt: at(-95, 18), updatedAt: at(-95, 18) };
    d.people.push(maria, dmitry, igor);

    d.memories.push(
      { id: U.uid('m'), type: 'event', title: 'Знакомство с Марией Ковалёвой', content: 'Познакомились на дизайн-митапе. Мария — дизайнер, работает с Figma.', tags: ['знакомство', 'дизайн'], confirmed: true, personId: maria.id, source: src('Сегодня на митапе познакомился с Марией, она дизайнер'), createdAt: maria.createdAt, updatedAt: maria.createdAt },
      { id: U.uid('m'), type: 'event', title: 'Знакомство с Дмитрием Орловым', content: 'Инвестор из Orbit Capital, познакомились на Startup Village. Просил метрики продукта.', tags: ['инвестор', 'знакомство'], confirmed: true, personId: dmitry.id, source: src('Познакомился с Дмитрием Орловым на Startup Village'), createdAt: dmitry.createdAt, updatedAt: dmitry.createdAt },
      { id: U.uid('m'), type: 'preference', title: 'Встречи — до обеда', content: 'Предпочитаю назначать встречи с 10:00 до 12:00.', tags: ['встречи', 'время'], confirmed: true, source: src('Мне удобнее встречи утром, с 10 до 12'), createdAt: at(-30, 9), updatedAt: at(-30, 9) },
      { id: U.uid('m'), type: 'plan', title: 'Запустить MVP Adis', content: 'Запустить MVP Adis и показать инвесторам до конца года.', tags: ['adis', 'запуск'], confirmed: true, source: src('Хочу запустить MVP до конца года'), createdAt: at(-25, 10), updatedAt: at(-25, 10) },
      { id: U.uid('m'), type: 'idea', title: 'Голосовой дневник', content: 'Голосовой дневник, который сам расставляет теги и находит связи между записями.', tags: ['идея', 'голос'], confirmed: true, source: src('Идея: голосовой дневник с автотегами'), createdAt: at(-8, 22), updatedAt: at(-8, 22) },
      { id: U.uid('m'), type: 'fact', title: 'Любимый кофе — флэт уайт', content: 'Пью флэт уайт на овсяном молоке.', tags: ['кофе'], confirmed: true, source: src('Запомни, я пью флэт уайт на овсяном'), createdAt: at(-15, 8), updatedAt: at(-15, 8) },
      { id: U.uid('m'), type: 'knowledge', title: 'Retention D30', content: 'Retention D30 — доля пользователей, вернувшихся в продукт через 30 дней. Цель для MVP — 25%.', tags: ['метрики'], confirmed: true, source: src('Запомни: цель по retention D30 — 25%'), createdAt: at(-5, 16), updatedAt: at(-5, 16) },
      { id: U.uid('m'), type: 'assumption', title: 'Дмитрий может инвестировать в pre-seed', content: 'Похоже, Дмитрий рассматривает pre-seed раунды в AI. Требует подтверждения.', tags: ['инвестор'], confirmed: false, personId: dmitry.id, source: src('Кажется, Дмитрий смотрит pre-seed'), createdAt: at(-2, 18), updatedAt: at(-2, 18) }
    );

    d.tasks.push(
      { id: U.uid('t'), title: 'Подготовить питч-дек для инвесторов', notes: 'Слайды: проблема, решение, демо, рынок, команда.', dueAt: at(0, 18), repeat: 'none', remind: true, done: false, personId: null, createdAt: now, updatedAt: now },
      { id: U.uid('t'), title: 'Позвонить Марии насчёт дизайна онбординга', notes: '', dueAt: at(1, 11), repeat: 'none', remind: true, done: false, personId: maria.id, createdAt: now, updatedAt: now },
      { id: U.uid('t'), title: 'Отправить метрики Дмитрию', notes: 'Retention, DAU, воронка онбординга.', dueAt: at(-1, 17), repeat: 'none', remind: true, done: false, personId: dmitry.id, createdAt: now, updatedAt: now },
      { id: U.uid('t'), title: 'Утренняя тренировка', notes: '', dueAt: at(1, 8), repeat: 'daily', remind: true, done: false, personId: null, createdAt: now, updatedAt: now },
      { id: U.uid('t'), title: 'Зарегистрировать домен', notes: '', dueAt: at(-4, 12), repeat: 'none', remind: false, done: true, doneAt: at(-4, 13), personId: null, createdAt: at(-6, 9), updatedAt: at(-4, 13) }
    );

    d.events.push(
      { id: U.uid('e'), title: 'Встреча с инвесторами', startAt: at(2, 11), endAt: at(2, 12), location: 'Orbit Capital, офис', notes: 'Демо Adis + метрики', remindMinutes: 60, createdAt: now, updatedAt: now },
      { id: U.uid('e'), title: 'Созвон с командой', startAt: at(0, 12), endAt: at(0, 12, 30), location: 'Онлайн', notes: '', remindMinutes: 10, createdAt: now, updatedAt: now },
      { id: U.uid('e'), title: 'Дизайн-ревью с Марией', startAt: at(4, 10), endAt: at(4, 11), location: '', notes: '', remindMinutes: 30, createdAt: now, updatedAt: now }
    );

    d.documents.push({ id: U.uid('doc'), title: 'Заметки к питчу', content: '# Питч Adis\n\n**Проблема:** информация о людях, планах и договорённостях теряется в десятках приложений.\n\n**Решение:** Adis — персональный ИИ-помощник с долговременной памятью.\n\n- Голос и текст\n- Память о людях и событиях\n- Напоминания естественным языком', createdAt: at(-1, 20), updatedAt: at(-1, 20) });

    const tx = (kind, amount, category, note, days, h = 13) => ({ id: U.uid('tx'), kind, amount, currency: 'RUB', category, note, occurredAt: at(days, h), personId: null, createdAt: now, updatedAt: now });
    d.transactions.push(
      tx('income', 180000, 'Зарплата', 'Зарплата за месяц', -10, 10), tx('income', 25000, 'Подработка', 'Консультация по дизайну', -4, 18),
      tx('expense', 45000, 'Жильё', 'Аренда квартиры', -9, 9), tx('expense', 3240, 'Продукты', 'Продукты во ВкусВилле', -2, 19),
      tx('expense', 1890, 'Продукты', 'Продукты в Пятёрочке', -6, 20), tx('expense', 650, 'Кафе и рестораны', 'Кофе и завтрак', -1, 9),
      tx('expense', 2400, 'Кафе и рестораны', 'Ужин с Марией', -3, 20), tx('expense', 890, 'Такси', 'Такси до офиса', -1, 8),
      tx('expense', 799, 'Подписки', 'ChatGPT', -7, 12), tx('expense', 650, 'Связь и интернет', 'Мобильная связь', -8, 12)
    );
    d.debts.push(
      { id: U.uid('db'), direction: 'lent', personId: igor.id, counterparty: igor.name, amount: 5000, paid: 2000, currency: 'RUB', note: 'На ремонт ноутбука', occurredAt: at(-14, 15), dueAt: at(-1, 12), remind: true, status: 'open', closedAt: null, payments: [{ date: at(-5, 18), amount: 2000 }], createdAt: now, updatedAt: now },
      { id: U.uid('db'), direction: 'borrowed', personId: null, counterparty: 'Брат', amount: 15000, paid: 0, currency: 'RUB', note: 'До зарплаты', occurredAt: at(-6, 19), dueAt: at(9, 12), remind: true, status: 'open', closedAt: null, payments: [], createdAt: now, updatedAt: now }
    );

    d.agents = DEMO_AGENTS();
    save();
  }

  A.mockDb = {
    get: () => db,
    save,
    userData,
    seedDemo,
    demoAgents: DEMO_AGENTS,
    reset() { db = { users: [], sessions: {}, refresh: {}, data: {}, resetCodes: {} }; save(); }
  };
})(window.Adis);
