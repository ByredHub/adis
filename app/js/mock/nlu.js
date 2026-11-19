/* DEMO AI CORE — rule-based Russian NLU used while the cloud LLM backend is not connected.
 * Extracts intents and entities: people, professions, skills, dates/times, reminders, memory types. */
(function (A) {
  'use strict';
  const U = A.util;
  const L = 'а-яёa-z0-9';
  /* Word-boundary regex that works with Cyrillic (no lookbehind for older iOS Safari) */
  const W = (src, flags = 'i') => new RegExp(`(^|[^${L}])(${src})(?=$|[^${L}])`, flags);

  const PROFESSIONS = [
    ['Продакт-менеджер', 'продакт'], ['Программист', 'программист'], ['Разработчик', 'разработчик'], ['Дизайнер', 'дизайнер'],
    ['Врач', 'врач'], ['Юрист', 'юрист'], ['Адвокат', 'адвокат'], ['Предприниматель', 'предпринимател'], ['Бизнесмен', 'бизнесмен'],
    ['Инвестор', 'инвестор'], ['Маркетолог', 'маркетолог'], ['Таргетолог', 'таргетолог'], ['Менеджер', 'менеджер'], ['Учитель', 'учител'],
    ['Преподаватель', 'преподавател'], ['Инженер', 'инженер'], ['Бухгалтер', 'бухгалтер'], ['Аналитик', 'аналитик'], ['Архитектор', 'архитектор'],
    ['Фотограф', 'фотограф'], ['Журналист', 'журналист'], ['Тренер', 'тренер'], ['Студент', 'студент'], ['Директор', 'директор'],
    ['Основатель', 'основател'], ['Рекрутер', 'рекрутер'], ['Тестировщик', 'тестировщик'], ['Психолог', 'психолог'], ['Блогер', 'блогер'],
    ['Музыкант', 'музыкант'], ['Художник', 'художник'], ['Повар', 'повар'], ['Продюсер', 'продюсер'], ['Консультант', 'консультант'],
    ['Экономист', 'экономист'], ['Финансист', 'финансист'], ['Риелтор', 'риелтор'], ['Стоматолог', 'стоматолог'], ['Data Scientist', 'data scien']
  ];
  const TECH = ['Python', 'JavaScript', 'TypeScript', 'Java', 'Kotlin', 'Swift', 'Flutter', 'Dart', 'Golang', 'Go', 'Rust', 'C\\+\\+', 'C#', 'PHP', 'Ruby',
    'React', 'Vue', 'Angular', 'Node\\.js', 'SQL', 'PostgreSQL', 'Django', 'FastAPI', 'Docker', 'Kubernetes', 'Figma', 'Photoshop', 'Excel', '1С', 'Unity', 'iOS', 'Android', 'TensorFlow', 'PyTorch'];

  const WEEKDAY_FORMS = [
    ['воскресенье', 'воскресенье|воскресеньям'], ['понедельник', 'понедельник|понедельникам'], ['вторник', 'вторник|вторникам'],
    ['среда', 'среду|среда|средам'], ['четверг', 'четверг|четвергам'], ['пятница', 'пятницу|пятница|пятницам'], ['суббота', 'субботу|суббота|субботам']
  ];
  const MONTH_RX = 'январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь]';
  const KNOWN_NAMES = { 'артёмом': 'Артём', 'артемом': 'Артём', 'ильёй': 'Илья', 'ильей': 'Илья', 'игорем': 'Игорь', 'никитой': 'Никита', 'львом': 'Лев', 'павлом': 'Павел', 'петром': 'Пётр', 'любовью': 'Любовь' };

  function weekdayIndex(word) {
    word = word.toLowerCase();
    return WEEKDAY_FORMS.findIndex(([, forms]) => new RegExp(`^(${forms})$`).test(word));
  }

  /* Instrumental/dative → nominative for first names */
  function nameToNominative(w) {
    const low = w.toLowerCase();
    if (KNOWN_NAMES[low]) return KNOWN_NAMES[low];
    let r = w;
    if (/ием$/i.test(w)) r = w.slice(0, -3) + 'ий';
    else if (/[еиа]ем$/i.test(w)) r = w.slice(0, -2) + 'й';
    else if (/ом$/i.test(w)) r = w.slice(0, -2);
    else if (/ем$/i.test(w)) r = w.slice(0, -2) + 'ь';
    else if (/ьей$/i.test(w)) r = w.slice(0, -2) + 'я';
    else if (/[шжчщ]ей$/i.test(w)) r = w.slice(0, -2) + 'а';
    else if (/ей$/i.test(w)) r = w.slice(0, -2) + 'я';
    else if (/ой$/i.test(w)) r = w.slice(0, -2) + 'а';
    else if (/ою$/i.test(w)) r = w.slice(0, -2) + 'а';
    return U.cap(r);
  }
  function surnameToNominative(w) {
    if (/[ео]вым$|[ие]ным$/i.test(w)) return w.slice(0, -2);
    if (/ым$|им$/i.test(w)) return w.slice(0, -2);
    if (/[ео]вой$|[ие]ной$|ской$|цкой$/i.test(w)) return w.slice(0, -2) + 'а';
    if (/ским$|цким$/i.test(w)) return w.slice(0, -2) + 'й';
    return nameToNominative(w);
  }
  function orgToNominative(w) {
    if (/^[А-ЯЁ][а-яё]{3,}е$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function activityToNominative(phrase) {
    const parts = phrase.trim().split(/\s+/);
    let f = parts[0];
    if (/ой$/i.test(f)) f = f.slice(0, -2) + 'а';
    else if (/ом$/i.test(f)) f = f.slice(0, -2);
    else if (/ами$/i.test(f)) f = f.slice(0, -3) + 'ы';
    else if (/ей$/i.test(f)) f = f.slice(0, -2) + 'я';
    parts[0] = f;
    return parts.join(' ');
  }

  /* ---------- dates ---------- */
  function parseWhen(input, nowArg) {
    const now = nowArg ? new Date(nowArg) : new Date();
    let low = input.toLowerCase().replace(/ё/g, 'е');
    let out = input;
    let day = null, hour = null, minute = 0, repeat = 'none', periodHour = null, rel = null, weekday = null;

    function take(rx, fn) {
      const m = low.match(rx);
      if (!m) return false;
      const start = m.index + (m[1] || '').length;
      const len = m[2].length;
      fn(m.slice(2));
      const blank = ' '.repeat(len);
      low = low.slice(0, start) + blank + low.slice(start + len);
      out = out.slice(0, start) + blank + out.slice(start + len);
      return true;
    }

    take(W('каждый день|ежедневно'), () => { repeat = 'daily'; });
    take(W('каждое утро'), () => { repeat = 'daily'; periodHour = 9; });
    take(W('каждый вечер'), () => { repeat = 'daily'; periodHour = 20; });
    take(W('каждую неделю|еженедельно'), () => { repeat = 'weekly'; });
    take(W('каждый месяц|ежемесячно'), () => { repeat = 'monthly'; });
    take(W('(?:по|каждый|каждую|каждое)\\s+(понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)'), g => { repeat = 'weekly'; weekday = weekdayIndex(g[1]); });

    take(W('через\\s+(\\d+|пару|полчаса|час|минуту|день|неделю|месяц)(?:\\s+(минут[уы]?|час[аов]*|д[ен][яейь]*|недел[юиь]|месяц[аев]*))?'), g => {
      const n = /^\d+$/.test(g[1]) ? +g[1] : (g[1] === 'пару' ? 2 : 1);
      const unit = g[2] || g[1];
      const d = new Date(now);
      if (g[1] === 'полчаса') d.setMinutes(d.getMinutes() + 30);
      else if (/^мин/.test(unit)) d.setMinutes(d.getMinutes() + n);
      else if (/^час/.test(unit)) d.setHours(d.getHours() + n);
      else if (/^(день|дн|дня|дней)/.test(unit)) { d.setDate(d.getDate() + n); rel = 'day'; }
      else if (/^недел/.test(unit)) { d.setDate(d.getDate() + 7 * n); rel = 'day'; }
      else if (/^месяц/.test(unit)) { d.setMonth(d.getMonth() + n); rel = 'day'; }
      else d.setMinutes(d.getMinutes() + n);
      day = d; if (!rel) { hour = d.getHours(); minute = d.getMinutes(); rel = 'exact'; }
    });

    take(W('послезавтра'), () => { day = U.addDays(now, 2); });
    take(W('завтра'), () => { day = U.addDays(now, 1); });
    take(W('сегодня'), () => { day = new Date(now); });

    take(W('(?:в|во)\\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)'), g => {
      const wd = weekdayIndex(g[1]); const diff = ((wd - now.getDay()) + 7) % 7 || 7; day = U.addDays(now, diff);
    });

    take(W(`(\\d{1,2})\\s+(${MONTH_RX})`), g => {
      const mIdx = ['янв', 'фев', 'мар', 'апр', 'ма', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'].findIndex(p => g[2].startsWith(p));
      const d = new Date(now); d.setMonth(mIdx, +g[1]); if (d < U.startOfDay(now)) d.setFullYear(d.getFullYear() + 1); day = d;
    });

    take(W('(?:в|к|на)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:часов|часа|час|ч))?(?:\\s+(утра|дня|вечера|ночи))?'), g => {
      hour = +g[1]; minute = g[2] ? +g[2] : 0;
      if (g[3] === 'вечера' && hour < 12) hour += 12;
      if (g[3] === 'дня' && hour < 8) hour += 12;
      if (g[3] === 'ночи' && hour === 12) hour = 0;
      if (hour > 23) hour = null;
    });

    if (!day) take(W('(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?'), g => {
      const d = new Date(now); let y = g[3] ? +g[3] : d.getFullYear(); if (y < 100) y += 2000;
      d.setFullYear(y, +g[2] - 1, +g[1]); day = d;
    });

    take(W('в полдень'), () => { periodHour = 12; });
    take(W('утром'), () => { periodHour = periodHour || 9; });
    take(W('дн[её]м|в обед'), () => { periodHour = periodHour || 13; });
    take(W('вечером'), () => { periodHour = periodHour || 19; });
    take(W('ночью'), () => { periodHour = periodHour || 23; });

    if (hour == null && periodHour != null) hour = periodHour;
    if (hour != null && hour < 12 && periodHour >= 13 && periodHour <= 23) hour += 12;

    const hasDay = !!day || weekday != null;
    let date = null;
    if (rel === 'exact') date = day;
    else if (day || hour != null || weekday != null || repeat !== 'none') {
      if (!day && weekday != null) { const diff = ((weekday - now.getDay()) + 7) % 7; day = U.addDays(now, diff); }
      date = new Date(day || now);
      date.setHours(hour != null ? hour : 9, minute, 0, 0);
      if (date <= now) {
        if (!day || repeat === 'daily') date = U.addDays(date, 1);
        else if (repeat === 'weekly') date = U.addDays(date, 7);
      }
    }

    const rest = out.replace(/\s+/g, ' ').trim();
    return { date, repeat, rest, hasTime: hour != null, hasDay, weekday };
  }

  /* ---------- calendar events (keep in sync with server/adis/ai/nlu.py) ---------- */
  const EVENT_WORDS = 'встреч|созвон|событи|собеседовани|совещани|планерк|планёрк|ужин|обед|завтрак|день рождени|конференци|вебинар|звонок|приём|прием|тренировк|урок|лекци|презентаци|свидани';
  const EVENT_PREFIX = new RegExp('^\\s*(?:adis,?\\s*)?(?:пожалуйста,?\\s*)?(?:(?:добавь|внеси|запиши|поставь|занеси)\\s+(?:в\\s+(?:мой\\s+)?(?:календарь|расписание))\\s*,?\\s*|(?:запланируй|назначь|создай|добавь)\\s+(?=' + EVENT_WORDS + ')|у меня\\s+(?=' + EVENT_WORDS + '))', 'i');
  const RANGE_RX = /(^|\s)с\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?:[:.](\d{2}))?(?=$|[^\d])/i;
  const DURATION_RX = /(^|\s)на\s+(полчаса|полтора часа|час|\d{1,3}\s*(?:минут[уы]?|мин)|[1-8](?:[.,]5)?\s*час(?:а|ов)?)(?=$|[^а-яё])/i;
  const REMIND_BEFORE_RX = /,?\s*(?:и\s+)?напомни(?:ть)?\s+(?:мне\s+)?за\s+(\d+\s*)?(минут[уы]?|час(?:а|ов)?|день|сутки)/i;
  const PLACE_RX = /(^|\s)((?:в|во|на)\s+(?:офис|кафе|ресторан|бар|клуб|переговорн|кабинет|школ|университет|институт|центр|парк|зал|студи|коворкинг|zoom|зум|teams|skype|google meet|meet|телеграм)[^,.;!?]*)/i;
  const ADDRESS_RX = /(^|\s)по адресу\s+([^.;!?]+)/i;

  function minutesOf(num, unit) {
    const n = num && num.trim() ? parseInt(num, 10) : 1;
    unit = unit.toLowerCase();
    if (unit.startsWith('час')) return 60 * n;
    if (unit === 'день' || unit === 'сутки') return 1440 * n;
    return n;
  }
  const cut = (s, m, repl = '') => s.slice(0, m.index) + repl + s.slice(m.index + m[0].length);

  function extractEvent(text, nowArg) {
    const now = nowArg ? new Date(nowArg) : new Date();
    let body = text.replace(EVENT_PREFIX, '');
    let remind = 15, m;
    if ((m = body.match(REMIND_BEFORE_RX))) { remind = minutesOf(m[1], m[2]); body = cut(body, m); }
    let endHM = null;
    if ((m = body.match(RANGE_RX))) {
      const h1 = +m[2], m1 = +(m[3] || 0), h2 = +m[4], m2 = +(m[5] || 0);
      if (h1 <= 23 && h2 <= 23) { body = cut(body, m, `${m[1]}в ${h1}:${U.pad(m1)}`); endHM = [h2, m2]; }
    }
    let duration = null;
    if ((m = body.match(DURATION_RX)) && (endHM || /(в|к)\s+\d/i.test(body))) {
      const d = m[2].toLowerCase();
      duration = d === 'полчаса' ? 30 : d === 'полтора часа' ? 90 : d === 'час' ? 60 : /мин/.test(d) ? parseInt(d, 10) : Math.round(parseFloat(d.replace(',', '.')) * 60);
      body = cut(body, m, m[1]);
    }
    let location = '';
    if ((m = body.match(ADDRESS_RX) || body.match(PLACE_RX))) { location = U.cap(m[2].trim()); body = cut(body, m, m[1]); }
    const when = parseWhen(body, now);
    const start = when.date;
    let end = null;
    if (start) {
      if (endHM) { end = new Date(start); end.setHours(endHM[0], endHM[1], 0, 0); if (end <= start) end = U.addDays(end, 1); }
      else end = new Date(start.getTime() + (duration || 60) * 60000);
    }
    let title = when.rest.replace(/[.!?]+$/, '').replace(/\s+,/g, ',').replace(/^[\s,.\-—:]+|[\s,.\-—:]+$/g, '');
    title = title.replace(/\s+(?:в|во|на|к|с)\s*$/i, '');
    return { title: U.cap(title) || 'Событие', startAt: start ? start.toISOString() : null, endAt: end ? end.toISOString() : null, location, remindMinutes: remind, hasTime: when.hasTime };
  }

  function calendarRange(text, nowArg) {
    const now = nowArg ? new Date(nowArg) : new Date();
    const low = text.toLowerCase().replace(/ё/g, 'е');
    const day0 = U.startOfDay(now);
    const toMonday = 7 - ((now.getDay() + 6) % 7);
    if (/(на )?следующей неделе/.test(low)) { const s = U.addDays(day0, toMonday); return { start: s, end: U.addDays(s, 7), label: 'На следующей неделе' }; }
    if (/(на )?(этой )?неделе/.test(low)) return { start: day0, end: U.addDays(day0, toMonday), label: 'На этой неделе' };
    const w = parseWhen(text, now);
    if (w.hasDay && w.date) { const d = U.startOfDay(w.date); return { start: d, end: U.addDays(d, 1), label: '' }; }
    return { start: day0, end: U.addDays(day0, 1), label: 'Сегодня' };
  }

  /* ---------- alarms ---------- */
  const DAY_FORMS = [['воскресень', 0], ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6]];
  function extractAlarm(text, nowArg) {
    const now = nowArg ? new Date(nowArg) : new Date();
    const low = text.toLowerCase().replace(/ё/g, 'е');
    let days = [], m;
    if (/по будням|в будни|в рабочие дни/.test(low)) days = [1, 2, 3, 4, 5];
    else if (/по выходным|в выходные/.test(low)) days = [0, 6];
    else if (/каждый день|ежедневно|каждое утро/.test(low)) days = [0, 1, 2, 3, 4, 5, 6];
    else if ((m = low.match(/(?:по|каждый|каждую|каждое)\s+((?:[а-я]+(?:,\s*|\s+и\s+|\s+))*[а-я]+)/))) {
      const set = new Set();
      m[1].split(/[,\s]+/).forEach(wd => DAY_FORMS.forEach(([st, d]) => { if (wd.startsWith(st)) set.add(d); }));
      days = Array.from(set).sort();
    }
    let hour = null, minute = 0;
    if ((m = low.match(/через\s+(\d+|полчаса|час)\s*(минут[уы]?|час(?:а|ов)?)?/))) {
      const n = m[1] === 'полчаса' ? 30 : m[1] === 'час' ? 1 : +m[1];
      const unit = m[2] || (m[1] === 'полчаса' ? 'минут' : 'час');
      const t = new Date(now.getTime() + n * (unit.startsWith('час') ? 3600000 : 60000));
      hour = t.getHours(); minute = t.getMinutes();
    } else if ((m = low.match(/(?:^|\s)(?:на|в|к)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:часов|часа|час|ч))?(?:\s+(утра|дня|вечера|ночи))?/) || low.match(/(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s+(утра|дня|вечера|ночи))?/))) {
      hour = +m[1]; minute = +(m[2] || 0);
      if ((m[3] === 'вечера' || m[3] === 'дня') && hour < 12) hour += 12;
      if (hour > 23 || minute > 59) { hour = null; minute = 0; }
    }
    let label = '';
    if ((m = text.match(/(?:чтобы|с подписью|с текстом|—|-)\s+(.+)$/))) label = U.cap(m[1].replace(/[.!]+$/, '').trim()).slice(0, 120);
    return { hour, minute, days, label, hasTime: hour != null };
  }

  const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  function describeDays(days) {
    const s = Array.from(new Set(days || [])).sort();
    if (!s.length) return 'Один раз';
    if (s.length === 7) return 'Каждый день';
    if (s.join() === '1,2,3,4,5') return 'По будням';
    if (s.join() === '0,6') return 'По выходным';
    return s.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => WD_SHORT[d]).join(', ');
  }

  /* ---------- people ---------- */
  function findProfession(text) {
    const low = text.toLowerCase().replace(/ё/g, 'е');
    const hit = PROFESSIONS.find(([, stem]) => low.includes(stem));
    return hit ? hit[0] : null;
  }
  function professionStems(text) {
    const low = text.toLowerCase().replace(/ё/g, 'е');
    return PROFESSIONS.filter(([, stem]) => low.includes(stem)).map(([name, stem]) => ({ name, stem }));
  }
  function findTech(text) {
    const res = [];
    TECH.forEach(t => {
      const rx = new RegExp(`(^|[^a-zа-я0-9+#])(${t})(?=$|[^a-zа-я0-9+#])`, 'i');
      const m = text.match(rx);
      if (m && !res.some(r => r.toLowerCase() === m[2].toLowerCase())) res.push(t.replace(/\\/g, ''));
    });
    if (res.includes('Golang') && res.includes('Go')) res.splice(res.indexOf('Go'), 1);
    return res;
  }

  function extractPerson(text) {
    const m = text.match(/познакомил(?:ся|ась|ись)?\s+(?:с|со)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?/);
    if (!m) return null;
    const first = nameToNominative(m[1]);
    const last = m[2] && !/^(Он|Она|Сегодня|Вчера)$/.test(m[2]) ? surnameToNominative(m[2]) : '';
    const name = [first, last].filter(Boolean).join(' ');
    const after = text.slice(m.index + m[0].length);
    const where = after.match(/^\s*,?\s*((?:на|в|во)\s+[^.,;!?]+)/i);
    const low = text.toLowerCase();

    const skills = findTech(text);
    const act = text.match(/(?:занима(?:ется|лся|лась|ются)|специализируется на|разбирается в|эксперт в)\s+([^.,;!?]+)/i);
    if (act) {
      act[1].split(/\s+и\s+(?=[а-яё]+(?:ой|ом|ами|ей)\s)/i).forEach(p => {
        const s = activityToNominative(p.trim());
        if (s && !skills.some(k => k.toLowerCase() === s.toLowerCase())) skills.push(s);
      });
    }
    let organization = '';
    const org = text.match(/работа(?:ет|л|ла)\s+(?:в|во)\s+(?:компании\s+)?«?([A-ZА-ЯЁ][\w\-А-Яа-яЁё]*(?:\s+[A-ZА-ЯЁ][\w\-А-Яа-яЁё]*)?)»?/) || text.match(/из\s+(?:компании\s+)?«([^»]+)»/);
    if (org) organization = orgToNominative(org[1]);

    let metAt = new Date();
    if (/позавчера/.test(low)) metAt = U.addDays(metAt, -2);
    else if (/вчера/.test(low)) metAt = U.addDays(metAt, -1);
    else if (/на прошлой неделе/.test(low)) metAt = U.addDays(metAt, -7);

    return {
      name, profession: findProfession(text.replace(m[0], '')) || '', skills, organization,
      metWhere: where ? where[1].trim() : '', metAt: metAt.toISOString()
    };
  }

  /* Find a mention of a known person in arbitrary text (any grammatical case) */
  function findPersonMention(text, people) {
    const words = text.match(/[А-ЯЁA-Z][а-яёa-z]+/g) || [];
    for (const w of words) {
      const p = people.find(pp => U.sameStem(pp.name.split(' ')[0], w) || (pp.name.split(' ')[1] && U.sameStem(pp.name.split(' ')[1], w)));
      if (p) return p;
    }
    const lowWords = U.words(text);
    for (const w of lowWords) {
      if (w.length < 3) continue;
      const p = people.find(pp => U.sameStem(pp.name.split(' ')[0], w));
      if (p) return p;
    }
    return null;
  }

  /* ---------- reminders ---------- */
  function extractReminder(text) {
    let body = text.replace(/^\s*(?:adis,?\s*)?(?:пожалуйста,?\s*)?(?:напомни(?:те)?|поставь напоминание|создай напоминание|добавь напоминание|добавь задачу|создай задачу|запиши задачу|запланируй|нужно не забыть|не дай мне забыть)\s*,?\s*(?:мне\s+)?(?:пожалуйста,?\s*)?/i, '');
    const when = parseWhen(body);
    let title = when.rest
      .replace(/^\s*(?:о том,?\s*что|что|чтобы|о|об|про)\s+/i, '')
      .replace(/^(?:мне\s+)?(?:нужно|надо|необходимо)\s+/i, '')
      .replace(/^\s*[,.:;-]+\s*/, '')
      .replace(/\s+(?:в|во|на|к)\s*$/i, '')
      .replace(/[.!?]+$/, '').replace(/\s+,/g, ',').trim();
    return { title: U.cap(title) || 'Напоминание', dueAt: when.date ? when.date.toISOString() : null, repeat: when.repeat, hasTime: when.hasTime };
  }

  /* ---------- memory ---------- */
  const SENSITIVE_RX = /(пароль|парол[яеи]|password|паспорт|снилс|(^|\s)инн(\s|$)|номер карты|cvv|cvc|пин-?код|pin-?код|диагноз|болезн|анализ[ыа]? крови|медицинск|банковск|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|номер паспорта|серия паспорта)/i;

  function classifyMemory(text) {
    const low = text.toLowerCase();
    if (/(кажется|наверное|возможно|похоже|вроде бы|предполагаю)/.test(low)) return 'assumption';
    if (/(люблю|обожаю|нравится|предпочитаю|не люблю|не переношу|терпеть не могу|удобнее|мой любимый|моя любимая|моё любимое)/.test(low)) return 'preference';
    if (/(иде[яюи]|придумал|а что если)/.test(low)) return 'idea';
    if (/(планирую|план |запланир|хочу|собираюсь|намерен|мечтаю|цель)/.test(low)) return /(хочу|собираюсь|намерен|мечтаю)/.test(low) ? 'intention' : 'plan';
    if (/( — это | - это |означает|называется|определение|формула|правило)/.test(low)) return 'knowledge';
    if (/(сегодня|вчера|был[аи]? на|ходил|ездил|встретил|произошло|случилось)/.test(low)) return 'event';
    return 'fact';
  }
  function memoryTitle(text) {
    let t = text.replace(/^\s*(?:запомни|сохрани|запиши|заметка|отметь)\s*[,:]?\s*(?:пожалуйста,?\s*)?(?:что\s+)?/i, '').replace(/[.!]+$/, '').trim();
    t = U.cap(t);
    return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, '') + '…' : t;
  }
  function memoryContent(text) {
    return U.cap(text.replace(/^\s*(?:запомни|сохрани|запиши|заметка|отметь)\s*[,:]?\s*(?:пожалуйста,?\s*)?(?:что\s+)?/i, '').trim());
  }
  function keywords(text) {
    const STOP = new Set('и в во на с со по о об от до за из к ко у а но или что как это мне меня мой моя мои я ты он она они мы вы его её их кто где когда какой какая какие есть был была были будет все всё ещё уже про для при же ли бы не нет да так тут там очень недавно найди вспомни покажи скажи ты помнишь знаешь расскажи'.split(' '));
    return U.words(text).filter(w => w.length > 2 && !STOP.has(w));
  }

  /* ---------- finance (keep in sync with server/adis/ai/nlu.py) ---------- */
  const HAS_AMOUNT = /\d|тысяч|сотн|сотк|пятихатк/i;
  const DEBT_WORDS = /в долг|одолжил|одолжила|занял|заняла|задолжал|задолжала|должен|должна|должны|долг/;
  const REPAID = /вернул|вернула|вернули|отдал[аи]?\s+(?:\S+\s+)?(?:долг|деньги)|погасил|погасила|рассчитал(ся|ась)|закрыл[аи]? долг/;
  const EXPENSE = /потратил|потратила|потрачено|заплатил|заплатила|оплатил|оплатила|купил|купила|расход|трата|ушло на|списали|отдал[аи]? за/;
  const INCOME = /получил|получила|заработал|заработала|пришл[оа] (?:на карту|деньги|зарплата|\d)|поступил[оа]|зарплат[аау]|доход|выручк|начислили|перевели мне|мне перевели|премия|премию/;

  function financeIntent(low, isQuestion) {
    if (/^(напомни|не дай мне забыть|нужно не забыть)/.test(low)) return null;
    if ((isQuestion || /^(покажи|мои|сколько|кому|кто)(\s|$)/.test(low)) && /трат|потратил|расход|доход|заработал|получил|баланс|бюджет|финанс|деньг|долг|должен|должна|должны|задолж/.test(low) && !/\d{3,}/.test(low)) return 'finance_query';
    if (REPAID.test(low) && (/долг|деньги/.test(low) || HAS_AMOUNT.test(low)) && !isQuestion) return 'debt_repaid';
    if (DEBT_WORDS.test(low) && HAS_AMOUNT.test(low) && !isQuestion) return 'debt';
    if (/(^|\s)дал[аи]?\s+\S+\s+[\d ]+\S*\s+до\s/.test(low)) return 'debt';
    if (EXPENSE.test(low) && HAS_AMOUNT.test(low) && !isQuestion) return 'expense';
    if (INCOME.test(low) && HAS_AMOUNT.test(low) && !isQuestion) return 'income';
    return null;
  }
  function debtDirection(text) {
    const low = text.toLowerCase();
    if (/(занял|заняла|взял|взяла|одолжил|одолжила|перехватил)[а-я]*\s+(?:в долг\s+)?(?:\S+\s+)?(у|от)\s/.test(low)) return 'borrowed';
    if (/(^|\s)я\s+(?:\S+\s+)?(должен|должна|задолжал|задолжала)/.test(low) || /^(должен|должна|задолжал)/.test(low)) return 'borrowed';
    return 'lent';
  }
  function repaidDirection(text) {
    const low = text.toLowerCase().trim();
    if (/^(я\s+)?(вернул|вернула|отдал|отдала|погасил|погасила|рассчитался|рассчиталась|закрыл|закрыла)(\s|$)/.test(low)) return 'borrowed';
    if (/мне\s+(вернул|вернула|вернули|отдал|отдала|отдали)/.test(low) || /^[а-яё]+\s+(вернул|вернула|отдал|отдала|рассчитал)/.test(low)) return 'lent';
    return null;
  }

  /* ---------- intents ---------- */
  function intent(text) {
    const t = text.trim();
    const low = t.toLowerCase().replace(/ё/g, 'е');
    const isQuestion = /\?\s*$/.test(t) || /^(с кем|кто|кого|какие|какой|что|когда|где|сколько|покажи|найди|вспомни|напомни,?\s+кто|есть ли)/.test(low);

    if (/^(кто ты|ты кто|что ты такое|кто ты такой|кто ты такая|как тебя зовут|расскажи о себе|представься)[\s?!.]*$/.test(low)) return 'about';
    if (/^(привет|здравствуй|здравствуйте|добрый (день|вечер|утро)|доброе утро|хай|hello|hi|салам|ассалам)/.test(low)) return 'greeting';
    if (/^(спасибо|благодарю|спс|супер|отлично|класс)[\s!.]*$/.test(low)) return 'thanks';
    if (/(что ты умеешь|что умеешь|что ты можешь|чем ты можешь помочь|как тобой пользоваться|помощь$|^help)/.test(low)) return 'capabilities';
    if (isQuestion && /(с кем|кого|кто из|каких|кто у меня)/.test(low) && /(познаком|знаком|знаю|контакт|люд|встреча)/.test(low)) return 'people_query';
    if (isQuestion && /(с кем|кто из|кого из)/.test(low) && professionStems(low).length) return 'people_query';
    if (/(кто так(ой|ая)|что (ты )?знаешь (о|об|про)|что я знаю (о|об|про)|расскажи (о|об|про)|напомни,?\s+кто)\s+\S+/.test(low)) return 'entity_lookup';
    if (/будильник|разбуди меня|подними меня/.test(low)) {
      if (/(выключи|отключи|удали|убери|отмени)\s+(мой\s+|все\s+)?будильник/.test(low)) return 'alarm_off';
      if (isQuestion || /(мои|какие|покажи|список)\s+(у меня\s+)?будильник/.test(low)) return 'alarm_list';
      return 'alarm';
    }
    const fin = financeIntent(low, isQuestion);
    if (fin) return fin;
    const evAct = verbs => new RegExp('^(adis,?\\s*)?(пожалуйста,?\\s*)?(' + verbs + ')\\s+(мою\\s+|мой\\s+|моё\\s+|сегодняшн\\S*\\s+|завтрашн\\S*\\s+)?(' + EVENT_WORDS + ')').test(low);
    if (evAct('отмени|удали|убери')) return 'event_cancel';
    if (evAct('перенеси|сдвинь|передвинь|перенести')) return 'event_move';
    if ((isQuestion && new RegExp('(' + EVENT_WORDS + '|календар|расписани)').test(low)) || /^(что|какие планы) у меня (в|во|на) (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|\d|этой неделе|неделе|следующей неделе|выходные)/.test(low) || /^(покажи|открой)\s+(мой\s+)?(календарь|расписание)/.test(low)) return 'calendar_query';
    if (!/^(напомни|не дай мне забыть|нужно не забыть)/.test(low) && (EVENT_PREFIX.test(t) || (new RegExp('^(' + EVENT_WORDS + ')').test(low) && /(сегодня|завтра|послезавтра|понедельник|вторник|сред|четверг|пятниц|суббот|воскресень|\d)/.test(low)))) return 'event_create';
    if (/(мои|какие|покажи|что у меня|список).*(задач|дела|напоминани)|что у меня (на )?(сегодня|завтра)|какие планы на (сегодня|завтра)|что запланировано/.test(low)) return 'task_query';
    if (/(отч[её]т|сводк|итоги (недели|дня|месяца))/.test(low)) return 'report';
    if (/(напиши|сгенерируй|покажи|создай|помоги написать).*(код|функци|скрипт|программ|класс|запрос sql)|^```/.test(low)) return 'code';
    if (/познакомил(ся|ась|ись)/.test(low) && !isQuestion) return 'introduce';
    if (/(напомни|напоминани|поставь будильник|добавь задачу|создай задачу|запиши задачу|запланируй|не дай мне забыть|нужно не забыть)/.test(low)) return 'reminder';
    if (/^(запомни|сохрани|запиши|заметка|отметь)/.test(low)) return 'memory_save';
    if (/^(я\s+)?(люблю|обожаю|не люблю|предпочитаю|терпеть не могу|мне (не )?нравится|мне удобнее|мой любимый|моя любимая)/.test(low)) return 'preference';
    if (/^(я\s+)?(хочу|планирую|собираюсь|мечтаю|решил|решила)\s/.test(low)) return 'plan';
    if (/^(у меня )?(есть )?иде[яю]/.test(low)) return 'idea';
    if (isQuestion || /(что ты помнишь|вспомни|найди|поищи|что я говорил|что я рассказывал)/.test(low)) return 'memory_query';
    return 'chat';
  }

  A.nlu = {
    PROFESSIONS, parseWhen, extractPerson, extractReminder, findPersonMention, findProfession, professionStems, findTech,
    classifyMemory, memoryTitle, memoryContent, keywords, intent, extractEvent, calendarRange, extractAlarm, describeDays, debtDirection, repaidDirection,
    isSensitive: text => SENSITIVE_RX.test(text),
    nameToNominative
  };
})(window.Adis);
