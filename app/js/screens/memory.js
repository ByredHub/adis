/* "Моя память": categories, search, filters, detail with source/dates, confirm/edit/delete. Plus people & person card. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const CATS = [['all', 'Все'], ['person', 'Люди'], ['event', 'События'], ['fact', 'Факты'], ['idea', 'Идеи'], ['preference', 'Предпочтения'], ['plan', 'Планы'], ['knowledge', 'Знания'], ['unconfirmed', 'Проверить']];
  const inCat = (m, cat) => cat === 'all' || (cat === 'unconfirmed' ? !m.confirmed : cat === 'plan' ? (m.type === 'plan' || m.type === 'intention') : cat === 'fact' ? (m.type === 'fact' || m.type === 'assumption') : m.type === cat);

  function memoryForm(m = {}) {
    return `<form novalidate>
      <div class="field"><label>Тип записи</label><select class="select" name="type">${Object.entries(A.MEMORY_TYPES).filter(([k]) => k !== 'person').map(([k, t]) => `<option value="${k}" ${(m.type || 'fact') === k ? 'selected' : ''}>${t.one}</option>`).join('')}</select>
        <div class="hint">Факт — точно известно. Предположение — требует проверки. Намерение — то, что вы хотите сделать.</div></div>
      <div class="field"><label>Заголовок</label><input class="input" name="title" value="${U.esc(m.title || '')}" placeholder="Коротко о главном" autofocus></div>
      <div class="field"><label>Подробности</label><textarea class="textarea" name="content" placeholder="Что важно запомнить">${U.esc(m.content || '')}</textarea></div>
      <div class="field"><label>Теги (через запятую)</label><input class="input" name="tags" value="${U.esc((m.tags || []).join(', '))}"></div>
      <div class="field"><label>Фото</label><div class="photo-field" data-photo-field></div></div>
      <button class="btn btn-primary btn-block" type="submit">Сохранить</button></form>`;
  }

  /* Reusable photo picker inside forms: camera / gallery / remove */
  function bindPhotoField(box, initial, onChange) {
    let photo = initial || null;
    const draw = () => {
      box.innerHTML = photo
        ? `<img src="${U.esc(photo)}" alt=""><div class="col gap-2"><button type="button" class="btn btn-outline btn-sm" data-cam>${I('camera', 'sm')}Переснять</button><button type="button" class="btn btn-ghost btn-sm" data-rm>${I('trash', 'sm')}Убрать</button></div>`
        : `<button type="button" class="btn btn-outline btn-sm" data-cam>${I('camera', 'sm')}Камера</button><button type="button" class="btn btn-outline btn-sm" data-gal>${I('image', 'sm')}Из галереи</button>`;
      const set = shot => { if (shot) { photo = shot.dataUrl; onChange(photo); draw(); } };
      const cam = box.querySelector('[data-cam]'); if (cam) cam.onclick = () => A.camera.capture({ title: 'Фото в память' }).then(set);
      const gal = box.querySelector('[data-gal]'); if (gal) gal.onclick = () => A.camera.pickFile({ camera: false }).then(set);
      const rm = box.querySelector('[data-rm]'); if (rm) rm.onclick = () => { photo = null; onChange(null); draw(); };
    };
    draw();
  }

  function openMemoryForm(existing, onSaved) {
    ui.sheet({
      title: existing ? 'Изменить запись' : 'Новая запись в памяти',
      body: memoryForm(existing || {}),
      onMount(body, close) {
        const f = body.querySelector('form');
        let photo = existing ? existing.photo || null : null;
        bindPhotoField(f.querySelector('[data-photo-field]'), photo, p => { photo = p; });
        f.onsubmit = e => {
          e.preventDefault();
          const v = ui.formData(f);
          if (!v.title && !v.content && !photo) return ui.fieldError(f, 'title', 'Заполните заголовок или текст');
          if (!v.title && !v.content) v.title = `Фото · ${U.fmtDate(new Date())}`;
          if (A.settings.get('sensitiveGuard') && A.nlu.isSensitive(v.title + ' ' + v.content) && !f.dataset.ack) {
            f.dataset.ack = '1';
            f.insertAdjacentHTML('afterbegin', `<div class="banner danger mb-3">${I('lock', 'sm')}<span>Похоже на чувствительные данные (пароль, документы, здоровье). Нажмите «Сохранить» ещё раз, если уверены.</span></div>`);
            return;
          }
          const payload = { type: v.type, title: v.title || A.nlu.memoryTitle(v.content), content: v.content, tags: v.tags.split(',').map(s => s.trim()).filter(Boolean), confirmed: v.type !== 'assumption', photo };
          ui.guard(f.querySelector('[type=submit]'), async () => {
            const r = existing ? await repo.memory.update(existing.id, payload) : await repo.memory.create(Object.assign(payload, { source: { kind: 'manual' } }));
            close(); ui.toast(existing ? 'Запись обновлена' : 'Сохранено в память', 'success'); onSaved && onSaved(r);
          });
        };
      }
    });
  }
  A.screens = A.screens || {};
  A.screens.openMemoryForm = openMemoryForm;

  /* ---------- Memory list ---------- */
  A.router.register('/memory', (el, ctx) => {
    let cat = ctx.query.filter || ctx.query.cat || 'all', q = '';
    el.innerHTML = `${ui.appbar({ title: 'Моя память', large: true, demo: true, actions: `<a class="icon-btn" href="#/people" aria-label="Люди">${I('users')}</a><button class="icon-btn soft" data-add aria-label="Добавить запись">${I('plus')}</button>` })}
      <main class="content">
        <label class="search">${I('search', 'sm')}<input type="search" placeholder="Поиск: «Python», «встречи», «Артём»" aria-label="Поиск по памяти"></label>
        <div class="chips mt-3" data-cats></div>
        <div class="mt-4" data-stats></div>
        <div class="mt-3" data-list></div>
      </main>`;
    const listEl = el.querySelector('[data-list]');
    let mems = [], people = [];

    function drawCats() {
      el.querySelector('[data-cats]').innerHTML = CATS.map(([k, l]) => {
        const n = k === 'person' ? people.length : mems.filter(m => inCat(m, k)).length;
        if (k === 'unconfirmed' && !n) return '';
        return `<button class="chip${cat === k ? ' active' : ''}" data-cat="${k}">${l}<span class="count">${n}</span></button>`;
      }).join('');
      el.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; drawCats(); draw(); });
    }

    function draw() {
      el.querySelector('[data-stats]').innerHTML = cat === 'all' && !q ? `<div class="mem-stats"><div><b>${mems.length}</b><span>записей</span></div><div><b>${people.length}</b><span>людей</span></div><div><b>${mems.filter(m => !m.confirmed).length}</b><span>на проверку</span></div></div>` : '';
      const ql = q.toLowerCase();
      const match = (txt) => !ql || A.nlu.keywords(q).every(k => U.words(txt).some(w => w.includes(k) || U.sameStem(w, k))) || txt.toLowerCase().includes(ql);
      if (cat === 'person') {
        const ps = people.filter(p => match([p.name, p.profession, p.organization, (p.skills || []).join(' '), p.notes].join(' ')));
        listEl.innerHTML = ps.length ? `<div class="list">${ps.map(personItem).join('')}</div>` : ui.empty({ icon: 'users', title: 'Людей пока нет', text: 'Расскажите Adis о знакомстве: «Сегодня познакомился с …»', action: '<a class="btn btn-secondary btn-sm" href="#/people?new=1">Добавить вручную</a>' });
        return;
      }
      const list = mems.filter(m => inCat(m, cat) && match([m.title, m.content, (m.tags || []).join(' ')].join(' ')));
      const ps = cat === 'all' && q ? people.filter(p => match([p.name, p.profession, p.organization, (p.skills || []).join(' ')].join(' '))) : [];
      if (!list.length && !ps.length) {
        listEl.innerHTML = q ? ui.empty({ icon: 'search', title: 'Ничего не найдено', text: 'Попробуйте другое слово или категорию.' })
          : ui.empty({ icon: 'memory', title: 'Здесь будет то, что Adis запомнит', text: 'Скажите «Запомни, что…» в чате или добавьте запись вручную.', action: '<button class="btn btn-primary" data-add2>Добавить запись</button>' });
        const a2 = listEl.querySelector('[data-add2]'); if (a2) a2.onclick = () => openMemoryForm(null, load);
        return;
      }
      listEl.innerHTML = `${ps.length ? `<div class="t-label mb-2">Люди</div><div class="list mb-4">${ps.map(personItem).join('')}</div>` : ''}<div class="list">${list.map(memItem).join('')}</div>`;
    }

    const personItem = p => `<a class="list-item" href="#/person/${p.id}">${ui.avatar(p)}<div class="grow" style="min-width:0"><div class="li-title">${U.esc(p.name)}</div><div class="li-sub ellipsis">${U.esc([p.profession, (p.skills || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'Без описания')}</div></div><span class="chev">${I('chevron', 'sm')}</span></a>`;
    const memItem = m => `<a class="list-item" href="#/memory/${m.id}">${m.photo ? `<img class="mem-thumb" src="${U.esc(m.photo)}" alt="">` : ui.memIcon(m.type)}<div class="grow" style="min-width:0"><div class="li-title ellipsis">${U.esc(m.title)}</div><div class="li-sub ellipsis">${A.MEMORY_TYPES[m.type].one} · ${U.fmtDate(m.createdAt)}${m.confirmed ? '' : ' · <span class="warn-text">не подтверждено</span>'}</div></div><span class="chev">${I('chevron', 'sm')}</span></a>`;

    const load = () => ui.load(listEl, () => Promise.all([repo.memory.list(true), repo.people.list(true)]), ([m, p]) => { mems = m; people = p; drawCats(); draw(); }, { offline: () => { const m = repo.memory.offline(); return m.length ? [m, repo.people.offline()] : null; } });
    load();
    el.querySelector('input[type=search]').addEventListener('input', U.debounce(e => { q = e.target.value.trim(); draw(); }, 180));
    el.querySelector('[data-add]').onclick = () => openMemoryForm(null, load);
    if (ctx.query.new) setTimeout(() => openMemoryForm(null, load), 250);
  }, { tab: 'memory' });

  /* ---------- Memory detail ---------- */
  A.router.register('/memory/:id', async (el, ctx) => {
    el.innerHTML = `${ui.appbar({ back: true, title: 'Запись' })}<main class="content">${ui.loading()}</main>`;
    const main = el.querySelector('main');
    let m, people = [], conv = null;
    try {
      const list = await repo.memory.list(true);
      m = list.find(x => x.id === ctx.params.id);
      people = await repo.people.list();
      if (!m) throw new A.ApiError('not_found', 'Запись не найдена');
    } catch (e) { main.innerHTML = ui.error(e); const r = main.querySelector('[data-retry]'); if (r) r.onclick = ctx.refresh; return; }
    const t = A.MEMORY_TYPES[m.type];
    const person = m.personId && people.find(p => p.id === m.personId);
    const src = m.source || {};
    if (src.conversationId) { try { conv = await repo.chat.get(src.conversationId); } catch (_) { conv = null; } }
    const srcLabel = { chat: 'Из разговора в чате', voice: 'Из голосового разговора', manual: 'Добавлено вручную', agent: 'Создано агентом' }[src.kind] || 'Источник не указан';

    el.querySelector('.appbar').outerHTML = ui.appbar({ back: true, title: t.one, actions: `<button class="icon-btn" data-edit aria-label="Изменить">${I('edit')}</button><button class="icon-btn" data-del aria-label="Удалить">${I('trash')}</button>` });
    main.innerHTML = `
      <div class="detail-head">${ui.memIcon(m.type)}<div><div class="t-label">${t.one}</div><h1 class="t-h1">${U.esc(m.title)}</h1></div></div>
      ${m.confirmed ? `<div class="tag success mt-3">${I('check', 'sm')}Подтверждено</div>`
        : `<div class="card tinted mt-4"><div class="row" style="align-items:flex-start">${I('info')}<div class="grow"><div class="bold">Adis не уверен в этой записи</div><div class="small muted">Подтвердите, если это правда, — или удалите.</div></div></div><div class="row mt-3 gap-2"><button class="btn btn-primary btn-sm" data-confirm>Да, это верно</button><button class="btn btn-outline btn-sm" data-edit2>Исправить</button></div></div>`}
      ${m.photo ? `<button class="mem-photo mt-4" data-view-photo aria-label="Открыть фото"><img src="${U.esc(m.photo)}" alt=""></button>` : ''}
      ${m.content ? `<div class="card mt-4 md">${A.markdown.render(m.content)}</div>` : ''}
      ${(m.tags || []).length ? `<div class="chips wrap mt-4">${m.tags.map(x => `<span class="tag">#${U.esc(x)}</span>`).join('')}</div>` : ''}
      ${person ? `<div class="section"><div class="t-label mb-2">Связанный человек</div><a class="list-item list" href="#/person/${person.id}">${ui.avatar(person)}<div class="grow"><div class="li-title">${U.esc(person.name)}</div><div class="li-sub">${U.esc(person.profession || '')}</div></div>${I('chevron', 'sm')}</a></div>` : ''}
      <div class="section"><div class="t-label mb-2">Источник</div>
        <div class="card"><div class="row">${I(src.kind === 'voice' ? 'mic' : src.kind === 'manual' ? 'edit' : 'chat', 'sm')}<span class="bold small">${srcLabel}</span></div>
        ${src.excerpt ? `<blockquote class="src-quote">«${U.esc(src.excerpt)}»</blockquote>` : ''}
        ${conv ? `<a class="link-btn" href="#/chat/${conv.id}">Открыть разговор «${U.esc(conv.title)}»</a>` : ''}</div></div>
      <div class="section card"><div class="kv"><span class="k">Создано</span><span class="v">${U.fmtDate(m.createdAt, true)}, ${U.fmtTime(m.createdAt)}</span></div><div class="kv"><span class="k">Изменено</span><span class="v">${U.fmtDate(m.updatedAt, true)}, ${U.fmtTime(m.updatedAt)}</span></div></div>`;

    const edit = () => openMemoryForm(m, () => ctx.refresh());
    const vp = main.querySelector('[data-view-photo]'); if (vp) vp.onclick = () => ui.viewPhoto(m.photo);
    el.querySelector('[data-edit]').onclick = edit;
    const e2 = el.querySelector('[data-edit2]'); if (e2) e2.onclick = edit;
    const c = el.querySelector('[data-confirm]'); if (c) c.onclick = () => ui.guard(c, async () => { await repo.memory.update(m.id, { confirmed: true, type: m.type === 'assumption' ? 'fact' : m.type }); ui.toast('Подтверждено', 'success'); ctx.refresh(); });
    el.querySelector('[data-del]').onclick = async () => {
      if (!(await ui.confirmDanger('Удалить запись?', 'Adis забудет эту информацию. Действие нельзя отменить.'))) return;
      ui.guard(null, async () => { await repo.memory.remove(m.id); ui.toast('Запись удалена', 'success'); A.router.back('#/memory'); });
    };
  }, { backTo: '#/memory' });

  /* ---------- People ---------- */
  function personForm(p = {}) {
    return `<form novalidate>
      <div class="field"><label>Имя</label><input class="input" name="name" value="${U.esc(p.name || '')}" autofocus></div>
      <div class="field"><label>Профессия</label><input class="input" name="profession" value="${U.esc(p.profession || '')}"></div>
      <div class="field"><label>Навыки (через запятую)</label><input class="input" name="skills" value="${U.esc((p.skills || []).join(', '))}"></div>
      <div class="field"><label>Организация</label><input class="input" name="organization" value="${U.esc(p.organization || '')}"></div>
      <div class="field"><label>Дата знакомства</label><input class="input" type="date" name="metAt" value="${U.toLocalDateInput(p.metAt || new Date())}"></div>
      <div class="field"><label>Где познакомились</label><input class="input" name="metWhere" value="${U.esc(p.metWhere || '')}" placeholder="например, на конференции"></div>
      <div class="field"><label>Заметки</label><textarea class="textarea" name="notes">${U.esc(p.notes || '')}</textarea></div>
      <button class="btn btn-primary btn-block" type="submit">Сохранить</button></form>`;
  }
  function openPersonForm(existing, onSaved) {
    ui.sheet({
      title: existing ? 'Изменить карточку' : 'Новый человек', body: personForm(existing || {}),
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!v.name) return ui.fieldError(f, 'name', 'Введите имя');
          const payload = { name: v.name, profession: v.profession, organization: v.organization, metWhere: v.metWhere, notes: v.notes, metAt: new Date(v.metAt + 'T12:00').toISOString(), skills: v.skills.split(',').map(s => s.trim()).filter(Boolean) };
          ui.guard(f.querySelector('[type=submit]'), async () => {
            const r = existing ? await repo.people.update(existing.id, payload) : await repo.people.create(payload);
            close(); ui.toast('Сохранено', 'success'); onSaved && onSaved(r);
          });
        };
      }
    });
  }

  A.router.register('/people', (el, ctx) => {
    el.innerHTML = `${ui.appbar({ back: true, title: 'Знакомства и контакты', demo: true, actions: `<button class="icon-btn soft" data-add aria-label="Добавить человека">${I('plus')}</button>` })}
      <main class="content"><label class="search">${I('search', 'sm')}<input type="search" placeholder="Имя, профессия, навык" aria-label="Поиск людей"></label><div class="mt-4" data-list></div></main>`;
    const listEl = el.querySelector('[data-list]');
    let all = [];
    const draw = () => {
      const q = el.querySelector('input').value.trim().toLowerCase();
      const list = all.filter(p => !q || [p.name, p.profession, p.organization, (p.skills || []).join(' ')].join(' ').toLowerCase().includes(q));
      if (!all.length) { listEl.innerHTML = ui.empty({ icon: 'users', title: 'Пока никого', text: 'Расскажите Adis о новом знакомстве — он сам создаст карточку.', action: '<button class="btn btn-primary" data-add2>Добавить вручную</button>' }); listEl.querySelector('[data-add2]').onclick = () => openPersonForm(null, p => A.router.go('#/person/' + p.id)); return; }
      if (!list.length) { listEl.innerHTML = ui.empty({ icon: 'search', title: 'Никого не нашли' }); return; }
      listEl.innerHTML = `<div class="list">${list.map(p => `<a class="list-item" href="#/person/${p.id}">${ui.avatar(p)}<div class="grow" style="min-width:0"><div class="li-title">${U.esc(p.name)}</div><div class="li-sub ellipsis">${U.esc([p.profession, p.organization].filter(Boolean).join(' · ') || '—')}</div><div class="tiny faint">Знакомы с ${U.fmtDate(p.metAt)}</div></div><span class="chev">${I('chevron', 'sm')}</span></a>`).join('')}</div>`;
    };
    el.querySelector('input').addEventListener('input', U.debounce(draw, 150));
    const load = () => ui.load(listEl, () => repo.people.list(true), d => { all = d; draw(); }, { offline: repo.people.offline });
    load();
    el.querySelector('[data-add]').onclick = () => openPersonForm(null, p => A.router.go('#/person/' + p.id));
    if (ctx.query.new) setTimeout(() => openPersonForm(null, p => A.router.go('#/person/' + p.id)), 250);
  }, { backTo: '#/memory' });

  /* Center-crop to a square avatar */
  function squareAvatar(dataUrl, size = 256) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas'); c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  A.ui.squareAvatar = squareAvatar;

  A.router.register('/person/:id', async (el, ctx) => {
    el.innerHTML = `${ui.appbar({ back: true, title: '' })}<main class="content">${ui.loading()}</main>`;
    const main = el.querySelector('main');
    let p, mems = [], tasks = [];
    try {
      p = await repo.people.get(ctx.params.id);
      [mems, tasks] = await Promise.all([repo.memory.list(), repo.tasks.list()]);
    } catch (e) { main.innerHTML = ui.error(e); const r = main.querySelector('[data-retry]'); if (r) r.onclick = ctx.refresh; return; }
    const related = mems.filter(m => m.personId === p.id);
    const ptasks = tasks.filter(t => t.personId === p.id);

    el.querySelector('.appbar').outerHTML = ui.appbar({ back: true, title: '', actions: `<button class="icon-btn" data-edit aria-label="Изменить">${I('edit')}</button><button class="icon-btn" data-del aria-label="Удалить">${I('trash')}</button>` });
    main.innerHTML = `
      <div class="person-head">
        <button class="avatar-edit" data-avatar aria-label="Изменить фото">${ui.avatar(p, 'lg')}<span class="cam">${I('camera', 'sm')}</span></button>
        <h1 class="t-h1 mt-3">${U.esc(p.name)}</h1>
        <p class="muted">${U.esc([p.profession, p.organization].filter(Boolean).join(' · ') || 'Профессия не указана')}</p>
        <div class="row center gap-2 mt-3 wrap">
          <button class="btn btn-secondary btn-sm" data-remind>${I('bell', 'sm')}Напомнить связаться</button>
          <a class="btn btn-outline btn-sm" href="#/chat/new?q=${encodeURIComponent('Что ты знаешь о ' + p.name.split(' ')[0] + '?')}">${I('chat', 'sm')}Спросить Adis</a>
        </div>
      </div>
      ${(p.skills || []).length ? `<div class="section"><div class="t-label mb-2">Навыки</div><div class="chips wrap">${p.skills.map(s => `<span class="tag primary">${U.esc(s)}</span>`).join('')}</div></div>` : ''}
      <div class="section card">
        <div class="kv"><span class="k">Дата знакомства</span><span class="v">${U.fmtDate(p.metAt, true)}</span></div>
        ${p.metWhere ? `<div class="kv"><span class="k">Где познакомились</span><span class="v">${U.esc(p.metWhere)}</span></div>` : ''}
        ${p.organization ? `<div class="kv"><span class="k">Организация</span><span class="v">${U.esc(p.organization)}</span></div>` : ''}
      </div>
      ${p.notes ? `<div class="section"><div class="t-label mb-2">Заметки</div><div class="card">${U.esc(p.notes)}</div></div>` : ''}
      ${ptasks.length ? `<div class="section"><div class="t-label mb-2">Задачи</div><div class="list task-list" data-tasks>${ptasks.map(t => ui.taskRow(t, [p])).join('')}</div></div>` : ''}
      ${related.length ? `<div class="section"><div class="t-label mb-2">Связанные воспоминания</div><div class="list">${related.map(m => `<a class="list-item" href="#/memory/${m.id}">${ui.memIcon(m.type)}<div class="grow" style="min-width:0"><div class="li-title ellipsis">${U.esc(m.title)}</div><div class="li-sub">${U.fmtDate(m.createdAt)}</div></div>${I('chevron', 'sm')}</a>`).join('')}</div></div>` : ''}
      <div class="section"><div class="section-head"><h3>История взаимодействий</h3><button class="link-btn" data-add-int>${I('plus', 'sm')} Добавить</button></div>
        <div class="timeline">${(p.interactions || []).slice().sort((a, b) => b.date.localeCompare(a.date)).map(i => `<div class="tl-item"><span class="tl-dot"></span><div><div class="small bold">${U.fmtDate(i.date, true)}</div><div class="small muted">${U.esc(i.text)}</div></div></div>`).join('') || '<p class="muted small">Пока нет записей</p>'}</div></div>`;

    const t = main.querySelector('[data-tasks]'); if (t) ui.bindTaskRows(t, ctx.refresh);
    el.querySelector('[data-edit]').onclick = () => openPersonForm(p, () => ctx.refresh());
    el.querySelector('[data-del]').onclick = async () => {
      if (!(await ui.confirmDanger(`Удалить ${p.name}?`, 'Карточка будет удалена. Связанные воспоминания и задачи останутся, но без связи с человеком.'))) return;
      ui.guard(null, async () => { await repo.people.remove(p.id); ui.toast('Карточка удалена', 'success'); A.router.back('#/people'); });
    };
    main.querySelector('[data-remind]').onclick = () => A.screens.taskSheet(null, { title: `Связаться: ${p.name}`, personId: p.id });
    main.querySelector('[data-add-int]').onclick = () => ui.sheet({
      title: 'Новое взаимодействие',
      body: `<form><div class="field"><label>Что было</label><textarea class="textarea" name="text" placeholder="Созвонились, обсудили…" autofocus></textarea></div><div class="field"><label>Дата</label><input class="input" type="date" name="date" value="${U.toLocalDateInput(new Date())}"></div><button class="btn btn-primary btn-block" type="submit">Добавить</button></form>`,
      onMount(body, close) {
        const f = body.querySelector('form');
        f.onsubmit = e => {
          e.preventDefault(); const v = ui.formData(f);
          if (!v.text) return ui.fieldError(f, 'text', 'Опишите взаимодействие');
          ui.guard(f.querySelector('[type=submit]'), async () => {
            await repo.people.update(p.id, { interactions: [{ date: new Date(v.date + 'T12:00').toISOString(), text: v.text }, ...(p.interactions || [])] });
            close(); ctx.refresh();
          });
        };
      }
    });
    const savePhoto = shot => shot && ui.guard(null, async () => { const photo = await squareAvatar(shot.dataUrl); await repo.people.update(p.id, { photo }); ui.toast('Фото обновлено', 'success'); ctx.refresh(); });
    main.querySelector('[data-avatar]').onclick = () => ui.sheet({
      title: 'Фото контакта',
      body: `<div class="attach-grid">
        <button data-src="camera"><span class="ico-tile">${I('camera')}</span>Камера</button>
        <button data-src="gallery"><span class="ico-tile">${I('image')}</span>Галерея</button>
        ${p.photo ? `<button data-src="remove"><span class="ico-tile" style="background:var(--danger-soft);color:var(--danger)">${I('trash')}</span>Убрать</button>` : ''}</div>`,
      onMount(body, close) {
        body.querySelector('[data-src=camera]').onclick = () => { close(); A.camera.capture({ title: p.name }).then(savePhoto); };
        body.querySelector('[data-src=gallery]').onclick = () => { close(); A.camera.pickFile({ camera: false }).then(savePhoto); };
        const rm = body.querySelector('[data-src=remove]');
        if (rm) rm.onclick = () => { close(); ui.guard(null, async () => { await repo.people.update(p.id, { photo: null }); ui.toast('Фото удалено', 'success'); ctx.refresh(); }); };
      }
    });
  }, { backTo: '#/people' });
})(window.Adis);
