/* Proactive assistant: suggestions with accept / dismiss / snooze and frequency control. */
(function (A) {
  'use strict';
  const { ui, icon: I, repo } = A;

  A.router.register('/proactive', (el, ctx) => {
    const freq = A.settings.get('proactiveFrequency');
    el.innerHTML = `${ui.appbar({ back: true, title: 'Adis предлагает', demo: true })}
      <main class="content">
        <p class="muted small">Adis замечает незавершённые дела и важные контакты. Он подсказывает только по делу — частоту можно настроить.</p>
        <div class="field mt-4"><label>Частота предложений</label>
          <div class="segmented" data-freq>${[['off', 'Выключить'], ['rare', 'Редко'], ['normal', 'Обычно']].map(([k, l]) => `<button data-v="${k}" class="${freq === k ? 'active' : ''}">${l}</button>`).join('')}</div></div>
        <div class="col mt-2" data-list></div>
      </main>`;
    const listEl = el.querySelector('[data-list]');
    const load = () => ui.load(listEl, () => repo.proactive.list(), list => {
      if (A.settings.get('proactiveFrequency') === 'off') { listEl.innerHTML = ui.empty({ icon: 'bell', title: 'Предложения выключены', text: 'Включите их, если захотите, чтобы Adis подсказывал о делах.' }); return; }
      if (!list.length) { listEl.innerHTML = ui.empty({ icon: 'sparkles', title: 'Всё под контролем', text: 'Новых предложений нет. Adis подскажет, когда появится что-то важное.' }); return; }
      listEl.innerHTML = list.map(s => ui.suggestionCard(s)).join('');
      ui.bindSuggestions(listEl, list, () => { if (!listEl.querySelector('[data-sugg]')) load(); });
    }, { skeleton: ui.skeleton(3, 120) });
    load();
    el.querySelectorAll('[data-freq] button').forEach(b => b.onclick = () => {
      A.settings.set({ proactiveFrequency: b.dataset.v });
      el.querySelectorAll('[data-freq] button').forEach(x => x.classList.toggle('active', x === b));
      ui.toast(b.dataset.v === 'off' ? 'Предложения выключены' : 'Частота сохранена', 'success');
      load();
    });
  }, { backTo: '#/home' });
})(window.Adis);
