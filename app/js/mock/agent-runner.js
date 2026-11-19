/* DEMO agents: real computations over the user's data, labelled as demo agents in the UI. */
(function (A) {
  'use strict';
  const U = A.util;

  function planner(d) {
    const today = new Date();
    const tasks = d.tasks.filter(t => !t.done && t.dueAt && (U.isSameDay(t.dueAt, today) || new Date(t.dueAt) < Date.now()));
    const events = d.events.filter(e => U.isSameDay(e.startAt, today));
    const pref = d.memories.find(m => m.type === 'preference' && /встреч/i.test(m.title + m.content));
    const items = [
      ...events.map(e => ({ at: e.startAt, text: `${U.fmtTime(e.startAt)} — ${e.title}${e.location ? ' (' + e.location + ')' : ''}` })),
      ...tasks.map(t => ({ at: new Date(t.dueAt) < Date.now() ? new Date().toISOString() : t.dueAt, text: `${new Date(t.dueAt) < Date.now() ? 'Сначала' : U.fmtTime(t.dueAt)} — ${t.title}${new Date(t.dueAt) < Date.now() ? ' (просрочено)' : ''}` }))
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      steps: ['Читаю задачи на сегодня', 'Проверяю календарь', 'Учитываю предпочтения из памяти', 'Составляю план'],
      result: `## План на ${U.fmtDate(today)}\n\n${items.length ? items.map(i => '- ' + i.text).join('\n') : '- Задач и событий на сегодня нет — хороший день для стратегических дел.'}${pref ? `\n\n**Учтено предпочтение:** ${pref.content}` : ''}\n\n**Совет:** оставь 1–2 часа без встреч для сосредоточенной работы.`
    };
  }

  function network(d) {
    const people = d.people.slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, 3);
    return {
      steps: ['Загружаю контакты', 'Анализирую историю взаимодействий', 'Готовлю сообщения'],
      result: people.length ? `## С кем стоит связаться\n\n${people.map(p => `**${p.name}** — ${p.profession || 'знакомый'}; последний контакт ${U.fmtDate(p.updatedAt)}.\n> Привет, ${p.name.split(' ')[0]}! Давно не общались — как ${p.organization ? 'дела в ' + p.organization : 'твои дела'}? Есть пара идей, хотел бы обсудить.`).join('\n\n')}` : 'В памяти пока нет контактов. Расскажи Adis о своих знакомствах.'
    };
  }

  function memory(d) {
    const by = {};
    d.memories.forEach(m => { by[m.type] = (by[m.type] || 0) + 1; });
    const unconfirmed = d.memories.filter(m => !m.confirmed);
    const tags = {};
    d.memories.forEach(m => (m.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
    const top = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      steps: ['Считаю записи по категориям', 'Ищу неподтверждённые данные', 'Выделяю ключевые темы'],
      result: `## Анализ памяти\n\nВсего записей: **${d.memories.length}**, людей: **${d.people.length}**.\n\n${Object.entries(by).map(([k, v]) => `- ${A.MEMORY_TYPES[k].label}: ${v}`).join('\n')}\n\n**Требуют подтверждения:** ${unconfirmed.length ? unconfirmed.map(m => '«' + m.title + '»').join(', ') : 'нет'}\n\n**Главные темы:** ${top.length ? top.map(([t]) => t).join(', ') : '—'}`
    };
  }

  function generic(agent, d) {
    const n = d.memories.length, t = d.tasks.filter(x => !x.done).length;
    return {
      steps: ['Загружаю инструкции агента', ...(agent.tools || []).map(x => `Вызываю инструмент ${x}`), 'Формирую результат'],
      result: `## ${agent.name}\n\n**Инструкция:** ${agent.instructions || '—'}\n\nДоступно данных: ${n} записей памяти, ${t} активных задач, ${d.people.length} людей.\n\n_Это демонстрационный запуск. С подключённым AI Backend агент выполняет инструкцию языковой моделью по твоим данным._`
    };
  }

  A.agentRunner = {
    run(agent, d, user) {
      const fn = { planner, network, memory, weekly: dd => ({ steps: ['Собираю задачи за неделю', 'Собираю знакомства', 'Формирую отчёт'], result: A.aiEngine.buildReport(dd, user) }) }[agent.builtin];
      const r = fn ? fn(d) : generic(agent, d);
      return { steps: r.steps, result: r.result, status: 'completed' };
    }
  };
})(window.Adis);
