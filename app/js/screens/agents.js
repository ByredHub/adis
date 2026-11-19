/* AI agents: list, capabilities, create/configure, run with live steps, stop, results, run history. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const TOOL_LABELS = { memory_search: 'Поиск в памяти', memory_save: 'Сохранение в память', entity_lookup: 'Поиск людей', task_create: 'Создание задач', task_update: 'Изменение задач', notification_schedule: 'Уведомления', proactive_suggestion: 'Предложения', finance: 'Финансы (только чтение)' };

  function agentForm(a, onSaved) {
    a = a || {};
    ui.sheet({
      title: a.id ? 'Настройка агента' : 'Новый агент',
      body: `<form novalidate>
        <div class="field"><label>Название</label><input class="input" name="name" value="${U.esc(a.name || '')}" placeholder="Например, «Помощник по учёбе»" autofocus></div>
        <div class="field"><label>Что делает</label><input class="input" name="description" value="${U.esc(a.description || '')}"></div>
        <div class="field"><label>Инструкция для агента</label><textarea class="textarea" name="instructions" placeholder="Опишите задачу простыми словами">${U.esc(a.instructions || '')}</textarea></div>
        <div class="field"><label>Доступ к инструментам</label><div class="col gap-2">${Object.entries(TOOL_LABELS).map(([k, l]) => `<label class="row between card flat" style="padding:10px 14px"><span class="small bold">${l}</span><input type="checkbox" name="tools[]" value="${k}" ${(a.tools || ['memory_search']).includes(k) ? 'checked' : ''}></label>`).join('')}</div>
          <div class="hint">Агент работает только через разрешённые инструменты с проверкой прав.</div></div>
        <button class="btn btn-primary btn-block" type="submit">${a.id ? 'Сохранить' : 'Создать агента'}</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault();
          const v = ui.formData(f);
          if (!v.name) return ui.fieldError(f, 'name', 'Введите название');
          const tools = Array.from(f.querySelectorAll('input[name="tools[]"]:checked')).map(x => x.value);
          ui.guard(f.querySelector('[type=submit]'), async () => {
            const r = a.id ? await repo.agents.update(a.id, { name: v.name, description: v.description, instructions: v.instructions, tools }) : await repo.agents.create({ name: v.name, description: v.description, instructions: v.instructions, tools });
            close(); ui.toast(a.id ? 'Агент обновлён' : 'Агент создан', 'success'); onSaved && onSaved(r);
          });
        };
      }
    });
  }

  A.router.register('/agents', el => {
    el.innerHTML = `${ui.appbar({ back: true, title: 'AI-агенты', demo: true, actions: `<button class="icon-btn soft" data-add aria-label="Создать агента">${I('plus')}</button>` })}
      <main class="content"><p class="muted small">Агенты выполняют многошаговые задачи, используя вашу память и задачи.</p><div class="col mt-4" data-list></div></main>`;
    const listEl = el.querySelector('[data-list]');
    const load = () => ui.load(listEl, () => repo.agents.list(), list => {
      if (!list.length) { listEl.innerHTML = ui.empty({ icon: 'bot', title: 'Агентов пока нет', action: '<button class="btn btn-primary" data-add2>Создать агента</button>' }); listEl.querySelector('[data-add2]').onclick = () => agentForm(null, a => A.router.go('#/agent/' + a.id)); return; }
      listEl.innerHTML = list.map(a => `<a class="card row pressable agent-card" href="#/agent/${a.id}" style="align-items:flex-start;color:inherit"><div class="ico-tile">${I(a.icon || 'bot')}</div><div class="grow"><div class="row gap-2"><span class="bold">${U.esc(a.name)}</span>${a.demo ? '<span class="demo-badge">Демо</span>' : ''}</div><div class="small muted mt-1">${U.esc(a.description || 'Без описания')}</div></div>${I('chevron', 'sm')}</a>`).join('');
    });
    load();
    el.querySelector('[data-add]').onclick = () => agentForm(null, a => A.router.go('#/agent/' + a.id));
  }, { backTo: '#/tools' });

  A.router.register('/agent/:id', async (el, ctx) => {
    el.innerHTML = `${ui.appbar({ back: true, title: 'Агент' })}<main class="content">${ui.loading()}</main>`;
    const main = el.querySelector('main');
    let a, runs = [];
    try {
      a = (await repo.agents.list()).find(x => x.id === ctx.params.id);
      if (!a) throw new A.ApiError('not_found', 'Агент не найден');
      runs = await repo.agents.runs(a.id);
    } catch (e) { main.innerHTML = ui.error(e); return; }
    let running = null;

    el.querySelector('.appbar').outerHTML = ui.appbar({ back: true, title: a.name, actions: a.demo ? '' : `<button class="icon-btn" data-edit aria-label="Настроить">${I('sliders')}</button><button class="icon-btn" data-del aria-label="Удалить">${I('trash')}</button>` });
    main.innerHTML = `
      <div class="detail-head"><div class="ico-tile" style="width:56px;height:56px;border-radius:18px">${I(a.icon || 'bot', 'lg')}</div><div><div class="row gap-2"><h1 class="t-h1">${U.esc(a.name)}</h1></div>${a.demo ? '<span class="demo-badge mt-1">Демо-агент</span>' : ''}</div></div>
      <p class="muted mt-3">${U.esc(a.description || '')}</p>
      <div class="section"><div class="t-label mb-2">Возможности</div><div class="chips wrap">${(a.tools || []).map(t => `<span class="tag primary">${U.esc(TOOL_LABELS[t] || t)}</span>`).join('') || '<span class="muted small">Нет доступа к инструментам</span>'}</div></div>
      ${a.instructions ? `<div class="section"><div class="t-label mb-2">Инструкция</div><div class="card small">${U.esc(a.instructions)}</div></div>` : ''}
      <div class="section"><button class="btn btn-primary btn-block" data-run>${I('play', 'sm')}Запустить</button></div>
      <div data-live></div>
      <div class="section"><div class="t-label mb-2">История запусков</div><div data-runs></div></div>`;

    const runsEl = main.querySelector('[data-runs]'), live = main.querySelector('[data-live]'), runBtn = main.querySelector('[data-run]');
    const statusTag = s => s === 'completed' ? '<span class="tag success">Готово</span>' : s === 'stopped' ? '<span class="tag warning">Остановлен</span>' : '<span class="tag info">Выполняется</span>';
    function drawRuns() {
      runsEl.innerHTML = runs.length ? `<div class="list">${runs.map(r => `<button class="list-item no-icon" data-run-id="${r.id}"><div class="grow"><div class="li-title">${U.fmtDateTime(r.startedAt)}</div><div class="li-sub">${r.steps.length} ${U.plural(r.steps.length, 'шаг', 'шага', 'шагов')}</div></div>${statusTag(r.status)}</button>`).join('')}</div>` : '<p class="muted small">Агент ещё не запускался.</p>';
      runsEl.querySelectorAll('[data-run-id]').forEach(b => b.onclick = () => {
        const r = runs.find(x => x.id === b.dataset.runId);
        ui.sheet({ title: 'Результат запуска', body: `<div class="small faint mb-3">${U.fmtDateTime(r.startedAt)} · ${statusTag(r.status)}</div><div class="md">${A.markdown.render(r.result)}</div>` });
      });
    }
    drawRuns();

    runBtn.onclick = async () => {
      if (running) { running.stopped = true; return; }
      running = { stopped: false };
      runBtn.innerHTML = `${I('stop', 'sm')}Остановить`; runBtn.classList.replace('btn-primary', 'btn-danger');
      live.innerHTML = `<div class="section card"><div class="t-label mb-2">Выполнение</div><div class="steps"></div><div class="md mt-3" data-result></div></div>`;
      const stepsEl = live.querySelector('.steps');
      let run;
      try { run = await repo.agents.run(a.id); } catch (e) { ui.toast(e.userMessage, 'error'); reset(); return; }
      for (let i = 0; i < run.steps.length; i++) {
        stepsEl.insertAdjacentHTML('beforeend', `<div class="step active"><span class="spinner" style="width:16px;height:16px;border-width:2px"></span><span>${U.esc(run.steps[i])}</span></div>`);
        await U.sleep(650);
        const node = stepsEl.lastElementChild;
        if (running.stopped) { node.className = 'step'; node.innerHTML = `${I('x', 'sm')}<span>${U.esc(run.steps[i])} — остановлено</span>`; break; }
        node.className = 'step done'; node.innerHTML = `${I('check', 'sm')}<span>${U.esc(run.steps[i])}</span>`;
      }
      if (running.stopped) {
        const stopped = await repo.agents.stop(run.id).catch(() => null);
        live.querySelector('[data-result]').innerHTML = '<p class="muted">Запуск остановлен пользователем.</p>';
        run = Object.assign(run, stopped || { status: 'stopped' });
        ui.toast('Агент остановлен', 'info');
      } else {
        live.querySelector('[data-result]').innerHTML = A.markdown.render(run.result);
      }
      runs.unshift(run); drawRuns(); reset();
    };
    function reset() { running = null; runBtn.innerHTML = `${I('play', 'sm')}Запустить снова`; runBtn.classList.replace('btn-danger', 'btn-primary'); }

    const ed = el.querySelector('[data-edit]'); if (ed) ed.onclick = () => agentForm(a, () => ctx.refresh());
    const del = el.querySelector('[data-del]'); if (del) del.onclick = async () => {
      if (!(await ui.confirmDanger('Удалить агента?', 'История запусков тоже будет удалена.'))) return;
      ui.guard(null, async () => { await repo.agents.remove(a.id); ui.toast('Агент удалён', 'success'); A.router.back('#/agents'); });
    };
    ctx.onLeave(() => { if (running) running.stopped = true; });
  }, { backTo: '#/agents' });
})(window.Adis);
