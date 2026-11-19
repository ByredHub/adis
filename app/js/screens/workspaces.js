/* Tools hub + full-screen workspaces: code, analytics, documents, reports, file analysis, data.
 * Each workspace has its own UI but uses the shared memory/tasks data and can hand off to the Adis chat. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;

  const WS = {
    code: { title: 'Программирование', icon: 'code', desc: 'Редактор и запуск JavaScript, помощь Adis с кодом' },
    analytics: { title: 'Бизнес-аналитика', icon: 'chart', desc: 'Выручка, расходы, маржа и динамика' },
    docs: { title: 'Документы', icon: 'file', desc: 'Заметки и документы с Markdown' },
    reports: { title: 'Отчёты', icon: 'report', desc: 'Сводки по задачам, людям и памяти' },
    files: { title: 'Анализ файлов', icon: 'fileSearch', desc: 'Структура, статистика и содержимое файлов' },
    data: { title: 'Работа с данными', icon: 'table', desc: 'Таблицы CSV: сортировка, статистика, графики' }
  };

  A.router.register('/tools', el => {
    el.innerHTML = `${ui.appbar({ back: true, title: 'Инструменты' })}
      <main class="content">
        <div class="ws-grid">${Object.entries(WS).map(([k, w]) => `<a class="ws-tile" href="#/workspace/${k}"><span class="ico-tile">${I(w.icon)}</span><b>${w.title}</b><span class="small muted">${w.desc}</span></a>`).join('')}</div>
        <div class="section list">
          <a class="list-item" href="#/finance"><div class="ico-tile">${I('wallet')}</div><div class="grow"><div class="li-title">Финансы</div><div class="li-sub">Расходы, доходы и долги</div></div>${I('chevron', 'sm')}</a>
          <a class="list-item" href="#/agents"><div class="ico-tile">${I('bot')}</div><div class="grow"><div class="li-title">AI-агенты</div><div class="li-sub">Многошаговые задачи на ваших данных</div></div>${I('chevron', 'sm')}</a>
          <a class="list-item" href="#/proactive"><div class="ico-tile">${I('sparkles')}</div><div class="grow"><div class="li-title">Проактивный помощник</div><div class="li-sub">Подсказки и напоминания от Adis</div></div>${I('chevron', 'sm')}</a>
          <a class="list-item" href="#/calendar"><div class="ico-tile">${I('calendar')}</div><div class="grow"><div class="li-title">Календарь</div><div class="li-sub">События и задачи по дням</div></div>${I('chevron', 'sm')}</a>
          <a class="list-item" href="#/people"><div class="ico-tile">${I('users')}</div><div class="grow"><div class="li-title">Люди</div><div class="li-sub">Знакомства и контакты</div></div>${I('chevron', 'sm')}</a>
        </div>
      </main>`;
  }, { backTo: '#/home' });

  /* ---------- shared helpers ---------- */
  function parseCSV(text) {
    const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : (text.includes('\t') ? '\t' : ',');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const clean = rows.filter(r => r.some(x => x.trim() !== ''));
    return { header: (clean[0] || []).map(h => h.trim()), rows: clean.slice(1) };
  }
  const num = v => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
  const fmtNum = n => (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('ru-RU') : (Math.round(n * 100) / 100).toLocaleString('ru-RU'));

  function barChart(labels, series, { height = 180 } = {}) {
    const max = Math.max(1, ...series.flatMap(s => s.values.map(v => Math.abs(v || 0))));
    const n = labels.length, w = 320, bw = (w - 20) / n / series.length - 4;
    const colors = ['var(--primary)', 'var(--accent)', 'var(--success)'];
    let bars = '';
    labels.forEach((l, i) => series.forEach((s, j) => {
      const v = s.values[i] || 0, h = (Math.abs(v) / max) * (height - 30);
      const x = 10 + i * ((w - 20) / n) + j * (bw + 4);
      bars += `<rect x="${x}" y="${height - 20 - h}" width="${Math.max(2, bw)}" height="${h}" rx="3" fill="${colors[j % 3]}" opacity="${v < 0 ? 0.4 : 1}"><title>${U.esc(l)}: ${fmtNum(v)}</title></rect>`;
    }));
    const lbl = labels.map((l, i) => n <= 12 ? `<text x="${10 + i * ((w - 20) / n) + ((w - 20) / n) / 2 - 2}" y="${height - 4}" font-size="9" text-anchor="middle" fill="var(--text-3)">${U.esc(String(l).slice(0, 6))}</text>` : '').join('');
    return `<svg class="chart" viewBox="0 0 ${w} ${height}" role="img" aria-label="График">${bars}${lbl}</svg>
      <div class="row gap-4 small mt-2">${series.map((s, j) => `<span class="row gap-1"><i class="legend" style="background:${colors[j % 3]}"></i>${U.esc(s.name)}</span>`).join('')}</div>`;
  }

  function askAdis(prompt) { A.router.go('#/chat/new?q=' + encodeURIComponent(prompt)); }

  /* ---------- workspaces ---------- */
  const renderers = {
    code(main) {
      const saved = A.storage.get('ws.code', { lang: 'javascript', src: '// Нажмите «Запустить», чтобы выполнить код в изолированной песочнице\nconst tasks = [\n  { title: "Питч-дек", hours: 3 },\n  { title: "Звонок инвестору", hours: 1 },\n  { title: "Дизайн онбординга", hours: 5 }\n];\n\nconst total = tasks.reduce((s, t) => s + t.hours, 0);\nconsole.log("Всего часов:", total);\nconsole.table(tasks.sort((a, b) => b.hours - a.hours));\n' });
      main.innerHTML = `
        <div class="row gap-2"><select class="select" style="min-height:42px;width:auto" data-lang><option value="javascript">JavaScript</option><option value="python">Python (просмотр)</option><option value="sql">SQL (просмотр)</option></select><span class="grow"></span>
          <button class="btn btn-primary btn-sm" data-run>${I('play', 'sm')}Запустить</button></div>
        <div class="editor mt-3"><pre class="hl" aria-hidden="true"><code></code></pre><textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Код"></textarea></div>
        <div class="t-label mt-4 mb-2">Вывод</div><pre class="console" data-out>—</pre>
        <div class="row gap-2 mt-4 wrap"><button class="btn btn-secondary btn-sm" data-explain>${I('sparkles', 'sm')}Объяснить код</button><button class="btn btn-outline btn-sm" data-copy>${I('copy', 'sm')}Копировать</button><button class="btn btn-outline btn-sm" data-save-doc>${I('file', 'sm')}В документы</button></div>
        <p class="tiny faint mt-3">Код выполняется локально в изолированном iframe без доступа к вашим данным. Python и SQL будут выполняться на сервере после подключения AI Backend.</p>`;
      const ta = main.querySelector('textarea'), hl = main.querySelector('.hl code'), lang = main.querySelector('[data-lang]'), out = main.querySelector('[data-out]');
      ta.value = saved.src; lang.value = saved.lang;
      const sync = () => { hl.innerHTML = A.markdown.highlight(ta.value, lang.value) + '\n'; A.storage.set('ws.code', { lang: lang.value, src: ta.value }); main.querySelector('[data-run]').disabled = lang.value !== 'javascript'; };
      ta.addEventListener('input', sync); lang.onchange = sync;
      ta.addEventListener('scroll', () => { hl.parentElement.scrollTop = ta.scrollTop; hl.parentElement.scrollLeft = ta.scrollLeft; });
      ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); sync(); } });
      sync();
      main.querySelector('[data-run]').onclick = () => {
        out.textContent = 'Выполняется…';
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts'); frame.style.display = 'none';
        const id = U.uid('run');
        const lines = [];
        const onMsg = e => {
          if (!e.data || e.data.id !== id) return;
          if (e.data.type === 'log') lines.push(e.data.text);
          if (e.data.type === 'end') { finish(); }
        };
        const finish = () => { window.removeEventListener('message', onMsg); clearTimeout(timer); frame.remove(); out.textContent = lines.join('\n') || '(нет вывода)'; };
        const timer = setTimeout(() => { lines.push('⏱ Остановлено: превышено время выполнения (3 с)'); finish(); }, 3000);
        window.addEventListener('message', onMsg);
        const code = JSON.stringify(ta.value).replace(/<\//g, '<\\/');
        frame.srcdoc = `<script>const id=${JSON.stringify(id)};const send=(t)=>parent.postMessage({id,type:'log',text:t},'*');const f=v=>typeof v==='object'?JSON.stringify(v,null,2):String(v);
console.log=(...a)=>send(a.map(f).join(' '));console.error=(...a)=>send('Ошибка: '+a.map(f).join(' '));console.warn=console.log;console.table=(r)=>send(Array.isArray(r)?r.map(x=>Object.values(x).join(' | ')).join('\\n'):f(r));
try{const r=(0,eval)(${code});if(r!==undefined)send('→ '+f(r));}catch(e){send('Ошибка: '+e.message);}parent.postMessage({id,type:'end'},'*');<\/script>`;
        document.body.appendChild(frame);
      };
      main.querySelector('[data-explain]').onclick = () => askAdis('Объясни этот код:\n```' + lang.value + '\n' + ta.value.slice(0, 3000) + '\n```');
      main.querySelector('[data-copy]').onclick = async () => ui.toast((await U.copy(ta.value)) ? 'Код скопирован' : 'Ошибка', 'success');
      main.querySelector('[data-save-doc]').onclick = e => ui.guard(e.currentTarget, async () => { await repo.documents.create({ title: 'Код ' + U.fmtDate(new Date()), content: '```' + lang.value + '\n' + ta.value + '\n```' }); ui.toast('Сохранено в документы', 'success'); });
    },

    analytics(main) {
      const def = A.storage.get('ws.analytics', { rows: [['Июл', 120000, 90000], ['Авг', 150000, 95000], ['Сен', 180000, 110000], ['Окт', 240000, 130000], ['Ноя', 310000, 160000]], demo: true });
      let rows = def.rows;
      main.innerHTML = `${def.demo ? `<div class="banner info mb-3">${I('info', 'sm')}<span>Пример данных — замените своими цифрами.</span></div>` : ''}
        <div class="kpis" data-kpis></div>
        <div class="card mt-4" data-chart></div>
        <div class="section"><div class="section-head"><h3>Данные по месяцам</h3><button class="link-btn" data-add>${I('plus', 'sm')} Строка</button></div>
          <div class="card flat" style="padding:0;overflow:auto"><table class="tbl edit"><thead><tr><th>Период</th><th>Выручка</th><th>Расходы</th><th></th></tr></thead><tbody></tbody></table></div></div>
        <div class="card tinted mt-4" data-insight></div>
        <div class="row gap-2 mt-4"><button class="btn btn-secondary btn-sm" data-ask>${I('sparkles', 'sm')}Обсудить с Adis</button><button class="btn btn-outline btn-sm" data-save>${I('memory', 'sm')}Сохранить вывод в память</button></div>`;
      const tbody = main.querySelector('tbody');
      const save = () => A.storage.set('ws.analytics', { rows, demo: false });
      function calc() {
        const rev = rows.map(r => num(r[1]) || 0), cost = rows.map(r => num(r[2]) || 0);
        const R = rev.reduce((a, b) => a + b, 0), C = cost.reduce((a, b) => a + b, 0), P = R - C;
        const growth = rev.length > 1 && rev[rev.length - 2] ? ((rev[rev.length - 1] - rev[rev.length - 2]) / rev[rev.length - 2]) * 100 : 0;
        const cmgr = rev.length > 1 && rev[0] > 0 ? (Math.pow(rev[rev.length - 1] / rev[0], 1 / (rev.length - 1)) - 1) * 100 : 0;
        main.querySelector('[data-kpis]').innerHTML = [['Выручка', fmtNum(R) + ' ₽'], ['Прибыль', fmtNum(P) + ' ₽'], ['Маржа', R ? Math.round(P / R * 100) + '%' : '—'], ['Рост м/м', (growth >= 0 ? '+' : '') + Math.round(growth) + '%']].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join('');
        main.querySelector('[data-chart]').innerHTML = barChart(rows.map(r => r[0]), [{ name: 'Выручка', values: rev }, { name: 'Расходы', values: cost }]);
        const best = rows[rev.indexOf(Math.max(...rev))];
        const insight = rows.length ? `Средний ежемесячный рост выручки (CMGR) — **${Math.round(cmgr)}%**. Лучший период — **${U.esc(best ? best[0] : '—')}**. ${P >= 0 ? `Бизнес прибылен: маржа ${R ? Math.round(P / R * 100) : 0}%.` : 'Расходы превышают выручку — стоит пересмотреть затраты.'}` : 'Добавьте данные.';
        main.querySelector('[data-insight]').innerHTML = `<div class="row mb-2">${I('sparkles', 'sm')}<b>Вывод</b></div><div class="md small">${A.markdown.render(insight)}</div>`;
        main.dataset.insight = insight.replace(/\*\*/g, '');
      }
      function drawRows() {
        tbody.innerHTML = rows.map((r, i) => `<tr>${r.map((c, j) => `<td><input value="${U.esc(c)}" data-r="${i}" data-c="${j}" ${j ? 'inputmode="decimal"' : ''} aria-label="Ячейка"></td>`).join('')}<td><button class="icon-btn" data-rm="${i}" aria-label="Удалить строку">${I('x', 'sm')}</button></td></tr>`).join('');
        tbody.querySelectorAll('input').forEach(inp => inp.oninput = () => { rows[inp.dataset.r][inp.dataset.c] = inp.dataset.c === '0' ? inp.value : (num(inp.value) ?? 0); save(); calc(); });
        tbody.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { rows.splice(+b.dataset.rm, 1); save(); drawRows(); calc(); });
      }
      main.querySelector('[data-add]').onclick = () => { rows.push(['Период ' + (rows.length + 1), 0, 0]); save(); drawRows(); calc(); };
      main.querySelector('[data-ask]').onclick = () => askAdis('Проанализируй мои бизнес-показатели: ' + rows.map(r => `${r[0]}: выручка ${r[1]}, расходы ${r[2]}`).join('; '));
      main.querySelector('[data-save]').onclick = e => ui.guard(e.currentTarget, async () => { await repo.memory.create({ type: 'knowledge', title: 'Вывод по бизнес-показателям', content: main.dataset.insight, tags: ['аналитика'], source: { kind: 'manual', excerpt: 'Рабочее пространство «Бизнес-аналитика»' } }); ui.toast('Вывод сохранён в память', 'success'); });
      drawRows(); calc();
    },

    async docs(main) {
      const draw = async () => ui.load(main, () => repo.documents.list(), list => {
        main.innerHTML = `<button class="btn btn-primary btn-block" data-new>${I('plus', 'sm')}Новый документ</button><div class="mt-4">${list.length ? `<div class="list">${list.map(d => `<button class="list-item" data-doc="${d.id}"><div class="ico-tile">${I('file')}</div><div class="grow" style="min-width:0"><div class="li-title ellipsis">${U.esc(d.title)}</div><div class="li-sub">Изменён ${U.fmtAgo(d.updatedAt)}</div></div>${I('chevron', 'sm')}</button>`).join('')}</div>` : ui.empty({ icon: 'file', title: 'Документов пока нет', text: 'Создайте заметку, план или черновик письма.' })}</div>`;
        main.querySelector('[data-new]').onclick = e => ui.guard(e.currentTarget, async () => { const d = await repo.documents.create({ title: 'Новый документ', content: '' }); edit(d); });
        main.querySelectorAll('[data-doc]').forEach(b => b.onclick = () => edit(list.find(d => d.id === b.dataset.doc)));
      });
      function edit(doc) {
        main.innerHTML = `<div class="row gap-2"><button class="btn btn-ghost btn-sm" data-list>${I('back', 'sm')}Все документы</button><span class="grow"></span><span class="tiny faint" data-saved>Сохранено</span></div>
          <input class="input doc-title mt-3" value="${U.esc(doc.title)}" aria-label="Название документа">
          <div class="segmented mt-3"><button class="active" data-mode="edit">Редактор</button><button data-mode="preview">Просмотр</button></div>
          <textarea class="textarea doc-body mt-3" placeholder="Пишите в Markdown: # заголовок, **жирный**, - список">${U.esc(doc.content)}</textarea>
          <div class="card md doc-preview mt-3 hidden"></div>
          <div class="row gap-2 mt-4 wrap"><button class="btn btn-secondary btn-sm" data-mem>${I('memory', 'sm')}В память</button><button class="btn btn-outline btn-sm" data-ask>${I('sparkles', 'sm')}Спросить Adis</button><button class="btn btn-outline btn-sm" data-dl>${I('download', 'sm')}Скачать .md</button><button class="btn btn-danger btn-sm" data-del>${I('trash', 'sm')}Удалить</button></div>`;
        const title = main.querySelector('.doc-title'), body = main.querySelector('.doc-body'), saved = main.querySelector('[data-saved]');
        const persist = U.debounce(async () => { try { await repo.documents.update(doc.id, { title: title.value || 'Без названия', content: body.value }); saved.textContent = 'Сохранено'; } catch (e) { saved.textContent = 'Не сохранено'; } }, 600);
        [title, body].forEach(x => x.addEventListener('input', () => { saved.textContent = 'Сохранение…'; persist(); }));
        main.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
          const pv = b.dataset.mode === 'preview';
          main.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b));
          body.classList.toggle('hidden', pv); main.querySelector('.doc-preview').classList.toggle('hidden', !pv);
          if (pv) main.querySelector('.doc-preview').innerHTML = A.markdown.render(body.value) || '<p class="muted">Пусто</p>';
        });
        main.querySelector('[data-list]').onclick = () => draw();
        main.querySelector('[data-mem]').onclick = e => ui.guard(e.currentTarget, async () => { await repo.memory.create({ type: 'knowledge', title: title.value, content: body.value.slice(0, 2000), tags: ['документ'], source: { kind: 'manual', excerpt: 'Документ «' + title.value + '»' } }); ui.toast('Документ сохранён в память', 'success'); });
        main.querySelector('[data-ask]').onclick = () => askAdis(`Помоги с документом «${title.value}»:\n\n${body.value.slice(0, 2500)}`);
        main.querySelector('[data-dl]').onclick = () => U.download((title.value || 'document') + '.md', body.value, 'text/markdown');
        main.querySelector('[data-del]').onclick = async () => { if (await ui.confirmDanger('Удалить документ?', `«${title.value}» будет удалён.`)) ui.guard(null, async () => { await repo.documents.remove(doc.id); ui.toast('Документ удалён', 'success'); draw(); }); };
      }
      draw();
    },

    async reports(main) {
      main.innerHTML = `<div class="segmented" data-kind><button class="active" data-k="week">Неделя</button><button data-k="people">Люди</button><button data-k="tasks">Задачи</button><button data-k="memory">Память</button></div><div class="card md mt-4" data-out>${ui.loading('Готовлю отчёт…')}</div>
        <div class="row gap-2 mt-4 wrap"><button class="btn btn-secondary btn-sm" data-copy>${I('copy', 'sm')}Копировать</button><button class="btn btn-outline btn-sm" data-dl>${I('download', 'sm')}Скачать</button><button class="btn btn-outline btn-sm" data-doc>${I('file', 'sm')}В документы</button></div>`;
      const out = main.querySelector('[data-out]');
      let md = '';
      let data;
      try { const [tasks, people, mems, events] = await Promise.all([repo.tasks.list(true), repo.people.list(true), repo.memory.list(true), repo.events.list()]); data = { tasks, people, mems, events }; } catch (e) { out.innerHTML = ui.error(e, false); return; }
      const gen = k => {
        const { tasks, people, mems, events } = data, now = Date.now(), week = now - 7 * 86400000;
        const L = []; const user = repo.auth.user || {};
        L.push(`## ${{ week: 'Отчёт за неделю', people: 'Отчёт по контактам', tasks: 'Отчёт по задачам', memory: 'Отчёт по памяти' }[k]}`, `${user.name || ''} · ${U.fmtDate(new Date(), true)}`, '');
        if (k === 'week') {
          const done = tasks.filter(t => t.done && new Date(t.doneAt || t.updatedAt) > week);
          L.push(`**Выполнено задач:** ${done.length}`, ...done.map(t => `- ✓ ${t.title}`), '', `**Активных:** ${tasks.filter(t => t.status === 'active').length}, **просрочено:** ${tasks.filter(t => t.status === 'overdue').length}`, '',
            `**Новые знакомства:** ${people.filter(p => new Date(p.metAt) > week).length}`, ...people.filter(p => new Date(p.metAt) > week).map(p => `- ${p.name}${p.profession ? ' — ' + p.profession : ''}`), '',
            `**Событий впереди:** ${events.filter(e => new Date(e.startAt) > now).length}`, ...events.filter(e => new Date(e.startAt) > now).slice(0, 5).map(e => `- ${e.title} — ${U.fmtDateTime(e.startAt)}`));
        } else if (k === 'people') {
          const by = {}; people.forEach(p => { const key = p.profession || 'Без профессии'; (by[key] = by[key] || []).push(p); });
          L.push(`**Всего контактов:** ${people.length}`, '', ...Object.entries(by).flatMap(([prof, ps]) => [`**${prof}** (${ps.length})`, ...ps.map(p => `- ${p.name}${p.organization ? ', ' + p.organization : ''} — с ${U.fmtDate(p.metAt)}`), '']));
        } else if (k === 'tasks') {
          const st = s => tasks.filter(t => t.status === s);
          L.push(`- Активные: **${st('active').length}**`, `- Просроченные: **${st('overdue').length}**`, `- Выполненные: **${st('done').length}**`, `- Повторяющиеся: **${tasks.filter(t => t.repeat && t.repeat !== 'none').length}**`, '', '**Просроченные:**', ...(st('overdue').length ? st('overdue').map(t => `- ${t.title} (${U.fmtDate(t.dueAt)})`) : ['- нет']));
        } else {
          const by = {}; mems.forEach(m => { by[m.type] = (by[m.type] || 0) + 1; });
          L.push(`**Всего записей:** ${mems.length}`, ...Object.entries(by).map(([t, n]) => `- ${A.MEMORY_TYPES[t].label}: ${n}`), '', `**Требуют подтверждения:** ${mems.filter(m => !m.confirmed).length}`, '', '**Последние записи:**', ...mems.slice(0, 5).map(m => `- ${m.title} (${U.fmtDate(m.createdAt)})`));
        }
        md = L.join('\n'); out.innerHTML = A.markdown.render(md);
      };
      gen('week');
      main.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { main.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('active', x === b)); gen(b.dataset.k); });
      main.querySelector('[data-copy]').onclick = async () => ui.toast((await U.copy(md)) ? 'Отчёт скопирован' : 'Ошибка', 'success');
      main.querySelector('[data-dl]').onclick = () => U.download(`adis-report-${U.toLocalDateInput(new Date())}.md`, md, 'text/markdown');
      main.querySelector('[data-doc]').onclick = e => ui.guard(e.currentTarget, async () => { await repo.documents.create({ title: md.split('\n')[0].replace(/^#+\s*/, '') + ' · ' + U.fmtDate(new Date()), content: md }); ui.toast('Отчёт сохранён в документы', 'success'); });
    },

    files(main) {
      main.innerHTML = `<label class="dropzone"><input type="file" hidden>${I('upload', 'lg')}<b>Выберите файл</b><span class="small muted">TXT, MD, CSV, JSON, код, изображения · до 10 МБ</span></label><div data-out class="mt-4"></div>`;
      const inp = main.querySelector('input'), out = main.querySelector('[data-out]');
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        if (f.size > 10 * 1048576) { ui.toast('Файл больше 10 МБ', 'error'); return; }
        out.innerHTML = ui.loading('Анализирую файл…');
        const base = [['Имя', U.esc(f.name)], ['Размер', U.fmtBytes(f.size)], ['Тип', U.esc(f.type || 'неизвестно')], ['Изменён', U.fmtDate(f.lastModified, true)]];
        let extra = '';
        if (f.type.startsWith('image/')) {
          const url = URL.createObjectURL(f);
          const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = url; });
          if (img) base.push(['Разрешение', `${img.naturalWidth} × ${img.naturalHeight}`]);
          extra = `<img src="${url}" alt="" class="card mt-4" style="padding:0;max-height:280px;object-fit:contain;width:100%">`;
        } else if (f.size < 5 * 1048576) {
          const text = await f.text();
          const lines = text.split(/\r?\n/), words = text.split(/\s+/).filter(Boolean);
          base.push(['Строк', fmtNum(lines.length)], ['Слов', fmtNum(words.length)], ['Символов', fmtNum(text.length)]);
          if (/\.json$/i.test(f.name) || f.type === 'application/json') {
            try { const j = JSON.parse(text); const keys = Array.isArray(j) ? `Массив из ${j.length} элементов` : `Объект с ключами: ${Object.keys(j).slice(0, 12).join(', ')}`; extra += `<div class="card mt-4"><div class="bold mb-2">Структура JSON</div><div class="small">${U.esc(keys)}</div></div>`; } catch (e) { extra += `<div class="banner danger mt-4">${I('alert', 'sm')}<span>JSON содержит ошибку: ${U.esc(e.message)}</span></div>`; }
          } else if (/\.(csv|tsv)$/i.test(f.name)) {
            const { header, rows } = parseCSV(text);
            extra += `<div class="card mt-4"><div class="bold mb-2">Таблица: ${rows.length} строк × ${header.length} колонок</div><div class="chips wrap">${header.map(h => `<span class="tag">${U.esc(h)}</span>`).join('')}</div><a class="link-btn" href="#/workspace/data">Открыть в «Работе с данными»</a></div>`;
            A.storage.set('ws.data', text.slice(0, 200000));
          }
          const freq = {};
          A.nlu.keywords(text.slice(0, 200000)).forEach(w => { if (w.length > 3 && !/^\d+$/.test(w)) freq[w] = (freq[w] || 0) + 1; });
          const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
          if (top.length) extra += `<div class="card mt-4"><div class="bold mb-2">Частые слова</div>${top.map(([w, n]) => `<div class="bar-row"><span>${U.esc(w)}</span><i style="width:${Math.round(n / top[0][1] * 100)}%"></i><b>${n}</b></div>`).join('')}</div>`;
          extra += `<div class="card mt-4"><div class="bold mb-2">Начало файла</div><pre class="console" style="max-height:200px">${U.esc(text.slice(0, 1500))}</pre></div>
            <button class="btn btn-secondary btn-sm mt-4" data-ask>${I('sparkles', 'sm')}Обсудить с Adis</button>`;
          setTimeout(() => { const b = out.querySelector('[data-ask]'); if (b) b.onclick = () => askAdis(`Проанализируй содержимое файла «${f.name}»:\n\n${text.slice(0, 2500)}`); });
        }
        out.innerHTML = `<div class="card">${base.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}</div>${extra}`;
        inp.value = '';
      };
    },

    data(main) {
      const sample = 'Месяц;Пользователи;Выручка;Удержание\nИюль;120;45000;31\nАвгуст;210;72000;34\nСентябрь;340;118000;38\nОктябрь;520;176000;41\nНоябрь;780;251000;44';
      let text = A.storage.get('ws.data') || sample;
      let sortCol = -1, asc = true, chartCol = -1;
      main.innerHTML = `<div class="row gap-2"><label class="btn btn-outline btn-sm">${I('upload', 'sm')}Загрузить CSV<input type="file" accept=".csv,.tsv,.txt" hidden></label><button class="btn btn-ghost btn-sm" data-sample>Пример</button><span class="grow"></span><button class="btn btn-ghost btn-sm" data-edit>${I('edit', 'sm')}Править</button></div>
        <textarea class="textarea mono mt-3 hidden" rows="8" aria-label="CSV"></textarea>
        <div data-out class="mt-3"></div>`;
      const ta = main.querySelector('textarea'), out = main.querySelector('[data-out]');
      function draw() {
        const { header, rows } = parseCSV(text);
        if (!header.length) { out.innerHTML = ui.empty({ icon: 'table', title: 'Нет данных', text: 'Загрузите CSV или вставьте данные.' }); return; }
        const numeric = header.map((_, j) => rows.length && rows.every(r => r[j] === undefined || r[j] === '' || num(r[j]) !== null));
        if (chartCol < 0) chartCol = numeric.findIndex((x, j) => x && j > 0);
        let sorted = rows.slice();
        if (sortCol >= 0) sorted.sort((a, b) => { const x = numeric[sortCol] ? num(a[sortCol]) - num(b[sortCol]) : String(a[sortCol]).localeCompare(String(b[sortCol]), 'ru'); return asc ? x : -x; });
        const stats = header.map((h, j) => { if (!numeric[j]) return null; const v = rows.map(r => num(r[j])).filter(x => x !== null); const s = v.reduce((a, b) => a + b, 0); return { min: Math.min(...v), max: Math.max(...v), avg: s / v.length, sum: s }; });
        out.innerHTML = `<div class="small muted mb-2">${rows.length} строк · ${header.length} колонок · нажмите на заголовок для сортировки</div>
          <div class="card flat" style="padding:0;overflow:auto;max-height:320px"><table class="tbl"><thead><tr>${header.map((h, j) => `<th data-sort="${j}">${U.esc(h)}${sortCol === j ? (asc ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead><tbody>${sorted.slice(0, 500).map(r => `<tr>${header.map((_, j) => `<td class="${numeric[j] ? 'n' : ''}">${U.esc(r[j] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <div class="section"><div class="t-label mb-2">Статистика</div><div class="kpis">${stats.map((s, j) => s ? `<div class="kpi"><span>${U.esc(header[j])}</span><b>${fmtNum(s.avg)}</b><small>среднее · мин ${fmtNum(s.min)} · макс ${fmtNum(s.max)}</small></div>` : '').join('')}</div></div>
          ${chartCol >= 0 ? `<div class="section"><div class="row between mb-2"><span class="t-label">График</span><select class="select" style="min-height:38px;width:auto" data-chart-col>${header.map((h, j) => numeric[j] ? `<option value="${j}" ${j === chartCol ? 'selected' : ''}>${U.esc(h)}</option>` : '').join('')}</select></div><div class="card">${barChart(sorted.slice(0, 24).map(r => r[0]), [{ name: header[chartCol], values: sorted.slice(0, 24).map(r => num(r[chartCol])) }])}</div></div>` : ''}`;
        out.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { const j = +th.dataset.sort; if (sortCol === j) asc = !asc; else { sortCol = j; asc = true; } draw(); });
        const cc = out.querySelector('[data-chart-col]'); if (cc) cc.onchange = () => { chartCol = +cc.value; draw(); };
      }
      main.querySelector('input[type=file]').onchange = async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 5 * 1048576) return ui.toast('Файл больше 5 МБ', 'error'); text = await f.text(); A.storage.set('ws.data', text.slice(0, 200000)); sortCol = -1; chartCol = -1; ta.value = text; draw(); };
      main.querySelector('[data-sample]').onclick = () => { text = sample; ta.value = text; A.storage.remove('ws.data'); sortCol = -1; chartCol = -1; draw(); };
      main.querySelector('[data-edit]').onclick = () => { ta.classList.toggle('hidden'); ta.value = text; };
      ta.addEventListener('input', U.debounce(() => { text = ta.value; A.storage.set('ws.data', text.slice(0, 200000)); chartCol = -1; draw(); }, 300));
      draw();
    }
  };

  A.router.register('/workspace/:kind', async (el, ctx) => {
    const w = WS[ctx.params.kind];
    if (!w) { A.router.go('#/tools', { replace: true }); return; }
    el.innerHTML = `${ui.appbar({ back: true, title: w.title, sub: w.desc })}<main class="content ws-content"></main>`;
    await renderers[ctx.params.kind](el.querySelector('main'), ctx);
  }, { backTo: '#/tools' });
})(window.Adis);
