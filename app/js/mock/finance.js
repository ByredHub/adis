/* DEMO MODE: finance logic (port of server/adis/services/finance.py) — money parsing, categories, debts, summary.
 * Used by the demo engine and the mock REST endpoints. Keep in sync with the server. */
(function (A) {
  'use strict';
  const U = A.util;

  const EXPENSE_CATEGORIES = [
    ['Продукты', /продукт|магазин|супермаркет|пятерочк|магнит|перекрест|ашан|лент[аеу]|вкусвилл|овощ|фрукт|хлеб|молок|мяс/],
    ['Кафе и рестораны', /кафе|ресторан|кофе|обед|ужин|завтрак|(^|\s)бар(\s|$)|пицц|суши|бургер|доставк[аеу] еды|шаурм|столов/],
    ['Такси', /такси|uber|яндекс go|убер/],
    ['Транспорт', /метро|автобус|проезд|бензин|топлив|заправк|парковк|электричк|трамва|каршеринг|самокат/],
    ['Жильё', /аренд|квартплат|коммунал|жкх|ипотек|квартир/],
    ['Связь и интернет', /интернет|связь|мобильн|сотов/],
    ['Подписки', /подписк|netflix|spotify|кинопоиск|яндекс плюс|icloud|youtube premium|chatgpt/],
    ['Здоровье', /аптек|лекарств|врач|стоматолог|анализ|клиник|больниц|витамин/],
    ['Одежда', /одежд|обув|кроссовк|куртк|джинс|футболк|платье/],
    ['Красота', /парикмахер|стрижк|маникюр|салон|косметик|барбер/],
    ['Спорт', /спортзал|фитнес|абонемент|тренировк|бассейн|йог/],
    ['Развлечения', /кино|театр|концерт|игр[аыу]|развлеч|музей|билет/],
    ['Подарки', /подар|цвет[ыо]|букет/],
    ['Образование', /курс|учеб|книг|школ|универ|репетитор/],
    ['Дом', /мебел|ремонт|посуд|бытов|икеа|ikea|хозтовар/],
    ['Путешествия', /отел|гостиниц|авиабилет|самолет|поезд|путешеств|отпуск|виз[аеу]/],
    ['Дети', /детск|ребен|садик|игрушк/],
    ['Животные', /корм|ветеринар|зоомагазин/]
  ];
  const INCOME_CATEGORIES = [
    ['Зарплата', /зарплат|(^|\s)зп(\s|$)|оклад|аванс/], ['Подработка', /подработк|фриланс|заказ|клиент|проект/], ['Бизнес', /выручк|продаж|бизнес|магазин/],
    ['Подарок', /подар/], ['Проценты и кэшбэк', /процент|кэшбэк|кешбэк|дивиденд|вклад/], ['Возврат', /возврат|вернули деньги|компенсац/]
  ];

  const CUR = '(₽|руб(?:л(?:ей|я|ь))?\\.?|р\\.?(?![а-яё])|\\$|долл(?:ар(?:ов|а)?)?\\.?|usd|бакс(?:ов|а)?|€|евро|eur|₸|тенге|тг|сум(?:ов)?|£|фунт(?:ов|а)?)';
  const MONEY = new RegExp('(?:(\\$|€|£)\\s*)?(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+)(?:[.,](\\d{1,2}))?(?:\\s*(к|k|тыс\\.?|тысяч[аи]?|тыщ[иа]?|т\\.р\\.?|млн|миллион(?:а|ов)?))?(?:\\s*' + CUR + ')?', 'gi');
  const MONTHS = 'январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр';
  const WORD_AMOUNTS = [[/полтор[аы] тысяч[иа]?/, 1500], [/тысяч[ауи]/, 1000], [/сотн[юи]|сотк[уи]/, 100], [/пятихатк[уи]/, 500]];

  function currency(t) {
    if (!t) return null;
    t = t.toLowerCase();
    if (t === '₽' || t === 'р.' || t === 'р' || t.startsWith('руб')) return 'RUB';
    if (t === '$' || t.startsWith('долл') || t === 'usd' || t.startsWith('бакс')) return 'USD';
    if (t === '€' || t === 'евро' || t === 'eur') return 'EUR';
    if (t === '₸' || t === 'тенге' || t === 'тг') return 'KZT';
    if (t.startsWith('сум')) return 'UZS';
    if (t === '£' || t.startsWith('фунт')) return 'GBP';
    return null;
  }

  function parseMoney(text, def = 'RUB') {
    let best = null, m;
    MONEY.lastIndex = 0;
    while ((m = MONEY.exec(text))) {
      if (!m[0]) { MONEY.lastIndex++; continue; }
      const whole = m[2], frac = m[3], mult = m[4], cur = m[5];
      const start = m.index, end = m.index + m[0].length;
      const before = text.slice(0, start), after = text.slice(end);
      const afterNum = text.slice(m.index + m[0].indexOf(whole) + whole.length + (frac ? frac.length + 1 : 0));
      if ((/^\s*[:.]\d/.test(afterNum) || /\d[:.]$/.test(before)) && !cur) continue;
      if (new RegExp('^\\s*(' + MONTHS + ')', 'i').test(after) || /^\s*(час|мин|числ|сек|ден|дн|недел|месяц|лет|год|раз|шт|%|процент)/i.test(after)) continue;
      const n = parseInt(whole.replace(/[ \u00a0]/g, ''), 10);
      if (!(mult || cur || m[1]) && /(^|\s)(в|к|до|с|на|через|по)\s*$/i.test(before) && n <= 31) continue;
      let value = parseFloat(whole.replace(/[ \u00a0]/g, '') + (frac ? '.' + frac : ''));
      if (mult) value *= /^(млн|миллион)/i.test(mult) ? 1e6 : 1000;
      if (!(value > 0)) continue;
      const score = [(mult || cur || m[1]) ? 2 : 1, value];
      const cand = { amount: Math.round(value * 100) / 100, currency: currency(cur) || currency(m[1]) || def, span: [start, end], score };
      if (!best || cand.score[0] > best.score[0] || (cand.score[0] === best.score[0] && cand.score[1] > best.score[1])) best = cand;
    }
    if (!best) {
      const low = text.toLowerCase();
      for (const [rx, v] of WORD_AMOUNTS) {
        const wm = low.match(rx);
        if (wm) return { amount: v, currency: def, span: [wm.index, wm.index + wm[0].length] };
      }
      return null;
    }
    delete best.score;
    return best;
  }

  function categorize(text, kind) {
    const low = text.toLowerCase().replace(/ё/g, 'е');
    const hit = (kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).find(([, rx]) => rx.test(low));
    return hit ? hit[0] : 'Другое';
  }

  const RELATIVES = { мам: 'Мама', пап: 'Папа', брат: 'Брат', сестр: 'Сестра', друг: 'Друг', подруг: 'Подруга', жен: 'Жена', муж: 'Муж', сын: 'Сын', доч: 'Дочь', бабушк: 'Бабушка', дедушк: 'Дедушка', сосед: 'Сосед', коллег: 'Коллега' };
  function counterpartyName(w) {
    const low = w.toLowerCase();
    for (const [stem, nom] of Object.entries(RELATIVES)) if (low.startsWith(stem) && low.length - stem.length <= 3) return nom;
    if (/ии$/.test(w) || /ию$/.test(w)) return U.cap(w.slice(0, -1) + 'я');
    if (/ия$/.test(w) && !['мария', 'юлия', 'наталия', 'лия'].includes(low)) return U.cap(w.slice(0, -1) + 'й');
    if (/ю$/.test(w)) return U.cap(w.slice(0, -1) + 'ь');
    if (/[^аеиоуыэюя]у$/.test(w)) return U.cap(w.slice(0, -1));
    if (/[ая]$/.test(low)) return U.cap(w);
    if (/[еы]$/.test(w)) return U.cap(w.slice(0, -1) + 'а');
    return A.nlu.nameToNominative(w);
  }
  const REL_DAT = 'мам[еуы]|пап[еуы]|брат[уа]?|сестр[еуы]|друг[уа]?|подруг[еи]|жен[еы]|муж[уа]|сын[уа]|дочер[и]|бабушк[еи]|дедушк[еи]|сосед[уа]|коллег[еи]';
  const PARTY = [
    new RegExp('(?:дал|дала|одолжил[аи]?|занял[аи]?|перевёл|перевел[аи]?|скинул[аи]?|отдал[аи]?|вернул[аи]?|должен|должна|задолжал[аи]?)\\s+(?:в долг\\s+)?(?:мне\\s+)?([А-ЯЁ][а-яё]+|' + REL_DAT + ')'),
    /(?:^|\s)(?:у|от)\s+([А-ЯЁ][а-яё]+|мамы|папы|брата|сестры|друга|подруги|жены|мужа|сына|дочери|бабушки|дедушки|соседа|коллеги)/,
    /^([А-ЯЁ][а-яё]+)\s+(?:мне\s+)?(?:должен|должна|вернул|вернула|отдал|отдала|задолжал)/
  ];
  function extractCounterparty(text) {
    const lf = text.slice(0, 1).toLowerCase() + text.slice(1);
    for (let i = 0; i < PARTY.length; i++) {
      const m = (i === 2 ? text : lf).match(PARTY[i]);
      if (m && !['мне', 'в', 'долг', 'его', 'ей', 'ему', 'им', 'ее', 'её'].includes(m[1].toLowerCase())) return counterpartyName(m[1]);
    }
    return null;
  }

  function dative(name) {
    const parts = String(name || '').split(' '); const f = parts[0]; const low = f.toLowerCase();
    if (!f) return name;
    parts[0] = /ия$/.test(low) ? f.slice(0, -1) + 'и' : /[ая]$/.test(low) ? f.slice(0, -1) + 'е' : /[йь]$/.test(low) ? f.slice(0, -1) + 'ю' : /[бвгджзклмнпрстфхцчшщ]$/.test(low) ? f + 'у' : f;
    return parts.join(' ');
  }

  /* ---------- data (demo DB) ---------- */
  function make(d) {
    const now = () => new Date().toISOString();
    const left = x => Math.round((x.amount - (x.paid || 0)) * 100) / 100;
    const out = x => Object.assign({}, x, { left: left(x), overdue: x.status === 'open' && !!x.dueAt && new Date(x.dueAt) < Date.now() });
    const F = {
      transactions({ from, to, kind, category } = {}) {
        return d.transactions.filter(t => (!from || t.occurredAt >= from) && (!to || t.occurredAt < to) && (!kind || t.kind === kind) && (!category || t.category === category))
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
      },
      addTx(b) {
        const kind = b.kind === 'income' ? 'income' : 'expense';
        const t = { id: U.uid('tx'), kind, amount: Math.round(+b.amount * 100) / 100, currency: (b.currency || 'RUB').toUpperCase(), category: b.category || categorize(b.note || '', kind), note: (b.note || '').slice(0, 500), occurredAt: b.occurredAt || now(), personId: b.personId || null, createdAt: now(), updatedAt: now() };
        d.transactions.push(t); return t;
      },
      debts({ status, direction } = {}) { return d.debts.filter(x => (!status || x.status === status) && (!direction || x.direction === direction)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(out); },
      addDebt(b) {
        const p = b.personId && d.people.find(x => x.id === b.personId);
        const x = { id: U.uid('db'), direction: b.direction === 'borrowed' ? 'borrowed' : 'lent', personId: p ? p.id : null, counterparty: (b.counterparty || (p && p.name) || '').slice(0, 160), amount: Math.round(+b.amount * 100) / 100, paid: 0, currency: (b.currency || 'RUB').toUpperCase(), note: b.note || '', occurredAt: b.occurredAt || now(), dueAt: b.dueAt || null, remind: b.remind !== false, status: 'open', closedAt: null, payments: [], createdAt: now(), updatedAt: now() };
        d.debts.push(x); return out(x);
      },
      repay(id, amount) {
        const x = d.debts.find(y => y.id === id); if (!x) return null;
        const pay = amount ? Math.min(+amount, left(x)) : left(x);
        if (pay > 0) { x.paid = Math.round(((x.paid || 0) + pay) * 100) / 100; x.payments.push({ date: now(), amount: pay }); }
        if (x.paid >= x.amount && x.status === 'open') { x.status = 'closed'; x.closedAt = now(); }
        x.updatedAt = now(); return out(x);
      },
      findOpenDebt(text, direction) {
        const list = d.debts.filter(x => x.status === 'open' && (!direction || x.direction === direction));
        if (!list.length) return null;
        const person = A.nlu.findPersonMention(text, d.people), name = extractCounterparty(text);
        return list.find(x => person && x.personId === person.id) || list.find(x => name && x.counterparty.split(' ').some(w => U.sameStem(w, name))) || (list.length === 1 ? list[0] : null);
      },
      period(text = '') {
        const low = text.toLowerCase(), day0 = U.startOfDay(new Date());
        if (/сегодня/.test(low)) return [day0, U.addDays(day0, 1), 'Сегодня'];
        if (/вчера/.test(low)) return [U.addDays(day0, -1), day0, 'Вчера'];
        if (/(за|на) (эту |этой )?недел/.test(low)) { const s = U.addDays(day0, -((day0.getDay() + 6) % 7)); return [s, U.addDays(s, 7), 'На этой неделе']; }
        const m0 = new Date(day0.getFullYear(), day0.getMonth(), 1);
        if (/прошл/.test(low) && /месяц/.test(low)) return [new Date(m0.getFullYear(), m0.getMonth() - 1, 1), m0, 'В прошлом месяце'];
        return [m0, new Date(m0.getFullYear(), m0.getMonth() + 1, 1), 'В этом месяце'];
      },
      summary(start, end) {
        const txs = F.transactions({ from: start.toISOString(), to: end.toISOString() });
        const totals = {}, cats = {};
        txs.forEach(t => {
          const v = totals[t.currency] = totals[t.currency] || { income: 0, expense: 0 };
          v[t.kind] += t.amount;
          if (t.kind === 'expense') { const k = t.currency + '|' + t.category; cats[k] = (cats[k] || 0) + t.amount; }
        });
        const debts = {}; let overdue = 0; const open = d.debts.filter(x => x.status === 'open');
        open.forEach(x => { const v = debts[x.currency] = debts[x.currency] || { owedToMe: 0, iOwe: 0 }; v[x.direction === 'lent' ? 'owedToMe' : 'iOwe'] += left(x); if (x.dueAt && new Date(x.dueAt) < Date.now()) overdue++; });
        const r2 = n => Math.round(n * 100) / 100;
        return {
          from: start.toISOString(), to: end.toISOString(),
          totals: Object.keys(totals).sort().map(c => ({ currency: c, income: r2(totals[c].income), expense: r2(totals[c].expense), balance: r2(totals[c].income - totals[c].expense) })),
          byCategory: Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ currency: k.split('|')[0], category: k.split('|')[1], amount: r2(v) })),
          debts: Object.keys(debts).sort().map(c => ({ currency: c, owedToMe: r2(debts[c].owedToMe), iOwe: r2(debts[c].iOwe) })),
          openDebts: open.length, overdueDebts: overdue, count: txs.length
        };
      }
    };
    return F;
  }

  A.mockFinance = { parseMoney, categorize, extractCounterparty, dative, make };
})(window.Adis);
