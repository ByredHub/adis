/* Finance: month overview (income, expenses, balance, categories), debts (who owes me / whom I owe), operations. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const EXPENSE_CATS = ['Продукты', 'Кафе и рестораны', 'Такси', 'Транспорт', 'Жильё', 'Связь и интернет', 'Подписки', 'Здоровье', 'Одежда', 'Красота', 'Спорт', 'Развлечения', 'Подарки', 'Образование', 'Дом', 'Путешествия', 'Дети', 'Животные', 'Другое'];
  const INCOME_CATS = ['Зарплата', 'Подработка', 'Бизнес', 'Подарок', 'Проценты и кэшбэк', 'Возврат', 'Другое'];
  const CURRENCIES = ['RUB', 'USD', 'EUR', 'KZT', 'UZS'];
  const M = U.money;
  const monthKey = d => `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}`;
  const num = v => parseFloat(String(v || '').replace(/\s/g, '').replace(',', '.'));

  function txSheet(kind, tx, onSaved) {
    const k = tx ? tx.kind : kind;
    const cats = k === 'income' ? INCOME_CATS : EXPENSE_CATS;
    ui.sheet({
      title: tx ? 'Операция' : k === 'income' ? 'Новый доход' : 'Новый расход',
      body: `<form novalidate>
        <div class="row gap-2"><div class="field grow"><label>Сумма</label><input class="input fin-amount-input" name="amount" inputmode="decimal" value="${tx ? tx.amount : ''}" placeholder="0" ${tx ? '' : 'autofocus'}></div>
          <div class="field" style="width:96px"><label>Валюта</label><select class="select" name="currency">${CURRENCIES.map(c => `<option ${(tx ? tx.currency : 'RUB') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
        <div class="field"><label>Категория</label><select class="select" name="category">${cats.map(c => `<option ${(tx ? tx.category : cats[0]) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Комментарий</label><input class="input" name="note" maxlength="200" value="${U.esc(tx ? tx.note : '')}" placeholder="${k === 'income' ? 'Например: зарплата' : 'Например: продукты в магазине'}"></div>
        <div class="field"><label>Дата</label><input class="input" type="datetime-local" name="occurredAt" value="${U.toLocalInput(tx ? tx.occurredAt : new Date())}"></div>
        <button class="btn btn-primary btn-block" type="submit">${tx ? 'Сохранить' : 'Записать'}</button>
        ${tx ? '<button type="button" class="btn btn-danger btn-block mt-3" data-delete>Удалить операцию</button>' : ''}
      </form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          const amount = num(v.amount);
          if (!(amount > 0)) return ui.fieldError(f, 'amount', 'Введите сумму');
          const payload = { kind: k, amount, currency: v.currency, category: v.category, note: v.note || '', occurredAt: new Date(v.occurredAt || Date.now()).toISOString() };
          ui.guard(f.querySelector('[type=submit]'), async () => {
            if (tx) await repo.finance.updateTx(tx.id, payload); else await repo.finance.addTx(payload);
            close(); ui.toast(tx ? 'Сохранено' : `${k === 'income' ? 'Доход' : 'Расход'} ${M(amount, v.currency)} записан`, 'success'); onSaved && onSaved();
          });
        };
        const del = f.querySelector('[data-delete]');
        if (del) del.onclick = async () => {
          if (!(await ui.confirmDanger('Удалить операцию?', `${M(tx.amount, tx.currency)} · ${tx.category}`))) return;
          ui.guard(del, async () => { await repo.finance.removeTx(tx.id); close(); ui.toast('Операция удалена', 'success'); onSaved && onSaved(); });
        };
      }
    });
  }

  function debtSheet(direction, onSaved) {
    ui.sheet({
      title: 'Новый долг',
      body: `<form novalidate>
        <div class="segmented mb-3" data-dir>${[['lent', 'Мне должны'], ['borrowed', 'Я должен']].map(([v, l]) => `<button type="button" data-v="${v}" class="${v === direction ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="field"><label data-who-label>${direction === 'lent' ? 'Кто должен' : 'Кому вы должны'}</label><input class="input" name="counterparty" list="fin-people" maxlength="160" autofocus><datalist id="fin-people"></datalist></div>
        <div class="row gap-2"><div class="field grow"><label>Сумма</label><input class="input fin-amount-input" name="amount" inputmode="decimal" placeholder="0"></div>
          <div class="field" style="width:96px"><label>Валюта</label><select class="select" name="currency">${CURRENCIES.map(c => `<option>${c}</option>`).join('')}</select></div></div>
        <div class="field"><label>Вернуть до</label><input class="input" type="date" name="dueAt"><div class="hint">Adis напомнит в этот день</div></div>
        <div class="field"><label>Комментарий</label><input class="input" name="note" maxlength="200" placeholder="Например: до зарплаты"></div>
        <button class="btn btn-primary btn-block" type="submit">Записать долг</button>
      </form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        let dir = direction;
        f.querySelectorAll('[data-dir] button').forEach(b => b.onclick = () => {
          dir = b.dataset.v; f.querySelectorAll('[data-dir] button').forEach(x => x.classList.toggle('active', x === b));
          f.querySelector('[data-who-label]').textContent = dir === 'lent' ? 'Кто должен' : 'Кому вы должны';
        });
        let people = [];
        repo.people.list().then(ps => { people = ps; f.querySelector('#fin-people').innerHTML = ps.map(p => `<option value="${U.esc(p.name)}">`).join(''); }).catch(() => {});
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!v.counterparty) return ui.fieldError(f, 'counterparty', 'Укажите человека');
          const amount = num(v.amount);
          if (!(amount > 0)) return ui.fieldError(f, 'amount', 'Введите сумму');
          const p = people.find(x => x.name.toLowerCase() === v.counterparty.trim().toLowerCase());
          const due = v.dueAt ? new Date(v.dueAt + 'T12:00') : null;
          ui.guard(f.querySelector('[type=submit]'), async () => {
            await repo.finance.addDebt({ direction: dir, amount, currency: v.currency, counterparty: v.counterparty.trim(), personId: p ? p.id : null, dueAt: due ? due.toISOString() : null, note: v.note || '' });
            close(); ui.toast('Долг записан', 'success'); onSaved && onSaved();
          });
        };
      }
    });
  }

  function debtDetails(d, onSaved) {
    ui.sheet({
      title: d.direction === 'lent' ? `${d.counterparty} должен` : `Вы должны: ${d.counterparty}`,
      body: `<div class="fin-debt-head"><div class="fin-big ${d.direction === 'lent' ? 'pos' : 'neg'}">${M(d.left, d.currency)}</div>
          <div class="small muted">из ${M(d.amount, d.currency)}${d.dueAt ? ` · до ${U.fmtDate(d.dueAt)}` : ''}${d.overdue ? ' · <span class="danger-text">просрочено</span>' : ''}</div>
          ${d.note ? `<p class="small mt-2">${U.esc(d.note)}</p>` : ''}</div>
        ${(d.payments || []).length ? `<div class="t-label mt-4 mb-2">Возвраты</div><div class="list">${d.payments.map(p => `<div class="list-item no-icon"><div class="grow">${U.fmtDate(p.date)}</div><b>${M(p.amount, d.currency)}</b></div>`).join('')}</div>` : ''}
        ${d.status === 'open' ? `<form class="mt-4" novalidate><div class="row gap-2"><input class="input grow" name="part" inputmode="decimal" placeholder="Сумма частичного возврата"><button class="btn btn-secondary" data-part type="submit">Вернули часть</button></div></form>
          <button class="btn btn-primary btn-block mt-3" data-full>${d.direction === 'lent' ? 'Вернули всё' : 'Я вернул всё'}</button>` : `<div class="banner info mt-4">${I('check', 'sm')}<span>Долг закрыт ${d.closedAt ? U.fmtDate(d.closedAt) : ''}</span></div>`}
        <button class="btn btn-ghost btn-block mt-3 danger-text" data-del>Удалить запись</button>`,
      onMount(body, close) {
        const done = msg => { close(); ui.toast(msg, 'success'); onSaved && onSaved(); };
        const form = body.querySelector('form');
        if (form) form.onsubmit = e => {
          e.preventDefault(); const amount = num(form.part.value);
          if (!(amount > 0)) { ui.toast('Введите сумму', 'error'); return; }
          ui.guard(form.querySelector('[data-part]'), async () => { const r = await repo.finance.repay(d.id, amount); done(r.status === 'closed' ? 'Долг закрыт' : `Осталось ${M(r.left, r.currency)}`); });
        };
        const full = body.querySelector('[data-full]');
        if (full) full.onclick = () => ui.guard(full, async () => { await repo.finance.repay(d.id); done('Долг закрыт'); });
        body.querySelector('[data-del]').onclick = async () => {
          if (!(await ui.confirmDanger('Удалить запись о долге?', `${d.counterparty} · ${M(d.amount, d.currency)}`))) return;
          ui.guard(null, async () => { await repo.finance.removeDebt(d.id); done('Запись удалена'); });
        };
      }
    });
  }

  function addMenu(onSaved) {
    ui.sheet({
      title: 'Записать',
      body: `<div class="list">
        <button class="list-item" data-a="expense"><div class="ico-tile">${I('download')}</div><div class="grow"><div class="li-title">Расход</div><div class="li-sub">Покупка, оплата, перевод</div></div></button>
        <button class="list-item" data-a="income"><div class="ico-tile">${I('upload')}</div><div class="grow"><div class="li-title">Доход</div><div class="li-sub">Зарплата, подработка, подарок</div></div></button>
        <button class="list-item" data-a="lent"><div class="ico-tile">${I('users')}</div><div class="grow"><div class="li-title">Дал в долг</div><div class="li-sub">Кто и сколько должен вам</div></div></button>
        <button class="list-item" data-a="borrowed"><div class="ico-tile">${I('wallet')}</div><div class="grow"><div class="li-title">Взял в долг</div><div class="li-sub">Кому и сколько должны вы</div></div></button>
      </div><p class="small muted mt-3">Можно и голосом: «Потратил 1200 на продукты», «Дал Артёму 5000 до пятницы».</p>`,
      onMount(body, close) {
        body.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
          close(); const a = b.dataset.a;
          setTimeout(() => (a === 'expense' || a === 'income' ? txSheet(a, null, onSaved) : debtSheet(a, onSaved)), 250);
        });
      }
    });
  }

  const txRow = t => `<button class="list-item fin-tx" data-tx="${t.id}"><div class="ico-tile ${t.kind === 'income' ? 'c-fact' : 'c-event'}">${I(t.kind === 'income' ? 'upload' : 'download')}</div>
      <div class="grow" style="min-width:0"><div class="li-title ellipsis">${U.esc(t.note || t.category)}</div><div class="li-sub">${U.esc(t.category)} · ${U.fmtDateTime(t.occurredAt)}</div></div>
      <b class="fin-amt ${t.kind === 'income' ? 'pos' : ''}">${t.kind === 'income' ? '+' : '−'}${M(t.amount, t.currency)}</b></button>`;

  const debtRow = d => `<button class="list-item fin-debt${d.status === 'closed' ? ' closed' : ''}" data-debt="${d.id}">${ui.avatar({ name: d.counterparty }, 'sm')}
      <div class="grow" style="min-width:0"><div class="li-title ellipsis">${U.esc(d.counterparty)}</div><div class="li-sub">${d.status === 'closed' ? 'Закрыт' : d.dueAt ? `до ${U.fmtDate(d.dueAt)}` : 'Без срока'}${d.overdue ? ' · <span class="danger-text">просрочено</span>' : ''}${d.note ? ' · ' + U.esc(d.note) : ''}</div></div>
      <b class="fin-amt ${d.direction === 'lent' ? 'pos' : 'neg'}">${M(d.status === 'closed' ? d.amount : d.left, d.currency)}</b></button>`;

  A.router.register('/finance', (el, ctx) => {
    let tab = ['overview', 'debts', 'ops'].includes(ctx.query.tab) ? ctx.query.tab : 'overview';
    let month = new Date(); month.setDate(1);
    let showClosed = false;
    el.innerHTML = `${ui.appbar({ back: true, title: 'Финансы', demo: true, actions: `<button class="icon-btn soft" data-add aria-label="Записать">${I('plus')}</button>` })}
      <main class="content">
        <div class="segmented" role="tablist">${[['overview', 'Обзор'], ['debts', 'Долги'], ['ops', 'Операции']].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="cal-nav row between mt-4" data-monthnav><button class="icon-btn" data-prev aria-label="Предыдущий месяц">${I('back')}</button><div class="bold" data-month></div><button class="icon-btn" data-next aria-label="Следующий месяц">${I('chevron')}</button></div>
        <div class="mt-3" data-body></div>
      </main>`;
    const bodyEl = el.querySelector('[data-body]');

    function bindRows(root, txs, debts) {
      root.querySelectorAll('[data-tx]').forEach(b => b.onclick = () => txSheet(null, txs.find(t => t.id === b.dataset.tx), load));
      root.querySelectorAll('[data-debt]').forEach(b => b.onclick = () => debtDetails(debts.find(d => d.id === b.dataset.debt), load));
    }

    function overview([s, txs, debts]) {
      const tot = s.totals.find(t => t.currency === 'RUB') || s.totals[0] || { currency: 'RUB', income: 0, expense: 0, balance: 0 };
      const others = s.totals.filter(t => t !== tot);
      const cats = s.byCategory.filter(c => c.currency === tot.currency);
      const max = Math.max(1, ...cats.map(c => c.amount));
      const ds = s.debts.find(x => x.currency === 'RUB') || s.debts[0];
      bodyEl.innerHTML = `
        <div class="fin-cards">
          <div class="card fin-card"><div class="small muted">Доходы</div><div class="fin-big pos">${M(tot.income, tot.currency)}</div></div>
          <div class="card fin-card"><div class="small muted">Расходы</div><div class="fin-big">${M(tot.expense, tot.currency)}</div></div>
        </div>
        <div class="card fin-card mt-3 row between"><div><div class="small muted">Баланс за месяц</div><div class="fin-big ${tot.balance >= 0 ? 'pos' : 'neg'}">${M(tot.balance, tot.currency)}</div></div>
          ${ds ? `<button class="link-btn" data-go-debts>${I('users', 'sm')} Мне должны ${M(ds.owedToMe, ds.currency)}<br>${I('wallet', 'sm')} Я должен ${M(ds.iOwe, ds.currency)}</button>` : ''}</div>
        ${others.length ? `<p class="small muted mt-2">Ещё: ${others.map(o => `${M(o.income, o.currency)} доход, ${M(o.expense, o.currency)} расход`).join('; ')}</p>` : ''}
        ${s.overdueDebts ? `<div class="banner danger mt-3">${I('alert', 'sm')}<span>Просроченных долгов: ${s.overdueDebts}</span></div>` : ''}
        <div class="section"><div class="t-label mb-2">Расходы по категориям</div>
          ${cats.length ? `<div class="fin-bars">${cats.slice(0, 8).map(c => `<div class="fin-bar"><div class="row between small"><span>${U.esc(c.category)}</span><b>${M(c.amount, c.currency)}</b></div><div class="fin-track"><i style="width:${Math.max(3, Math.round(c.amount / max * 100))}%"></i></div></div>`).join('')}</div>`
          : '<p class="small muted">Расходов в этом месяце нет.</p>'}</div>
        <div class="section"><div class="section-head"><h3>Последние операции</h3>${txs.length > 5 ? '<button class="link-btn" data-go-ops>Все</button>' : ''}</div>
          ${txs.length ? `<div class="list">${txs.slice(0, 5).map(txRow).join('')}</div>` : ui.empty({ icon: 'wallet', title: 'Операций пока нет', text: 'Нажмите «+» или скажите Adis: «Потратил 1200 на продукты».' })}</div>`;
      const gd = bodyEl.querySelector('[data-go-debts]'); if (gd) gd.onclick = () => setTab('debts');
      const go = bodyEl.querySelector('[data-go-ops]'); if (go) go.onclick = () => setTab('ops');
      bindRows(bodyEl, txs, debts);
    }

    function debtsView([, , debts]) {
      const list = debts.filter(d => showClosed || d.status === 'open');
      const section = (title, dir) => {
        const items = list.filter(d => d.direction === dir);
        const sums = {};
        items.filter(d => d.status === 'open').forEach(d => { sums[d.currency] = (sums[d.currency] || 0) + d.left; });
        return `<div class="section"><div class="section-head"><h3>${title}</h3><span class="bold ${dir === 'lent' ? 'pos-text' : 'neg-text'}">${Object.entries(sums).map(([c, v]) => M(v, c)).join(', ')}</span></div>
          ${items.length ? `<div class="list">${items.map(debtRow).join('')}</div>` : `<p class="small muted">${dir === 'lent' ? 'Вам никто не должен.' : 'Вы никому не должны.'}</p>`}</div>`;
      };
      bodyEl.innerHTML = `${section('Мне должны', 'lent')}${section('Я должен', 'borrowed')}
        <label class="row gap-2 small mt-4"><input type="checkbox" data-closed ${showClosed ? 'checked' : ''}> Показать закрытые</label>
        <div class="row gap-2 mt-4"><button class="btn btn-secondary btn-sm" data-new="lent">${I('plus', 'sm')}Дал в долг</button><button class="btn btn-secondary btn-sm" data-new="borrowed">${I('plus', 'sm')}Взял в долг</button></div>`;
      bodyEl.querySelector('[data-closed]').onchange = e => { showClosed = e.target.checked; load(); };
      bodyEl.querySelectorAll('[data-new]').forEach(b => b.onclick = () => debtSheet(b.dataset.new, load));
      bindRows(bodyEl, [], debts);
    }

    function opsView([, txs]) {
      if (!txs.length) { bodyEl.innerHTML = ui.empty({ icon: 'wallet', title: 'В этом месяце операций нет', action: '<button class="btn btn-primary" data-add2>Записать</button>' }); bodyEl.querySelector('[data-add2]').onclick = () => addMenu(load); return; }
      bodyEl.innerHTML = txs.map((t, i) => `${i === 0 || !U.isSameDay(txs[i - 1].occurredAt, t.occurredAt) ? `<div class="t-label mt-4 mb-2">${U.fmtRelDay(t.occurredAt)}</div>` : ''}<div class="list">${txRow(t)}</div>`).join('');
      bindRows(bodyEl, txs, []);
    }

    function load() {
      el.querySelector('[data-month]').textContent = `${U.MONTHS_NOM[month.getMonth()]} ${month.getFullYear()}`;
      el.querySelector('[data-monthnav]').classList.toggle('hidden', tab === 'debts');
      const from = new Date(month), to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      ui.load(bodyEl, () => Promise.all([
        repo.finance.summary(monthKey(month)),
        repo.finance.transactions({ from: from.toISOString(), to: to.toISOString() }),
        repo.finance.debts(showClosed ? {} : { status: 'open' })
      ]), data => (tab === 'overview' ? overview : tab === 'debts' ? debtsView : opsView)(data));
    }
    function setTab(t) { tab = t; el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t)); A.router.replaceSilently('#/finance?tab=' + t); load(); }

    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
    el.querySelector('[data-prev]').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); load(); };
    el.querySelector('[data-next]').onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); load(); };
    el.querySelector('[data-add]').onclick = () => addMenu(load);
    ctx.onLeave(A.bus.on('data:finance', () => el.isConnected && load()));
    load();
  }, { backTo: '#/tools' });

  A.screens = A.screens || {};
  Object.assign(A.screens, { txSheet, debtSheet });
})(window.Adis);
