/* First-run setup: assistant style → language → timezone → permissions → capabilities tour. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;

  const TIMEZONES = ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Bishkek', 'Europe/Minsk', 'Europe/Kyiv', 'Europe/Istanbul', 'Asia/Dubai', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'UTC'];

  A.router.register('/onboarding', el => {
    let step = 0;
    const st = { assistantName: 'Adis', style: 'balanced', interests: [], language: A.settings.get('language'), timezone: A.settings.get('timezone') };
    const STEPS = 5;

    function header() {
      return `<header class="appbar">${step ? `<button class="icon-btn" data-prev aria-label="Назад">${I('back')}</button>` : '<span style="width:8px"></span>'}
        <div class="title"><div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${STEPS}" aria-valuenow="${step + 1}">${Array.from({ length: STEPS }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div></div>
        ${step < STEPS - 1 ? '<button class="btn btn-ghost btn-sm" data-skip>Пропустить</button>' : '<span style="width:8px"></span>'}</header>`;
    }

    function body() {
      const u = repo.auth.user || {};
      switch (step) {
        case 0: return `<div class="ob-head"><div class="orb xl pulse"></div><h1 class="t-h1 mt-6">${U.esc((u.name || '').split(' ')[0] || 'Привет')}, давай настроим помощника</h1><p class="muted mt-2">Это займёт меньше минуты. Всё можно изменить позже в профиле.</p></div>
          <div class="field mt-6"><label>Как называть помощника</label><input class="input" name="assistantName" value="${U.esc(st.assistantName)}" maxlength="20"></div>
          <div class="field"><label>Стиль ответов</label><div class="segmented" data-group="style">
            ${[['short', 'Кратко'], ['balanced', 'Обычно'], ['detailed', 'Подробно']].map(([v, l]) => `<button type="button" data-v="${v}" class="${st.style === v ? 'active' : ''}">${l}</button>`).join('')}</div></div>
          <div class="field"><label>Чем Adis будет помогать чаще всего</label><div class="chips wrap" data-group="interests">
            ${['Работа и проекты', 'Знакомства', 'Учёба', 'Бизнес', 'Программирование', 'Здоровье и спорт', 'Семья', 'Финансы'].map(x => `<button type="button" class="chip${st.interests.includes(x) ? ' active' : ''}" data-v="${x}">${x}</button>`).join('')}</div></div>`;
        case 1: return `<div class="ob-head"><div class="ob-ico">${I('globe', 'lg')}</div><h1 class="t-h1 mt-4">Язык общения</h1><p class="muted mt-2">На этом языке Adis будет отвечать и распознавать речь.</p></div>
          <div class="list mt-6">${A.LANGUAGES.map(l => `<button class="list-item no-icon" data-lang="${l.code}"><div class="grow"><div class="li-title">${l.name}</div><div class="li-sub">${l.native}</div></div>${st.language === l.code ? `<span style="color:var(--primary)">${I('check')}</span>` : ''}</button>`).join('')}</div>`;
        case 2: return `<div class="ob-head"><div class="ob-ico">${I('clock', 'lg')}</div><h1 class="t-h1 mt-4">Часовой пояс</h1><p class="muted mt-2">Нужен, чтобы напоминания приходили вовремя — даже когда приложение закрыто.</p></div>
          <div class="card mt-6"><div class="kv"><span class="k">Определён автоматически</span><span class="v">${U.esc(U.timezone())}</span></div><div class="kv"><span class="k">Сейчас</span><span class="v">${U.fmtTime(new Date())}</span></div></div>
          <div class="field mt-4"><label for="tz">Выбрать вручную</label><select class="select" id="tz" name="timezone">${Array.from(new Set([U.timezone(), ...TIMEZONES])).map(z => `<option ${z === st.timezone ? 'selected' : ''}>${z}</option>`).join('')}</select></div>`;
        case 3: {
          const n = A.notifications.permission();
          return `<div class="ob-head"><div class="ob-ico">${I('shield', 'lg')}</div><h1 class="t-h1 mt-4">Разрешения</h1><p class="muted mt-2">Adis спрашивает только то, что нужно для работы. Можно разрешить позже.</p></div>
          <div class="col mt-6">
            <div class="card row"><div class="ico-tile">${I('mic')}</div><div class="grow"><div class="bold">Микрофон</div><div class="small muted">Для голосового общения</div></div>
              ${A.voice.micSupported ? `<button class="btn btn-secondary btn-sm" data-perm="mic">Разрешить</button>` : '<span class="tag">Недоступно</span>'}</div>
            <div class="card row"><div class="ico-tile">${I('bell')}</div><div class="grow"><div class="bold">Уведомления</div><div class="small muted">Для напоминаний и важных событий</div></div>
              ${n === 'unsupported' ? '<span class="tag">Недоступно</span>' : n === 'granted' ? `<span class="tag success">${I('check', 'sm')}Разрешено</span>` : `<button class="btn btn-secondary btn-sm" data-perm="notif">Разрешить</button>`}</div>
          </div>
          <p class="tiny faint mt-4">На iPhone уведомления работают после добавления Adis на экран «Домой».</p>`;
        }
        default: return `<div class="ob-head"><div class="ob-ico">${I('sparkles', 'lg')}</div><h1 class="t-h1 mt-4">Что умеет ${U.esc(st.assistantName || 'Adis')}</h1></div>
          <div class="col mt-6 tour">
            ${[['memory', 'Запоминает', '«Познакомился с Артёмом, он программист» — Adis сохранит человека, профессию и навыки.'],
          ['search', 'Находит', '«С кем я недавно познакомился из программистов?» — ответ из твоей памяти.'],
          ['bell', 'Напоминает', '«Напомни завтра в 10 позвонить Артёму» — карточка с подтверждением.'],
          ['eye', 'Прозрачен', 'В разделе «Память» видно всё, что Adis знает. Любую запись можно изменить или удалить.']]
            .map(([i, t, d]) => `<div class="card row" style="align-items:flex-start"><div class="ico-tile">${I(i)}</div><div><div class="bold">${t}</div><div class="small muted">${d}</div></div></div>`).join('')}
          </div>`;
      }
    }

    function render() {
      el.innerHTML = `${header()}<main class="content">${body()}</main>
        <footer class="ob-foot"><button class="btn btn-primary btn-block" data-next>${step === STEPS - 1 ? 'Начать пользоваться' : 'Продолжить'}</button></footer>`;
      bind();
    }

    function collect() {
      const n = el.querySelector('[name=assistantName]'); if (n) st.assistantName = n.value.trim() || 'Adis';
      const tz = el.querySelector('[name=timezone]'); if (tz) st.timezone = tz.value;
    }

    async function finish() {
      A.settings.set({ language: st.language, timezone: st.timezone, onboarded: true, responseStyle: st.style, interests: st.interests });
      try { await repo.auth.updateMe({ assistantName: st.assistantName }); } catch (_) { /* non-critical */ }
      A.router.go('#/home', { replace: true });
    }

    function bind() {
      const prev = el.querySelector('[data-prev]'); if (prev) prev.onclick = () => { collect(); step--; render(); };
      const skip = el.querySelector('[data-skip]'); if (skip) skip.onclick = () => { collect(); step = STEPS - 1; render(); };
      el.querySelector('[data-next]').onclick = () => { collect(); if (step === STEPS - 1) finish(); else { step++; render(); } };
      el.querySelectorAll('[data-group=style] button').forEach(b => b.onclick = () => { st.style = b.dataset.v; el.querySelectorAll('[data-group=style] button').forEach(x => x.classList.toggle('active', x === b)); });
      el.querySelectorAll('[data-group=interests] .chip').forEach(b => b.onclick = () => {
        const v = b.dataset.v; st.interests = st.interests.includes(v) ? st.interests.filter(x => x !== v) : [...st.interests, v]; b.classList.toggle('active');
      });
      el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { st.language = b.dataset.lang; A.settings.set({ language: st.language }); render(); });
      el.querySelectorAll('[data-perm]').forEach(b => b.onclick = () => ui.guard(b, async () => {
        if (b.dataset.perm === 'mic') {
          const r = await A.voice.requestMic();
          ui.toast(r === 'granted' ? 'Микрофон разрешён' : 'Доступ к микрофону не получен', r === 'granted' ? 'success' : 'error');
          if (r === 'granted') b.outerHTML = `<span class="tag success">${I('check', 'sm')}Разрешено</span>`;
        } else {
          const r = await A.notifications.request();
          ui.toast(r === 'granted' ? 'Уведомления включены' : 'Уведомления не разрешены', r === 'granted' ? 'success' : 'info');
          render();
        }
      }));
    }

    render();
  }, { onboarding: true, fade: true });
})(window.Adis);
