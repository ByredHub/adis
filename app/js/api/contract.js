/* API contract (preliminary). Mirrors TZ §9 + documented extensions. Shared by HttpClient and MockServer. */
(function (A) {
  'use strict';

  A.API = {
    auth: {
      register: 'POST /auth/register',
      login: 'POST /auth/login',
      refresh: 'POST /auth/refresh',
      logout: 'POST /auth/logout',
      forgot: 'POST /auth/password/forgot',          // extension
      resetPassword: 'POST /auth/password/reset',     // extension
      changePassword: 'POST /auth/password/change',   // extension
      me: 'GET /users/me',
      updateMe: 'PATCH /users/me',                    // extension
      deleteMe: 'DELETE /users/me',                   // extension
      devices: 'GET /users/me/devices',               // extension
      exportData: 'GET /users/me/export'              // extension
    },
    chat: {
      send: 'POST /chat/messages',
      stream: 'POST /chat/stream',
      list: 'GET /chat/conversations',
      get: 'GET /chat/conversations/{id}',
      remove: 'DELETE /chat/conversations/{id}',      // extension
      cardStatus: 'PATCH /chat/conversations/{id}/messages/{mid}/cards/{cid}' // extension
    },
    memory: {
      list: 'GET /memory',
      create: 'POST /memory',
      search: 'GET /memory/search',
      update: 'PATCH /memory/{id}',
      remove: 'DELETE /memory/{id}'
    },
    people: {                                          // extension (entity_lookup)
      list: 'GET /people', create: 'POST /people', get: 'GET /people/{id}', update: 'PATCH /people/{id}', remove: 'DELETE /people/{id}'
    },
    tasks: { list: 'GET /tasks', create: 'POST /tasks', update: 'PATCH /tasks/{id}', remove: 'DELETE /tasks/{id}' },
    events: { list: 'GET /events', create: 'POST /events', update: 'PATCH /events/{id}', remove: 'DELETE /events/{id}' }, // extension
    proactive: {
      list: 'GET /proactive/suggestions',
      accept: 'POST /proactive/{id}/accept',
      dismiss: 'POST /proactive/{id}/dismiss',
      snooze: 'POST /proactive/{id}/snooze'          // extension
    },
    agents: {                                          // extension
      list: 'GET /agents', create: 'POST /agents', update: 'PATCH /agents/{id}', remove: 'DELETE /agents/{id}',
      run: 'POST /agents/{id}/runs', runs: 'GET /agents/{id}/runs', stop: 'POST /agents/runs/{id}/stop'
    },
    documents: { list: 'GET /documents', create: 'POST /documents', update: 'PATCH /documents/{id}', remove: 'DELETE /documents/{id}' }, // extension
    alarms: {                                          // extension
      list: 'GET /alarms', create: 'POST /alarms', update: 'PATCH /alarms/{id}', remove: 'DELETE /alarms/{id}',
      dismiss: 'POST /alarms/{id}/dismiss', snooze: 'POST /alarms/{id}/snooze'
    },
    finance: {                                         // extension
      transactions: 'GET /finance/transactions', addTx: 'POST /finance/transactions', updateTx: 'PATCH /finance/transactions/{id}', removeTx: 'DELETE /finance/transactions/{id}',
      debts: 'GET /finance/debts', addDebt: 'POST /finance/debts', updateDebt: 'PATCH /finance/debts/{id}', repay: 'POST /finance/debts/{id}/repay', removeDebt: 'DELETE /finance/debts/{id}',
      summary: 'GET /finance/summary'
    },
    voice: { status: 'GET /voice/status', transcribe: 'POST /voice/transcribe', speak: 'POST /voice/speak' }, // extension: cloud STT/TTS
    push: { key: 'GET /push/vapid-key', subscribe: 'POST /push/subscriptions', unsubscribe: 'POST /push/unsubscribe', test: 'POST /push/test' }, // extension
    calendar: { feed: 'GET /calendar/feed', enableFeed: 'POST /calendar/feed', disableFeed: 'DELETE /calendar/feed', importIcs: 'POST /calendar/import' } // extension
  };

  /* Memory semantics (TZ §8) */
  A.MEMORY_TYPES = {
    person: { label: 'Люди', one: 'Человек', icon: 'users' },
    event: { label: 'События', one: 'Событие', icon: 'calendar' },
    fact: { label: 'Факты', one: 'Факт', icon: 'factCheck' },
    idea: { label: 'Идеи', one: 'Идея', icon: 'idea' },
    preference: { label: 'Предпочтения', one: 'Предпочтение', icon: 'heart' },
    plan: { label: 'Планы', one: 'План', icon: 'flag' },
    knowledge: { label: 'Знания', one: 'Знание', icon: 'book' },
    intention: { label: 'Намерения', one: 'Намерение', icon: 'flag' },
    assumption: { label: 'Предположения', one: 'Предположение', icon: 'info' }
  };

  /* Tools available to the AI core (executed server-side through permission-checked APIs, never raw SQL) */
  A.AI_TOOLS = ['memory_search', 'memory_save', 'memory_update', 'memory_delete', 'entity_lookup', 'task_create', 'task_update', 'task_complete', 'notification_schedule', 'proactive_suggestion'];

  class ApiError extends Error {
    constructor(code, message, status = 0, details) {
      super(message); this.name = 'ApiError'; this.code = code; this.status = status; this.details = details;
    }
    get userMessage() {
      return ({
        network: 'Нет соединения с сервером. Проверьте интернет и попробуйте снова.',
        timeout: 'Сервер долго не отвечает. Попробуйте ещё раз.',
        unauthorized: 'Сессия истекла. Войдите снова.',
        forbidden: 'Недостаточно прав для этого действия.',
        not_found: 'Не найдено.',
        validation: this.message,
        conflict: this.message,
        server: 'Ошибка на сервере. Мы уже разбираемся.',
        rate_limited: this.message || 'Слишком много попыток. Подождите немного.',
        ai_unavailable: this.message || 'Языковая модель временно недоступна. Попробуйте позже.',
        aborted: 'Запрос отменён.'
      })[this.code] || this.message || 'Что-то пошло не так.';
    }
  }
  A.ApiError = ApiError;

  /* DTO mappers: keep server shape isolated from UI models */
  A.dto = {
    user: u => u && ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, assistantName: u.assistantName || 'Adis', avatar: u.avatar || null }),
    task(t) {
      if (!t) return t;
      const now = Date.now();
      const due = t.dueAt ? new Date(t.dueAt).getTime() : null;
      const status = t.done ? 'done' : (due && due < now ? 'overdue' : 'active');
      return Object.assign({}, t, { status });
    }
  };
})(window.Adis);
