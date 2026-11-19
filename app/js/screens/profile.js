/* Profile & settings: account, appearance, language, notifications, voice, memory, privacy, security,
 * devices, data export, account deletion, logout, connection (Demo / AI Backend). */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const S = () => A.settings.get();

  const SECTIONS = [
    ['account', 'user', 'Аккаунт', 'Имя, email, имя помощника'],
    ['appearance', 'sun', 'Оформление', 'Тема, размер шрифта, контраст'],
    ['language', 'globe', 'Язык и регион', 'Язык, часовой пояс'],
    ['notifications', 'bell', 'Уведомления', 'Напоминания и предложения'],
    ['voice', 'volume', 'Голос', 'Распознавание и озвучивание'],
    ['memory', 'memory', 'Память', 'Что и как Adis запоминает'],
    ['privacy', 'shield', 'Приватность', 'Чувствительные данные'],
    ['security', 'lock', 'Безопасность', 'Пароль, активные устройства'],
    ['data', 'download', 'Мои данные', 'Экспорт и удаление аккаунта'],
    ['connection', 'server', 'Подключение', 'Демо-режим или AI Backend']
  ];

  A.router.register('/profile', el => {
    const u = repo.auth.user || {};
    el.innerHTML = `${ui.appbar({ title: A.t('nav.profile'), large: true })}
      <main class="content">
        <a class="card row pressable profile-card" href="#/settings/account" style="color:inherit">${ui.avatar(u, 'lg')}<div class="grow" style="min-width:0"><div class="t-h2 ellipsis">${U.esc(u.name || 'Пользователь')}</div><div class="small muted ellipsis">${U.esc(u.email || '')}</div>
          <div class="row gap-2 mt-2"><span class="tag primary">${I('sparkles', 'sm')}${U.esc(u.assistantName || 'Adis')}</span>${A.api.isDemo() ? '<span class="demo-badge">Демо-режим</span>' : '<span class="tag success">AI Backend</span>'}</div></div>${I('chevron', 'sm')}</a>
        <div class="section list">${SECTIONS.map(([k, i, t, d]) => `<a class="list-item" href="#/settings/${k}"><div class="ico-tile">${I(i)}</div><div class="grow"><div class="li-title">${t}</div><div class="li-sub">${d}</div></div><span class="chev">${I('chevron', 'sm')}</span></a>`).join('')}</div>
        <div class="section list"><button class="list-item danger" data-logout><div class="ico-tile" style="background:var(--danger-soft);color:var(--danger)">${I('logout')}</div><div class="grow"><div class="li-title">Выйти из аккаунта</div></div></button></div>
        <p class="tiny faint text-center mt-6">Adis · версия 0.1.0 MVP${A.api.isDemo() ? ' · данные хранятся локально на устройстве' : ''}</p>
      </main>`;
    el.querySelector('[data-logout]').onclick = async () => {
      if (!(await ui.dialog({ title: 'Выйти из аккаунта?', text: 'Чтобы снова пользоваться Adis, нужно будет войти.', icon: 'logout', confirmLabel: 'Выйти' }))) return;
      await repo.auth.logout(); A.router.go('#/welcome', { replace: true });
    };
  }, { tab: 'profile' });

  const row = (title, sub, control) => `<div class="list-item no-icon"><div class="grow"><div class="li-title">${title}</div>${sub ? `<div class="li-sub">${sub}</div>` : ''}</div>${control}</div>`;
  const seg = (name, value, opts) => `<div class="segmented" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(value) === String(v) ? 'active' : ''}">${l}</button>`).join('')}</div>`;

  const builders = {
    account(el) {
      const u = repo.auth.user || {};
      return {
        html: `<form novalidate data-form>
          <div class="field"><label>Имя</label><input class="input" name="name" value="${U.esc(u.name || '')}"></div>
          <div class="field"><label>Email</label><input class="input" value="${U.esc(u.email || '')}" disabled><div class="hint">Смена email — через поддержку.</div></div>
          <div class="field"><label>Как называть помощника</label><input class="input" name="assistantName" value="${U.esc(u.assistantName || 'Adis')}" maxlength="20"></div>
          <div class="field"><label>Стиль ответов</label>${seg('responseStyle', S().responseStyle || 'balanced', [['short', 'Кратко'], ['balanced', 'Обычно'], ['detailed', 'Подробно']])}</div>
          <button class="btn btn-primary btn-block" type="submit">Сохранить</button></form>
          <p class="small muted mt-4">Аккаунт создан ${u.createdAt ? U.fmtDate(u.createdAt, true) : '—'}</p>`,
        bind() {
          const f = el.querySelector('[data-form]');
          f.onsubmit = e => {
            e.preventDefault(); const v = ui.formData(f);
            if (!v.name || v.name.length < 2) return ui.fieldError(f, 'name', 'Введите имя');
            ui.guard(f.querySelector('[type=submit]'), async () => { await repo.auth.updateMe({ name: v.name, assistantName: v.assistantName || 'Adis' }); ui.toast('Профиль сохранён', 'success'); });
          };
        }
      };
    },
    appearance() {
      return {
        html: `<div class="field"><label>Тема</label>${seg('theme', S().theme, [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в системе']])}</div>
          <div class="field"><label>Размер текста</label>${seg('fontScale', S().fontScale, [[0.9, 'Мелкий'], [1, 'Обычный'], [1.15, 'Крупный'], [1.3, 'Очень крупный']])}
          <div class="card mt-3"><p style="margin:0">Так будет выглядеть текст в Adis.</p></div></div>
          <div class="list">${row('Высокий контраст', 'Более тёмный текст и чёткие границы', ui.switchHtml('contrast', S().contrast === 'high', 'Высокий контраст'))}</div>
          <p class="small muted mt-4">Adis также учитывает системные настройки: размер шрифта, уменьшение движения и тёмную тему.</p>`,
        bind(el) { el.querySelector('[name=contrast]').onchange = e => A.settings.set({ contrast: e.target.checked ? 'high' : 'normal' }); }
      };
    },
    language() {
      return {
        html: `<div class="t-label mb-2">Язык</div><div class="list">${A.LANGUAGES.map(l => `<button class="list-item no-icon" data-lang="${l.code}"><div class="grow"><div class="li-title">${l.name}</div><div class="li-sub">${l.native}</div></div>${S().language === l.code ? `<span style="color:var(--primary)">${I('check')}</span>` : ''}</button>`).join('')}</div>
          <div class="field mt-6"><label>Часовой пояс</label><input class="input" name="tz" value="${U.esc(S().timezone)}" list="tzs"><datalist id="tzs">${['Europe/Moscow', 'Asia/Almaty', 'Asia/Tashkent', 'Europe/Minsk', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'].map(z => `<option>${z}</option>`).join('')}</datalist>
          <div class="hint">Определено устройством: ${U.esc(U.timezone())}. Используется для напоминаний на сервере.</div></div>
          <button class="btn btn-outline btn-sm" data-tz-auto>Определить автоматически</button>`,
        bind(el, rerender) {
          el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { A.settings.set({ language: b.dataset.lang }); rerender(); A.router.renderTabbar(null); });
          const tz = el.querySelector('[name=tz]');
          tz.onchange = () => { try { new Intl.DateTimeFormat('ru', { timeZone: tz.value }); A.settings.set({ timezone: tz.value }); ui.toast('Часовой пояс сохранён', 'success'); } catch (_) { ui.toast('Неизвестный часовой пояс', 'error'); tz.value = S().timezone; } };
          el.querySelector('[data-tz-auto]').onclick = () => { A.settings.set({ timezone: U.timezone() }); tz.value = U.timezone(); ui.toast('Часовой пояс обновлён', 'success'); };
        }
      };
    },
    notifications() {
      const p = A.notifications.permission();
      return {
        html: `<div class="list">
          ${row('Уведомления о напоминаниях', p === 'granted' ? 'Разрешено системой' : p === 'denied' ? 'Запрещено в настройках браузера' : p === 'unsupported' ? 'Не поддерживается этим браузером' : 'Требуется разрешение', ui.switchHtml('notifications', S().notifications && p === 'granted', 'Уведомления'))}
          </div>
          <div class="field mt-4"><label>Предложения Adis</label>${seg('proactiveFrequency', S().proactiveFrequency, [['off', 'Выкл.'], ['rare', 'Редко'], ['normal', 'Обычно']])}</div>
          <div class="section"><div class="t-label mb-2">Когда Adis закрыт</div><div class="list" data-push>${row('Push-уведомления на это устройство', 'Проверяем…', '')}</div></div>
          <div class="banner info mt-4">${I('info', 'sm')}<span>Напоминания, события и будильники планируются на сервере и приходят push-уведомлением, даже если Adis закрыт. На iPhone это работает в приложении, добавленном на экран «Домой» (iOS 16.4+). В демо-режиме уведомления работают, пока приложение открыто.</span></div>
          <button class="btn btn-outline btn-sm mt-4" data-test>Отправить тестовое уведомление</button>`,
        bind(el, rerender) {
          const pushEl = el.querySelector('[data-push]');
          A.push.status().then(st => {
            const ctl = ['on', 'off'].includes(st.state) ? ui.switchHtml('push', st.state === 'on', 'Push-уведомления') : `<span class="tag">${st.state === 'demo' ? 'Демо' : 'Нет'}</span>`;
            pushEl.innerHTML = row('Push-уведомления на это устройство', U.esc(st.text), ctl);
            const sw = pushEl.querySelector('[name=push]');
            if (sw) sw.onchange = e => ui.guard(null, async () => {
              try { await (e.target.checked ? A.push.enable() : A.push.disable()); } catch (err) { e.target.checked = !e.target.checked; throw err; }
              ui.toast(e.target.checked ? 'Push-уведомления включены' : 'Push-уведомления выключены', 'success'); rerender();
            });
          });
          el.querySelector('[name=notifications]').onchange = async e => {
            if (e.target.checked && A.notifications.permission() !== 'granted') {
              const r = await A.notifications.request();
              if (r !== 'granted') { ui.toast('Разрешите уведомления в настройках браузера', 'error'); e.target.checked = false; return; }
            }
            A.settings.set({ notifications: e.target.checked }); rerender();
          };
          el.querySelector('[data-test]').onclick = e => ui.guard(e.currentTarget, async () => {
            if (!A.api.isDemo() && (await A.push.status()).state === 'on') { await A.push.test(); ui.toast('Отправлено через сервер — проверьте уведомление', 'success'); return; }
            A.notifications.show('Adis', 'Так будут выглядеть напоминания', '#/tasks');
          });
        }
      };
    },
    voice() {
      const voices = A.voice.voices();
      const c = A.voice.cloud;
      const VOICE_NAMES = A.voice.VOICE_NAMES;
      return {
        html: `<div class="list">
          ${row('Облачный голос', c.available ? 'Подключён на сервере: точное распознавание (имена из памяти, номера цифрами) и естественная озвучка' : A.api.isDemo() ? 'Доступен при подключении к AI Backend' : 'Не настроен на сервере', c.available ? `<span class="tag success">${I('check', 'sm')}</span>` : '<span class="tag">Нет</span>')}
          ${row('Распознавание речи', A.voice.sttSupported ? (c.stt ? 'Облачное' : 'На этом устройстве') : 'Недоступно в этом браузере', A.voice.sttSupported ? `<span class="tag success">${I('check', 'sm')}</span>` : '<span class="tag">Нет</span>')}
          ${row('Озвучивание ответов', A.voice.ttsSupported ? (c.tts ? 'Облачное' : 'На этом устройстве') : 'Недоступно', A.voice.ttsSupported ? `<span class="tag success">${I('check', 'sm')}</span>` : '<span class="tag">Нет</span>')}
          ${row('Автоматически озвучивать', 'Отвечать голосом на голосовые сообщения', ui.switchHtml('voiceAutoplay', S().voiceAutoplay, 'Автоозвучивание'))}
          ${row('Авто-диалог (без рук)', 'В голосовом режиме слушать дальше сразу после ответа Adis', ui.switchHtml('voiceContinuous', S().voiceContinuous, 'Авто-диалог'))}
          </div>
          ${c.available ? `<div class="field mt-4"><label>Какой голос использовать</label>${seg('voiceProvider', S().voiceProvider || 'auto', [['auto', 'Облачный'], ['device', 'Устройства']])}</div>` : ''}
          <div class="field mt-4"><label>Скорость речи</label>${seg('voiceRate', S().voiceRate, [[0.8, 'Медленно'], [1, 'Обычно'], [1.2, 'Быстро']])}</div>
          ${c.tts ? `<div class="field"><label>Голос Adis</label><select class="select" name="voiceCloud"><option value="">По умолчанию</option>${c.voices.map(v => `<option value="${v}" ${S().voiceCloud === v ? 'selected' : ''}>${U.esc(VOICE_NAMES[v] || v)}</option>`).join('')}</select></div>`
          : voices.length ? `<div class="field"><label>Голос</label><select class="select" name="voiceName"><option value="">По умолчанию</option>${voices.map(v => `<option ${S().voiceName === v.name ? 'selected' : ''}>${U.esc(v.name)}</option>`).join('')}</select></div>` : ''}
          <button class="btn btn-outline btn-sm" data-try ${A.voice.ttsSupported ? '' : 'disabled'}>${I('volume', 'sm')}Прослушать</button>
          ${c.available ? '<p class="small muted mt-4">Запись голоса отправляется на сервер Adis только для распознавания и не хранится.</p>' : ''}`,
        bind(el, rerender) {
          el.querySelector('[name=voiceAutoplay]').onchange = e => A.settings.set({ voiceAutoplay: e.target.checked });
          el.querySelector('[name=voiceContinuous]').onchange = e => A.settings.set({ voiceContinuous: e.target.checked });
          const vn = el.querySelector('[name=voiceName]'); if (vn) vn.onchange = () => A.settings.set({ voiceName: vn.value });
          const vc = el.querySelector('[name=voiceCloud]'); if (vc) vc.onchange = () => { A.settings.set({ voiceCloud: vc.value }); A.voice.speak('Привет! Теперь я буду говорить этим голосом.'); };
          el.querySelector('[data-try]').onclick = () => A.voice.speak('Привет! Я Adis, твой личный помощник. Номер Артёма: плюс семь, девятьсот девяносто девять, сто двадцать три, сорок пять, шестьдесят семь.');
          if (!c.checked) A.voice.refreshCloud().then(() => rerender());
        },
        onSeg(name) { if (name === 'voiceProvider') setTimeout(() => A.router.resolve(), 0); }
      };
    },
    memory() {
      return {
        html: `<div class="list">
          ${row('Спрашивать перед сохранением', 'Adis покажет карточку и сохранит только после подтверждения', ui.switchHtml('memoryAskBeforeSave', S().memoryAskBeforeSave, 'Подтверждение'))}
          ${row('Предлагать запомнить', 'Замечать в разговоре важные факты и знакомства', ui.switchHtml('memorySuggest', S().memorySuggest, 'Предлагать'))}
          </div>
          <a class="btn btn-secondary btn-block mt-4" href="#/memory">${I('eye', 'sm')}Посмотреть, что Adis помнит</a>
          <button class="btn btn-danger btn-block mt-3" data-clear>${I('trash', 'sm')}Очистить всю память</button>`,
        bind(el) {
          el.querySelector('[name=memoryAskBeforeSave]').onchange = e => A.settings.set({ memoryAskBeforeSave: e.target.checked });
          el.querySelector('[name=memorySuggest]').onchange = e => A.settings.set({ memorySuggest: e.target.checked });
          el.querySelector('[data-clear]').onclick = async () => {
            if (!(await ui.confirmDanger('Очистить всю память?', 'Будут удалены все воспоминания (люди и задачи останутся). Действие нельзя отменить.', 'Очистить'))) return;
            ui.guard(el.querySelector('[data-clear]'), async () => { const list = await repo.memory.list(true); for (const m of list) await repo.memory.remove(m.id); ui.toast(`Удалено записей: ${list.length}`, 'success'); });
          };
        }
      };
    },
    privacy() {
      return {
        html: `<div class="list">${row('Защита чувствительных данных', 'Не сохранять автоматически пароли, документы, финансы и здоровье', ui.switchHtml('sensitiveGuard', S().sensitiveGuard, 'Защита'))}</div>
          <div class="card mt-4"><div class="bold mb-2">Как Adis защищает данные</div><ul class="small muted" style="margin:0;padding-left:18px">
          <li>Ключи ИИ и секреты хранятся только на сервере, не в приложении.</li><li>Токены входа хранятся в защищённом хранилище устройства.</li>
          <li>Модель ИИ не обращается к базе напрямую — только через API с проверкой прав.</li><li>В журналах ошибок нет личных данных.</li><li>Вы видите и контролируете каждую запись памяти.</li></ul></div>`,
        bind(el) { el.querySelector('[name=sensitiveGuard]').onchange = e => A.settings.set({ sensitiveGuard: e.target.checked }); }
      };
    },
    security(el) {
      return {
        html: `<div class="t-label mb-2">Смена пароля</div><form novalidate data-form class="card">
          <div class="field"><label>Текущий пароль</label><input class="input" type="password" name="current" autocomplete="current-password"></div>
          <div class="field"><label>Новый пароль</label><input class="input" type="password" name="next" autocomplete="new-password" placeholder="Минимум 8 символов"></div>
          <button class="btn btn-primary btn-block" type="submit">Изменить пароль</button></form>
          <div class="section"><div class="t-label mb-2">Активные устройства</div><div data-devices>${ui.skeleton(2, 56)}</div></div>`,
        async bind() {
          const f = el.querySelector('[data-form]');
          f.onsubmit = e => {
            e.preventDefault(); const v = ui.formData(f);
            if (!v.current) return ui.fieldError(f, 'current', 'Введите текущий пароль');
            if (v.next.length < 8) return ui.fieldError(f, 'next', 'Минимум 8 символов');
            ui.guard(f.querySelector('[type=submit]'), async () => { await repo.auth.changePassword(v.current, v.next); f.reset(); ui.toast('Пароль изменён', 'success'); });
          };
          const box = el.querySelector('[data-devices]');
          ui.load(box, () => repo.auth.devices(), list => {
            box.innerHTML = `<div class="list">${list.map(d => `<div class="list-item"><div class="ico-tile">${I('phone')}</div><div class="grow"><div class="li-title">${U.esc(d.name)}</div><div class="li-sub">${d.current ? 'Это устройство' : 'Активно ' + U.fmtAgo(d.lastActiveAt)}</div></div>${d.current ? '<span class="tag success">Текущее</span>' : ''}</div>`).join('')}</div>`;
          });
        }
      };
    },
    data(el) {
      return {
        html: `<div class="card"><div class="row" style="align-items:flex-start"><div class="ico-tile">${I('download')}</div><div class="grow"><div class="bold">Экспорт данных</div><div class="small muted">Все ваши данные — память, люди, задачи, события, чаты — в файле JSON.</div></div></div><button class="btn btn-secondary btn-block mt-3" data-export>Скачать мои данные</button></div>
          <div class="card mt-4" style="border-color:var(--danger-soft)"><div class="row" style="align-items:flex-start"><div class="ico-tile" style="background:var(--danger-soft);color:var(--danger)">${I('trash')}</div><div class="grow"><div class="bold">Удаление аккаунта</div><div class="small muted">Аккаунт и все данные будут удалены без возможности восстановления.</div></div></div><button class="btn btn-danger btn-block mt-3" data-delete>Удалить аккаунт</button></div>`,
        bind() {
          el.querySelector('[data-export]').onclick = e => ui.guard(e.currentTarget, async () => { const d = await repo.auth.exportData(); U.download(`adis-export-${U.toLocalDateInput(new Date())}.json`, JSON.stringify(d, null, 2)); ui.toast('Файл с данными скачан', 'success'); });
          el.querySelector('[data-delete]').onclick = async () => {
            if (!(await ui.confirmDanger('Удалить аккаунт?', 'Все данные будут удалены навсегда. Рекомендуем сначала скачать экспорт.', 'Продолжить'))) return;
            if (!(await ui.confirmDanger('Точно удалить?', 'Это последнее подтверждение. Восстановить аккаунт будет невозможно.', 'Удалить навсегда'))) return;
            ui.guard(null, async () => { await repo.auth.deleteAccount(); A.settings.set({ onboarded: false }); ui.toast('Аккаунт удалён', 'success'); A.router.go('#/welcome', { replace: true }); });
          };
        }
      };
    },
    connection(el) {
      return {
        html: `<div class="card tinted"><div class="row">${I(A.api.isDemo() ? 'info' : 'server')}<b>${A.api.isDemo() ? 'Сейчас: демо-режим' : 'Сейчас: AI Backend'}</b></div><p class="small muted mt-2" style="margin-bottom:0">${A.api.isDemo() ? 'Данные хранятся только на этом устройстве, ответы формирует встроенный демо-движок. Ничего не отправляется на сервер.' : 'Приложение работает с облачным AI Backend по API-контракту Adis.'}</p></div>
          <div class="field mt-4"><label>Режим</label>${seg('apiMode', S().apiMode, [['demo', 'Демо'], ['server', 'AI Backend']])}</div>
          <div class="field"><label>Адрес сервера</label><input class="input" name="apiBaseUrl" value="${U.esc(S().apiBaseUrl)}" placeholder="https://api.adis.app/v1" inputmode="url"><div class="hint">FastAPI-сервер, реализующий контракт из docs/API.md. Ключи ИИ хранятся только на сервере.</div></div>
          <button class="btn btn-outline btn-sm" data-check>${I('refresh', 'sm')}Проверить соединение</button>
          <div class="section"><div class="t-label mb-2">Тестирование (демо)</div><div class="list">
            ${row('Имитировать ошибки сети', 'Часть запросов будет падать — для проверки обработки ошибок', ui.switchHtml('simulateNetworkErrors', S().simulateNetworkErrors, 'Ошибки'))}
            ${row('Имитировать медленную сеть', 'Задержка 2–3 секунды', ui.switchHtml('simulateSlowNetwork', S().simulateSlowNetwork, 'Медленная сеть'))}
          </div><button class="btn btn-ghost btn-sm mt-3" data-reset>Сбросить демо-данные</button></div>`,
        bind() {
          const url = el.querySelector('[name=apiBaseUrl]');
          url.onchange = () => {
            const v = url.value.trim();
            if (v && !/^https:\/\//.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(v)) { ui.toast('Нужен адрес https://', 'error'); return; }
            A.settings.set({ apiBaseUrl: v }); ui.toast('Адрес сохранён', 'success');
          };
          el.querySelector('[data-check]').onclick = e => ui.guard(e.currentTarget, async () => {
            if (A.api.isDemo()) { ui.toast('Демо-режим работает локально', 'success'); return; }
            const res = await fetch(S().apiBaseUrl.replace(/\/$/, '') + '/health').catch(() => null);
            ui.toast(res && res.ok ? 'Сервер доступен' : 'Сервер недоступен', res && res.ok ? 'success' : 'error');
          });
          ['simulateNetworkErrors', 'simulateSlowNetwork'].forEach(k => { el.querySelector(`[name=${k}]`).onchange = e => A.settings.set({ [k]: e.target.checked }); });
          el.querySelector('[data-reset]').onclick = async () => {
            if (!(await ui.confirmDanger('Сбросить демо-данные?', 'Все локальные аккаунты и данные демо-режима будут удалены.', 'Сбросить'))) return;
            A.mockDb.reset(); await repo.auth.clearLocal(); A.settings.set({ onboarded: false }); A.router.go('#/welcome', { replace: true });
          };
        },
        onSeg(name, v) {
          if (name === 'apiMode') {
            if (v === 'server' && !S().apiBaseUrl) { ui.toast('Сначала укажите адрес сервера', 'error'); return false; }
            A.settings.set({ apiMode: v, apiModeChosen: true });
            ui.dialog({ title: v === 'server' ? 'Подключение к AI Backend' : 'Демо-режим', text: 'Для смены источника данных нужно войти заново.', icon: 'server', confirmLabel: 'Понятно', single: true })
              .then(async () => { await repo.auth.clearLocal(); A.router.go('#/welcome', { replace: true }); });
            return false;
          }
        }
      };
    }
  };

  A.router.register('/settings/:section', (el, ctx) => {
    const meta = SECTIONS.find(s => s[0] === ctx.params.section);
    if (!meta) { A.router.go('#/profile', { replace: true }); return; }
    const render = () => {
      const b = builders[ctx.params.section](el);
      el.innerHTML = `${ui.appbar({ back: true, title: meta[2] })}<main class="content">${b.html}</main>`;
      el.querySelectorAll('[data-seg]').forEach(group => group.querySelectorAll('button').forEach(btn => btn.onclick = () => {
        const name = group.dataset.seg; let v = btn.dataset.v;
        if (b.onSeg && b.onSeg(name, v) === false) return;
        if (['fontScale', 'voiceRate'].includes(name)) v = parseFloat(v);
        A.settings.set({ [name]: v });
        group.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === btn));
      }));
      b.bind && b.bind(el, render);
    };
    render();
  }, { backTo: '#/profile' });
})(window.Adis);
