/* DEMO AI ENGINE — emulates the AI Model Gateway: intent → tool calls → answer + interactive cards.
 * Replies are explicitly produced by the demo engine; the real LLM is connected via the AI Backend. */
(function (A) {
  'use strict';
  const U = A.util, N = A.nlu;

  const personLine = p => [p.profession, (p.skills || []).join(', '), p.organization].filter(Boolean).join(' · ');
  const firstName = p => p.name.split(' ')[0];
  const card = (type, data, status = 'info') => ({ id: U.uid('c'), type, status, data });

  function taskLine(t) {
    const when = t.dueAt ? U.fmtDateTime(t.dueAt) : 'без срока';
    const flag = !t.done && t.dueAt && new Date(t.dueAt) < Date.now() ? ' — **просрочено**' : '';
    return `- ${t.title} — ${when}${flag}`;
  }

  function respond(ctx) {
    const { d, user, text, attachments = [], autoSave, sensitiveGuard = true, variant = 0 } = ctx;
    const T = A.mockTools.make(d);
    const toolCalls = [];
    const call = (name, args, fn) => { toolCalls.push({ name, args }); return fn(); };
    const userName = (user.name || '').split(' ')[0];

    const images = attachments.filter(f => f.image);
    if (images.length && images.length === attachments.length && !(text && N.intent(text) === 'reminder')) {
      const f = images[0];
      const caption = (text || '').trim();
      const person = caption ? N.findPersonMention(caption, d.people) : null;
      const memory = {
        type: caption ? N.classifyMemory(caption) : 'event',
        title: caption ? N.memoryTitle(caption) : `Фото · ${U.fmtDate(new Date())}`,
        content: caption ? N.memoryContent(caption) : 'Фото, сделанное в Adis',
        tags: ['фото', ...(caption ? N.keywords(caption).slice(0, 2) : [])], photo: f.image, confirmed: true, personId: person ? person.id : null
      };
      const cards = [];
      if (person && /(это|вот|фото|аватар|портрет)/i.test(caption)) cards.push(card('person_photo', { personId: person.id, personName: person.name, photo: f.image }, 'pending'));
      cards.push(card('memory_save', { memory }, 'pending'));
      const dims = f.width ? ` (${f.width}×${f.height})` : '';
      toolCalls.push({ name: 'memory_save', args: { photo: true } });
      return {
        content: `Фото получил${dims}${images.length > 1 ? ` и ещё ${images.length - 1}` : ''}. ${person ? `Похоже, это связано с **${person.name}**. ` : ''}Могу сохранить его в память${caption ? ' вместе с подписью' : ''} — потом найдёшь его в разделе «Память».\n\n_Распознавание того, что на фото (предметы, текст, люди), выполняет модель AI Backend. В демо-режиме я сохраняю фото и подпись, но не анализирую содержимое._`,
        cards, toolCalls
      };
    }
    const nonImages = attachments.filter(f => !f.image);
    if (nonImages.length) {
      const lines = attachments.map(f => {
        let s = `- **${U.esc(f.name)}** · ${U.fmtBytes(f.size || 0)}`;
        if (f.text) {
          const words = f.text.split(/\s+/).filter(Boolean).length;
          const rows = f.text.split(/\r?\n/).length;
          s += ` · ${rows} ${U.plural(rows, 'строка', 'строки', 'строк')}, ${words} ${U.plural(words, 'слово', 'слова', 'слов')}`;
          const preview = f.text.trim().slice(0, 160).replace(/\s+/g, ' ');
          if (preview) s += `\n  > ${U.esc(preview)}${f.text.length > 160 ? '…' : ''}`;
        }
        return s;
      });
      return {
        content: `Получил ${attachments.length > 1 ? 'файлы' : 'файл'}:\n\n${lines.join('\n')}\n\nПодробный разбор (структура, частые слова, колонки таблиц) — в рабочем пространстве «Анализ файлов».${text ? '\n\nВопрос по файлу я передам языковой модели после подключения AI Backend.' : ''}`,
        cards: [card('open', { route: '#/workspace/files', label: 'Открыть «Анализ файлов»', icon: 'fileSearch' })], toolCalls
      };
    }

    const intent = N.intent(text);

    switch (intent) {
      case 'greeting': {
        const today = d.tasks.filter(t => !t.done && t.dueAt && U.isSameDay(t.dueAt, new Date()));
        const overdue = d.tasks.filter(t => !t.done && t.dueAt && new Date(t.dueAt) < Date.now());
        const ev = d.events.filter(e => new Date(e.startAt) > Date.now()).sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
        const parts = [`Привет${userName ? ', ' + userName : ''}! Я рядом.`];
        if (today.length) parts.push(`Сегодня ${today.length} ${U.plural(today.length, 'задача', 'задачи', 'задач')}.`);
        if (overdue.length) parts.push(`${overdue.length} ${U.plural(overdue.length, 'задача просрочена', 'задачи просрочены', 'задач просрочено')}.`);
        if (ev) parts.push(`Ближайшее событие — «${ev.title}», ${U.fmtDateTime(ev.startAt).toLowerCase()}.`);
        parts.push('\n\nРасскажи, что нового, или попроси что-нибудь напомнить.');
        return { content: parts.join(' '), cards: [], toolCalls };
      }

      case 'about':
        return { content: `Я — **${user.assistantName || 'Adis'}**, твой личный помощник с памятью. Запоминаю людей, факты, контакты и договорённости, напоминаю о делах, веду календарь и будильники, нахожу то, что ты рассказывал раньше.\n\nСейчас работает **демо-режим** без языковой модели. Попробуй: «Запомни номер Артёма +7 999 123-45-67» или «Что у меня завтра?»`, cards: [], toolCalls };

      case 'thanks':
        return { content: ['Всегда пожалуйста!', 'Рад помочь. Обращайся.', 'Готово. Если что-то ещё — я здесь.'][variant % 3], cards: [], toolCalls };

      case 'capabilities':
        return {
          content: 'Вот что я умею:\n\n- **Запоминать людей** — «Сегодня познакомился с Артёмом, он программист»\n- **Находить информацию** — «С кем я недавно познакомился из программистов?»\n- **Напоминать** — «Напомни завтра в 10 позвонить Артёму»\n- **Хранить факты, идеи и предпочтения** — «Запомни, что я не пью кофе после 18»\n- **Планировать день** — «Что у меня на сегодня?»\n- **Готовить отчёты** — «Сделай отчёт за неделю»\n- **Помогать с кодом** — «Напиши функцию сортировки на Python»\n\nВсё, что я запоминаю, видно в разделе **Память** — там можно проверить, изменить или удалить любую запись.',
          cards: [], toolCalls
        };

      case 'introduce': {
        const person = N.extractPerson(text);
        if (!person) break;
        const existing = d.people.find(p => p.name.toLowerCase() === person.name.toLowerCase() || U.sameStem(firstName(p), person.name) && p.name.split(' ').length === 1);
        const memory = {
          type: 'event', title: `Знакомство: ${person.name}`, content: N.memoryContent(text),
          tags: ['знакомство', person.profession && person.profession.toLowerCase()].filter(Boolean)
        };
        const data = { person, memory, existingPersonId: existing ? existing.id : null };
        const desc = [person.profession, person.skills.join(', '), person.organization].filter(Boolean).join(' · ');
        if (autoSave) {
          const res = call('memory_save', data, () => saveIntroduction(T, data, ctx));
          return { content: `Запомнил: **${person.name}**${desc ? ' — ' + desc : ''}. Найти его можно в разделе «Люди».`, cards: [Object.assign(card('memory_save', data, 'confirmed'), { result: res })], toolCalls };
        }
        toolCalls.push({ name: 'entity_lookup', args: { name: person.name } });
        return {
          content: existing
            ? `Похоже, **${existing.name}** уже есть в твоей памяти. Обновить карточку новыми данными?`
            : `Я выделил нового человека — **${person.name}**${desc ? ': ' + desc : ''}. Сохранить в память?`,
          cards: [card('memory_save', data, 'pending')], toolCalls
        };
      }

      case 'people_query': {
        const stems = N.professionStems(text);
        const tech = N.findTech(text);
        const low = text.toLowerCase();
        const recent = /(недавно|на этой неделе|в этом месяце|последн)/.test(low);
        const days = /на этой неделе/.test(low) ? 7 : 31;
        let all = call('entity_lookup', { profession: stems[0] && stems[0].stem, skill: tech[0] }, () => T.entity_lookup({ profession: stems[0] && stems[0].stem, skill: tech[0] }));
        if (!stems.length && !tech.length) all = T.entity_lookup({});
        const fresh = recent ? all.filter(p => Date.now() - new Date(p.metAt || p.createdAt) < days * 86400000) : all;
        const what = stems.length ? `из ${stems[0].name.toLowerCase().replace(/ь$/, 'е').replace(/([^е])$/, '$1')}` : '';
        if (!all.length) return { content: `Пока не нашёл в памяти знакомств${stems.length ? ' с профессией «' + stems[0].name.toLowerCase() + '»' : ''}. Расскажи мне о новом знакомстве — и я запомню.`, cards: [], toolCalls };
        if (recent && !fresh.length) {
          const p = all[0];
          return { content: `За последний месяц таких знакомств не было. Раньше — **${p.name}** (${personLine(p)}), познакомились ${U.fmtDate(p.metAt)}${p.metWhere ? ' ' + p.metWhere : ''}.`, cards: [card('people', { ids: [p.id] })], toolCalls };
        }
        const list = fresh;
        const head = list.length === 1
          ? `${recent ? 'Недавнее знакомство' : 'Нашёл'}${what ? ' ' + plProf(stems[0].name) : ''} — **${list[0].name}**: ${personLine(list[0])}. Познакомились ${U.fmtRelDay(list[0].metAt).toLowerCase()}${list[0].metWhere ? ' ' + list[0].metWhere : ''}.`
          : `Нашёл ${list.length} ${U.plural(list.length, 'человека', 'человек', 'человек')}${what ? ' ' + plProf(stems[0].name) : ''}:\n\n${list.map(p => `- **${p.name}** — ${personLine(p)} (${U.fmtDate(p.metAt)})`).join('\n')}`;
        const older = recent ? all.filter(p => !list.includes(p)) : [];
        const tail = older.length ? `\n\nРаньше также: ${older.map(p => `**${p.name}** (${U.fmtDate(p.metAt)})`).join(', ')}.` : '';
        const related = d.tasks.filter(t => !t.done && list.some(p => p.id === t.personId));
        const rel = related.length ? `\n\nСвязанные задачи:\n${related.map(taskLine).join('\n')}` : '';
        return { content: head + tail + rel, cards: [card('people', { ids: list.map(p => p.id) })], toolCalls };
      }

      case 'entity_lookup': {
        const p = N.findPersonMention(text.replace(/^(кто так(ой|ая)|что (ты )?знаешь|расскажи)/i, ''), d.people);
        toolCalls.push({ name: 'entity_lookup', args: { text } });
        if (!p) return { content: 'Не нашёл такого человека в памяти. Расскажи о нём — и я запомню.', cards: [], toolCalls };
        const mems = d.memories.filter(m => m.personId === p.id);
        const tasks = d.tasks.filter(t => t.personId === p.id && !t.done);
        let c = `**${p.name}**${p.profession ? ' — ' + p.profession.toLowerCase() : ''}${p.organization ? ', ' + p.organization : ''}.`;
        if (p.skills && p.skills.length) c += `\n\n**Навыки:** ${p.skills.join(', ')}`;
        c += `\n\n**Знакомство:** ${U.fmtDate(p.metAt)}${p.metWhere ? ', ' + p.metWhere : ''}`;
        if (p.notes) c += `\n\n**Заметки:** ${p.notes}`;
        if (tasks.length) c += `\n\n**Задачи:**\n${tasks.map(taskLine).join('\n')}`;
        if (mems.length) c += `\n\n**Связанные воспоминания:** ${mems.length}`;
        return { content: c, cards: [card('people', { ids: [p.id] })], toolCalls };
      }

      case 'task_query': {
        const low = text.toLowerCase();
        let list = d.tasks.filter(t => !t.done);
        let label = 'Активные задачи';
        if (/завтра/.test(low)) { list = list.filter(t => t.dueAt && U.isSameDay(t.dueAt, U.addDays(new Date(), 1))); label = 'На завтра'; }
        else if (/сегодня/.test(low)) { list = list.filter(t => t.dueAt && (U.isSameDay(t.dueAt, new Date()) || new Date(t.dueAt) < Date.now())); label = 'На сегодня'; }
        list.sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9'));
        toolCalls.push({ name: 'memory_search', args: { scope: 'tasks' } });
        const events = /сегодня|завтра/.test(low) ? d.events.filter(e => U.isSameDay(e.startAt, /завтра/.test(low) ? U.addDays(new Date(), 1) : new Date())) : [];
        if (!list.length && !events.length) return { content: `${label}: ничего нет. Можно отдохнуть или запланировать что-то новое.`, cards: [], toolCalls };
        let c = `**${label}:**\n\n${list.map(taskLine).join('\n')}`;
        if (events.length) c += `\n\n**События:**\n${events.map(e => `- ${e.title} — ${U.fmtTime(e.startAt)}${e.location ? ', ' + e.location : ''}`).join('\n')}`;
        return { content: c, cards: list.length ? [card('tasks', { ids: list.slice(0, 6).map(t => t.id) })] : [], toolCalls };
      }

      case 'reminder': {
        const r = N.extractReminder(text);
        const person = N.findPersonMention(r.title, d.people);
        const data = { title: r.title, dueAt: r.dueAt, repeat: r.repeat, personId: person ? person.id : null, personName: person ? person.name : null, remind: true };
        toolCalls.push({ name: 'task_create', args: data }, { name: 'notification_schedule', args: { at: r.dueAt } });
        const msg = r.dueAt ? 'Создать напоминание?' : 'Создать напоминание? Время не указано — выбери его на карточке.';
        return { content: msg + (person ? ` Свяжу его с карточкой **${person.name}**.` : ''), cards: [card('task_create', data, 'pending')], toolCalls };
      }

      case 'memory_save':
      case 'preference':
      case 'plan':
      case 'idea': {
        const type = intent === 'idea' ? 'idea' : intent === 'preference' ? 'preference' : N.classifyMemory(text);
        const sensitive = N.isSensitive(text);
        const memory = { type, title: N.memoryTitle(text), content: N.memoryContent(text), tags: N.keywords(text).slice(0, 3), confirmed: type !== 'assumption' };
        const person = N.findPersonMention(text, d.people);
        if (person) memory.personId = person.id;
        const data = { memory, sensitive };
        const typeName = A.MEMORY_TYPES[type].one.toLowerCase();
        if (sensitive && sensitiveGuard) {
          return { content: '⚠ Похоже, здесь **чувствительные данные** (пароль, документы, финансы или здоровье). Я не сохраняю такое автоматически. Если это действительно нужно — подтверди вручную. Пароли лучше хранить в менеджере паролей.', cards: [card('memory_save', data, 'pending')], toolCalls };
        }
        if (autoSave && intent === 'memory_save') {
          const res = call('memory_save', memory, () => T.memory_save(Object.assign({}, memory, { source: { kind: 'chat', excerpt: text, conversationId: ctx.conversationId } })));
          return { content: `Запомнил как ${typeName}: «${memory.title}».`, cards: [Object.assign(card('memory_save', data, 'confirmed'), { result: { memoryId: res.id } })], toolCalls };
        }
        const q = intent === 'memory_save' ? `Сохраню как **${typeName}**. Подтверди:` : `Похоже на ${typeName}. Запомнить?`;
        return { content: q, cards: [card('memory_save', data, 'pending')], toolCalls };
      }

      case 'expense': case 'income': case 'debt': case 'debt_repaid': case 'finance_query':
        return financeTurn(d, text, intent, toolCalls);

      case 'event_create': case 'calendar_query': case 'event_move': case 'event_cancel':
      case 'alarm': case 'alarm_off': case 'alarm_list':
        return calendarTurn(d, text, intent, toolCalls);

      case 'report': {
        toolCalls.push({ name: 'memory_search', args: { period: '7d' } });
        return { content: buildReport(d, user), cards: [card('open', { route: '#/workspace/reports', label: 'Открыть в «Отчётах»', icon: 'report' })], toolCalls };
      }

      case 'code':
        return { content: codeAnswer(text), cards: [card('open', { route: '#/workspace/code', label: 'Открыть «Программирование»', icon: 'code' })], toolCalls };

      default: break;
    }

    /* memory_query + fallback: search memory and people */
    const mems = call('memory_search', { query: text }, () => T.memory_search({ query: text, limit: 5 }));
    const people = d.people.filter(p => N.keywords(text).some(k => [p.name, p.profession, p.organization, ...(p.skills || [])].some(f => f && U.words(f).some(w => U.sameStem(w, k)))));
    if (mems.length || people.length) {
      let c = 'Вот что нашёл в памяти:\n\n';
      c += mems.map(m => `- **${m.title}** — ${A.MEMORY_TYPES[m.type].one.toLowerCase()}, ${U.fmtDate(m.createdAt)}`).join('\n');
      if (people.length) c += (mems.length ? '\n' : '') + people.map(p => `- **${p.name}** — ${personLine(p)}`).join('\n');
      const cards = [];
      if (mems.length) cards.push(card('memories', { ids: mems.map(m => m.id) }));
      if (people.length) cards.push(card('people', { ids: people.map(p => p.id) }));
      return { content: c, cards, toolCalls };
    }
    if (intent === 'memory_query') return { content: 'В памяти ничего не нашёл по этому запросу. Попробуй переформулировать или расскажи мне об этом — я запомню.', cards: [], toolCalls };
    return {
      content: 'Сейчас я работаю в **демо-режиме** без облачной языковой модели, поэтому свободный диалог ограничен. Я уже умею:\n\n- запоминать знакомства и факты\n- искать по памяти\n- создавать напоминания\n- показывать задачи и готовить отчёты\n\nПопробуй: «Напомни завтра в 10 позвонить Артёму» или «Что у меня на сегодня?»',
      cards: [], toolCalls
    };
  }

  /* Finance (port of finance_turn in server/adis/ai/rules.py) */
  const FIN_VERBS = /^\s*(?:я\s+)?(?:потратил[аи]?|потрачено|заплатил[аи]?|оплатил[аи]?|купил[аи]?|расход|трата|получил[аи]?|заработал[аи]?|пришл[оа]|поступил[оа]|начислили|мне перевели|перевели мне)\s*/i;
  function finNote(text, span) {
    let rest = span ? text.slice(0, span[0]) + ' ' + text.slice(span[1]) : text;
    rest = rest.trim().replace(FIN_VERBS, '').trim().replace(/\s+(?:на|за)\s*$/, '').replace(/^\s*(?:на|за)\s+/, '');
    rest = rest.replace(/\s*(?:₽|руб(?:л(?:ей|я|ь))?\.?|р\.)\s*/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,.\-—]+|[\s,.\-—]+$/g, '');
    return U.cap(rest).slice(0, 200);
  }

  function financeTurn(d, text, intent, toolCalls) {
    const F = A.mockFinance, FD = F.make(d), M = U.money;
    const out = (content, cards = []) => ({ content, cards, toolCalls });
    const openFin = card('open', { route: '#/finance', label: 'Открыть «Финансы»', icon: 'wallet' });
    if (intent === 'expense' || intent === 'income') {
      const m = F.parseMoney(text);
      if (!m) return out('Сколько? Назови сумму, например: «Потратил 1200 на продукты».');
      let note = finNote(text, m.span);
      const cat = F.categorize(text, intent);
      if (note && note.split(' ').length === 1 && U.sameStem(note, cat.split(' ')[0])) note = cat;
      const person = N.findPersonMention(text, d.people);
      const when = /(^|\s)вчера(\s|$)/i.test(text) ? U.addDays(new Date(), -1) : new Date();
      const data = { kind: intent, amount: m.amount, currency: m.currency, category: cat, note, occurredAt: when.toISOString(), personId: person ? person.id : null };
      toolCalls.push({ name: 'finance_add', args: data });
      const label = note ? note + (U.sameStem(note.split(' ')[0], cat.split(' ')[0]) ? '' : ` (${cat.toLowerCase()})`) : cat;
      return out(`Записать ${intent === 'expense' ? 'расход' : 'доход'} **${M(m.amount, m.currency)}** — ${label}?`, [card('finance_tx', data, 'pending')]);
    }
    if (intent === 'debt') {
      const m = F.parseMoney(text), direction = N.debtDirection(text);
      const person = N.findPersonMention(text, d.people);
      const name = person ? person.name : F.extractCounterparty(text);
      if (!m) return out('Какая сумма? Например: «Дал Артёму 5000 до пятницы».');
      if (!name) return out('Кто должен или кому ты должен? Например: «Занял у Дмитрия 10000».');
      const rest = text.slice(0, m.span[0]) + ' ' + text.slice(m.span[1]);
      const w = /(до|к|через|вернуть|отдать)\s/i.test(rest) ? N.parseWhen(rest) : { date: null };
      const due = w.date && (w.hasDay || w.hasTime) ? w.date : null;
      const data = { direction, amount: m.amount, currency: m.currency, personId: person ? person.id : null, counterparty: name, dueAt: due ? due.toISOString() : null, note: '' };
      toolCalls.push({ name: 'debt_add', args: data });
      const dueTxt = due ? ` до ${U.fmtDate(due)}` : '';
      const msg = direction === 'lent' ? `Записать: **${name}** должен тебе **${M(m.amount, m.currency)}**${dueTxt}?` : `Записать: ты должен **${F.dative(name)}** **${M(m.amount, m.currency)}**${dueTxt}?`;
      return out(msg + (due ? ' Напомню в срок.' : ''), [card('debt_create', data, 'pending')]);
    }
    if (intent === 'debt_repaid') {
      const dir = N.repaidDirection(text);
      const debt = FD.findOpenDebt(text, dir) || (dir ? FD.findOpenDebt(text) : null);
      toolCalls.push({ name: 'debt_repay', args: { text } });
      if (!debt) return out('Не нашёл открытого долга. Открой «Финансы → Долги», чтобы выбрать вручную.', [openFin]);
      const m = F.parseMoney(text, debt.currency);
      const left = Math.round((debt.amount - (debt.paid || 0)) * 100) / 100;
      const amount = m ? Math.min(m.amount, left) : left, full = amount >= left;
      const data = { debtId: debt.id, amount, full, left, currency: debt.currency, counterparty: debt.counterparty, direction: debt.direction };
      const who = debt.direction === 'lent' ? `**${debt.counterparty}** вернул(а) тебе` : `Ты вернул(а) **${F.dative(debt.counterparty)}**`;
      return out(`${who} **${M(amount, debt.currency)}**${full ? ' — долг закрыт' : ''}?${full ? '' : ` Останется ${M(left - amount, debt.currency)}.`}`, [card('debt_repay', data, 'pending')]);
    }
    const low = text.toLowerCase();
    if (/долг|должен|должна|должны|задолж/.test(low)) {
      const direction = /(кто|сколько)\s+(мне\s+)?(\S+\s+)?(мне\s+)?(должен|должна|должны)|мне\s+должн|мои должники/.test(low) ? 'lent' : /кому\s+я|я\s+(\S+\s+)?должен|я\s+(\S+\s+)?должна/.test(low) ? 'borrowed' : null;
      toolCalls.push({ name: 'debt_list', args: { direction } });
      let debts = FD.debts({ status: 'open', direction });
      const person = N.findPersonMention(text, d.people);
      if (person) debts = debts.filter(x => x.personId === person.id || U.sameStem(x.counterparty.split(' ')[0], person.name.split(' ')[0]));
      if (!debts.length) return out({ lent: 'Тебе никто не должен.', borrowed: 'Ты никому не должен.' }[direction] || 'Открытых долгов нет.', [openFin]);
      const lines = [];
      [['**Тебе должны:**', 'lent'], ['**Ты должен:**', 'borrowed']].forEach(([title, dr]) => {
        const items = debts.filter(x => x.direction === dr); if (!items.length) return;
        lines.push(title);
        const sums = {};
        items.forEach(x => { sums[x.currency] = (sums[x.currency] || 0) + x.left; lines.push(`- ${x.counterparty} — ${M(x.left, x.currency)}${x.dueAt ? `, до ${U.fmtDate(x.dueAt)}${x.overdue ? ' — **просрочено**' : ''}` : ''}`); });
        lines.push('  Итого: ' + Object.entries(sums).map(([c, v]) => M(v, c)).join(', ') + '\n');
      });
      return out(lines.join('\n').trim(), [openFin]);
    }
    const [start, end, label] = FD.period(text);
    const kind = /доход|заработал|получил|поступлен/.test(low) ? 'income' : 'expense';
    const both = /баланс|бюджет|итог|финанс/.test(low);
    const cat = kind === 'expense' ? F.categorize(text, 'expense') : 'Другое';
    toolCalls.push({ name: 'finance_report', args: { category: cat } });
    const sm = FD.summary(start, end);
    if (cat !== 'Другое' && !both) {
      const txs = FD.transactions({ from: start.toISOString(), to: end.toISOString(), kind: 'expense', category: cat });
      if (!txs.length) return out(`${label}: на «${cat.toLowerCase()}» трат нет.`, [openFin]);
      const sums = {}; txs.forEach(t => { sums[t.currency] = (sums[t.currency] || 0) + t.amount; });
      return out(`${label} на «${cat.toLowerCase()}»: **${Object.entries(sums).map(([c, v]) => M(v, c)).join(', ')}** (${txs.length} ${U.plural(txs.length, 'операция', 'операции', 'операций')}).`, [openFin]);
    }
    if (!sm.totals.length) return out(`${label}: операций пока нет. Скажи, например: «Потратил 1200 на продукты».`, [openFin]);
    const lines = [`**${label}:**`];
    sm.totals.forEach(t => {
      if (both || kind === 'income') lines.push(`- Доходы: ${M(t.income, t.currency)}`);
      if (both || kind === 'expense') lines.push(`- Расходы: ${M(t.expense, t.currency)}`);
      if (both) lines.push(`- Баланс: ${M(t.balance, t.currency)}`);
    });
    if ((kind === 'expense' || both) && sm.byCategory.length) lines.push('\n**Больше всего:**\n' + sm.byCategory.slice(0, 5).map(x => `- ${x.category} — ${M(x.amount, x.currency)}`).join('\n'));
    return out(lines.join('\n'), [openFin]);
  }

  /* Calendar & alarms (port of calendar_turn in server/adis/ai/rules.py) */
  const ACTION_WORDS = new Set(['перенеси', 'сдвинь', 'передвинь', 'перенести', 'отмени', 'удали', 'убери', 'встречу', 'встреча', 'мою', 'мой', 'моё', 'сегодняшнюю', 'завтрашнюю', 'событие', 'пожалуйста', 'adis']);
  const openCal = (date, label = 'Открыть календарь') => card('open', { route: '#/calendar' + (date ? '?date=' + U.toLocalDateInput(date) : ''), label, icon: 'calendar' });
  const evLine = e => `- **${U.fmtTime(e.startAt)}${e.endAt && U.isSameDay(e.startAt, e.endAt) ? '–' + U.fmtTime(e.endAt) : ''}** ${e.title}${e.location ? ' · ' + e.location : ''}`;
  const pad = n => String(n).padStart(2, '0');

  function findEvent(d, text, useDay) {
    let events = d.events.filter(e => new Date(e.endAt || e.startAt) >= Date.now() - 2 * 3600000).sort((a, b) => a.startAt.localeCompare(b.startAt));
    if (!events.length) return null;
    if (useDay) {
      const w = N.parseWhen(text);
      if (w.hasDay && w.date) { const day = events.filter(e => U.isSameDay(e.startAt, w.date)); if (day.length) events = day; }
    }
    const person = N.findPersonMention(text, d.people);
    if (person) {
      const first = person.name.split(' ')[0];
      const hit = events.find(e => e.personId === person.id || U.words(e.title).some(w => U.sameStem(w, first)));
      if (hit) return hit;
    }
    const kws = N.keywords(text).filter(k => !ACTION_WORDS.has(k));
    let best = null, bestScore = 0;
    events.forEach(e => {
      const sc = kws.filter(k => U.words(e.title + ' ' + (e.location || '')).some(w => U.sameStem(w, k))).length;
      if (sc > bestScore) { best = e; bestScore = sc; }
    });
    return best || (events.length === 1 ? events[0] : null);
  }

  function calendarTurn(d, text, intent, toolCalls) {
    const out = (content, cards = []) => ({ content, cards, toolCalls });
    if (intent === 'event_create') {
      const ev = N.extractEvent(text);
      const person = N.findPersonMention(ev.title, d.people);
      const data = Object.assign({}, ev, { personId: person ? person.id : null, personName: person ? person.name : null });
      if (ev.startAt) data.conflicts = d.events.filter(e => new Date(e.startAt) < new Date(ev.endAt) && new Date(e.endAt || e.startAt) > new Date(ev.startAt)).map(e => e.title).slice(0, 3);
      toolCalls.push({ name: 'event_create', args: data });
      if (!ev.startAt) return out('Добавить в календарь? Дату я не понял — выбери её на карточке.', [card('event_create', data, 'pending')]);
      return out('Добавить в календарь?' + (data.conflicts.length ? ` В это время уже есть: ${data.conflicts.map(c => '«' + c + '»').join(', ')}.` : ''), [card('event_create', data, 'pending')]);
    }
    if (intent === 'calendar_query') {
      toolCalls.push({ name: 'event_list', args: { text } });
      const person = N.findPersonMention(text, d.people);
      if (person && /когда/i.test(text)) {
        const e = findEvent(d, text, false);
        if (!e) return out(`Ближайших событий с **${person.name}** в календаре нет.`);
        return out(`**${e.title}** — ${U.fmtDateTime(e.startAt).toLowerCase()}${e.location ? ', ' + e.location : ''}.`, [openCal(e.startAt, 'Открыть в календаре')]);
      }
      const r = N.calendarRange(text);
      const events = d.events.filter(e => new Date(e.startAt) < r.end && new Date(e.endAt || e.startAt) >= r.start).sort((a, b) => a.startAt.localeCompare(b.startAt));
      const tasks = d.tasks.filter(t => !t.done && t.dueAt && new Date(t.dueAt) >= r.start && new Date(t.dueAt) < r.end).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      const label = r.label || U.fmtRelDay(r.start);
      if (!events.length && !tasks.length) return out(`${label}: в календаре пусто.`, [openCal(r.start)]);
      const single = r.end - r.start <= 86400000;
      const parts = [`**${label}:**`, ...events.map(e => single ? evLine(e) : `- ${U.fmtDate(e.startAt)}, **${U.fmtTime(e.startAt)}** ${e.title}${e.location ? ' · ' + e.location : ''}`)];
      if (tasks.length) parts.push('\n**Задачи:**\n' + tasks.map(taskLine).join('\n'));
      return out(parts.join('\n'), [...(tasks.length ? [card('tasks', { ids: tasks.slice(0, 6).map(t => t.id) })] : []), openCal(r.start)]);
    }
    if (intent === 'event_move' || intent === 'event_cancel') {
      const e = findEvent(d, text, intent === 'event_cancel');
      toolCalls.push({ name: 'event_update', args: { text } });
      if (!e) return out('Не нашёл такое событие в календаре. Уточни название или открой календарь.', [openCal(null)]);
      const data = { eventId: e.id, title: e.title, oldStartAt: e.startAt, oldEndAt: e.endAt, location: e.location };
      if (intent === 'event_cancel') return out(`Отменить «${e.title}» (${U.fmtDateTime(e.startAt).toLowerCase()})?`, [card('event_update', Object.assign(data, { cancel: true }), 'pending')]);
      const w = N.parseWhen(text.replace(/^\S+\s+/, ''));
      if (!w.date || !(w.hasTime || w.hasDay)) return out(`На когда перенести «${e.title}»? Укажи день или время — или выбери на карточке.`, [card('event_update', Object.assign(data, { startAt: null }), 'pending')]);
      const old = new Date(e.startAt);
      let nw = new Date(w.date);
      if (!w.hasDay) { const x = new Date(old); x.setHours(nw.getHours(), nw.getMinutes(), 0, 0); nw = x; }
      else if (!w.hasTime) nw.setHours(old.getHours(), old.getMinutes(), 0, 0);
      const len = e.endAt ? new Date(e.endAt) - old : 3600000;
      Object.assign(data, { startAt: nw.toISOString(), endAt: new Date(nw.getTime() + len).toISOString() });
      return out(`Перенести «${e.title}» с ${U.fmtDateTime(e.startAt).toLowerCase()} на ${U.fmtDateTime(nw).toLowerCase()}?`, [card('event_update', data, 'pending')]);
    }
    const alarms = (d.alarms || []).slice().sort((a, b) => a.hour * 60 + a.minute - b.hour * 60 - b.minute);
    const openAlarms = (label = 'Будильники') => card('open', { route: '#/alarms', label, icon: 'clock' });
    if (intent === 'alarm_list') {
      if (!alarms.length) return out('Будильников пока нет. Скажи, например: «Поставь будильник на 7:30 по будням».', [openAlarms()]);
      return out(`Будильники (${alarms.filter(a => a.enabled).length} включено):\n\n` + alarms.map(a => `- **${pad(a.hour)}:${pad(a.minute)}** ${N.describeDays(a.days).toLowerCase()}${a.label ? ' · ' + a.label : ''}${a.enabled ? '' : ' (выключен)'}`).join('\n'), [openAlarms('Открыть будильники')]);
    }
    const al = N.extractAlarm(text);
    if (intent === 'alarm_off') {
      const on = alarms.filter(a => a.enabled);
      const target = on.find(a => al.hasTime && a.hour === al.hour && a.minute === al.minute) || (on.length === 1 ? on[0] : null);
      if (!target) return out('Какой будильник выключить? Открой список — там можно выключить любой.', [openAlarms()]);
      toolCalls.push({ name: 'alarm_update', args: { alarmId: target.id, enabled: false } });
      return out(`Выключить будильник на ${pad(target.hour)}:${pad(target.minute)}?`, [card('alarm_update', { alarmId: target.id, time: `${pad(target.hour)}:${pad(target.minute)}`, label: target.label, enabled: false }, 'pending')]);
    }
    const data = { hour: al.hour, minute: al.minute, days: al.days, daysLabel: N.describeDays(al.days), label: al.label };
    toolCalls.push({ name: 'alarm_set', args: data });
    if (!al.hasTime) return out('На какое время поставить будильник? Выбери на карточке.', [card('alarm_set', Object.assign(data, { hour: 7, minute: 0 }), 'pending')]);
    return out(`Поставить будильник на **${pad(al.hour)}:${pad(al.minute)}** (${data.daysLabel.toLowerCase()})?`, [card('alarm_set', data, 'pending')]);
  }

  function plProf(name) {
    const n = name.toLowerCase();
    if (/ь$/.test(n)) return 'из ' + n.slice(0, -1) + 'ей';
    if (/ик$|ст$|ер$|ор$|ог$|ач$|ар$|ант$|ент$/.test(n)) return 'из ' + n + (/(ч|ш|щ|ж)$/.test(n) ? 'ей' : 'ов');
    return `(${n})`;
  }

  function saveIntroduction(T, data, ctx) {
    const p = T.person_save(Object.assign({ id: data.existingPersonId || undefined }, data.person, data.existingPersonId ? { interaction: data.memory.content } : {}));
    const m = T.memory_save(Object.assign({}, data.memory, { personId: p.id, source: { kind: ctx.source || 'chat', excerpt: ctx.text, conversationId: ctx.conversationId } }));
    return { personId: p.id, memoryId: m.id };
  }

  function buildReport(d, user) {
    const week = Date.now() - 7 * 86400000;
    const done = d.tasks.filter(t => t.done && new Date(t.doneAt || t.updatedAt) > week);
    const active = d.tasks.filter(t => !t.done);
    const overdue = active.filter(t => t.dueAt && new Date(t.dueAt) < Date.now());
    const people = d.people.filter(p => new Date(p.metAt || p.createdAt) > week);
    const mems = d.memories.filter(m => new Date(m.createdAt) > week);
    const plans = d.memories.filter(m => m.type === 'plan' || m.type === 'intention');
    return [
      `## Отчёт за неделю`,
      `${U.fmtDate(new Date(week))} — ${U.fmtDate(new Date())}`,
      ``,
      `**Задачи:** выполнено ${done.length}, активно ${active.length}, просрочено ${overdue.length}.`,
      done.length ? done.map(t => `- ✓ ${t.title}`).join('\n') : '- Выполненных задач пока нет',
      ``,
      `**Новые знакомства:** ${people.length}`,
      people.length ? people.map(p => `- ${p.name}${p.profession ? ' — ' + p.profession.toLowerCase() : ''}`).join('\n') : '- Нет',
      ``,
      `**Новое в памяти:** ${mems.length} ${U.plural(mems.length, 'запись', 'записи', 'записей')}`,
      ``,
      `**Планы в работе:**`,
      plans.length ? plans.map(m => `- ${m.title}`).join('\n') : '- Нет сохранённых планов',
      overdue.length ? `\n**Рекомендация:** закрой или перенеси ${overdue.length} ${U.plural(overdue.length, 'просроченную задачу', 'просроченные задачи', 'просроченных задач')} — это разгрузит неделю.` : ''
    ].join('\n');
  }

  function codeAnswer(text) {
    const low = text.toLowerCase();
    if (/фибоначч/.test(low)) return 'Пример на Python:\n\n```python\ndef fibonacci(n: int) -> list[int]:\n    """Первые n чисел Фибоначчи."""\n    seq = [0, 1]\n    while len(seq) < n:\n        seq.append(seq[-1] + seq[-2])\n    return seq[:n]\n\nprint(fibonacci(10))\n```\n\nСложность — O(n) по времени и памяти.';
    if (/fastapi|api|эндпоинт|endpoint/.test(low)) return 'Минимальный эндпоинт на FastAPI:\n\n```python\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Task(BaseModel):\n    title: str\n    due_at: str | None = None\n\n@app.post("/tasks")\nasync def create_task(task: Task):\n    return {"id": 1, **task.model_dump()}\n```\n\nЗапуск: `uvicorn main:app --reload`.';
    if (/javascript|js|джаваскрипт/.test(low)) return 'Пример на JavaScript:\n\n```javascript\nconst groupBy = (items, key) =>\n  items.reduce((acc, item) => {\n    (acc[item[key]] ||= []).push(item);\n    return acc;\n  }, {});\n\nconsole.log(groupBy([{ t: "a" }, { t: "b" }, { t: "a" }], "t"));\n```\n\nЭтот код можно запустить в рабочем пространстве «Программирование».';
    return 'Пример функции сортировки на Python:\n\n```python\ndef quick_sort(items: list[int]) -> list[int]:\n    if len(items) <= 1:\n        return items\n    pivot, *rest = items\n    left = [x for x in rest if x < pivot]\n    right = [x for x in rest if x >= pivot]\n    return quick_sort(left) + [pivot] + quick_sort(right)\n\nprint(quick_sort([5, 3, 8, 1, 9, 2]))\n```\n\nВ демо-режиме я показываю шаблонные примеры. Генерация кода под любую задачу появится после подключения языковой модели.';
  }

  A.aiEngine = { respond, saveIntroduction, buildReport };
})(window.Adis);
