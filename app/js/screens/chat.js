/* Chats list + conversation screen: streaming answers, Markdown/code, copy, regenerate, attachments,
 * inline voice recording bar (waveform + cancel + insert/send), network error handling and shared action cards. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const TEXT_EXT = /\.(txt|md|csv|tsv|json|js|ts|py|html|css|xml|log|yaml|yml|sql)$/i;

  /* ---------------- Chats list ---------------- */
  A.router.register('/chats', (el, ctx) => {
    el.innerHTML = `${ui.appbar({ title: A.t('nav.chats'), large: true, actions: `<a class="icon-btn" data-go-voice href="#/voice" aria-label="Голосовой режим">${I('mic')}</a><a class="icon-btn soft" href="#/chat/new" aria-label="Новый чат">${I('plus')}</a>` })}
      <main class="content">
        <label class="search">${I('search', 'sm')}<input type="search" placeholder="Поиск по истории" aria-label="Поиск по чатам"></label>
        <div class="mt-4" data-list></div>
      </main>`;
    const gv = el.querySelector('[data-go-voice]');
    if (gv) gv.onclick = e => { if (e.isTrusted) { A.voice.unlockAudio(); A.state.voiceAutoStart = true; } };
    const listEl = el.querySelector('[data-list]');
    let all = [];
    const draw = () => {
      const q = el.querySelector('input').value.trim().toLowerCase();
      const list = all.filter(c => !q || (c.title + ' ' + c.lastMessage).toLowerCase().includes(q));
      if (!all.length) { listEl.innerHTML = ui.empty({ icon: 'chat', title: 'Здесь будут ваши разговоры', text: 'Начните первый диалог — Adis запомнит важное.', action: '<a class="btn btn-primary" href="#/chat/new">Новый чат</a>' }); return; }
      if (!list.length) { listEl.innerHTML = ui.empty({ icon: 'search', title: 'Ничего не найдено', text: 'Попробуйте другой запрос.' }); return; }
      listEl.innerHTML = `<div class="list">${list.map(c => `<div class="list-item conv-item"><a class="row grow" href="#/chat/${c.id}" style="min-width:0;color:inherit"><div class="ico-tile">${I('chat')}</div><div class="grow" style="min-width:0"><div class="row between"><div class="li-title ellipsis">${U.esc(c.title)}</div><span class="tiny faint" style="flex:none">${U.fmtRelDay(c.updatedAt)}</span></div><div class="li-sub ellipsis">${U.esc(c.lastMessage || '')}</div></div></a><button class="icon-btn" data-del="${c.id}" aria-label="Удалить чат">${I('trash', 'sm')}</button></div>`).join('')}</div>`;
      listEl.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!(await ui.confirmDanger('Удалить чат?', 'История этого разговора будет удалена. Сохранённые в память данные останутся.'))) return;
        ui.guard(b, async () => { await repo.chat.remove(b.dataset.del); all = all.filter(c => c.id !== b.dataset.del); draw(); ui.toast('Чат удалён', 'success'); });
      });
    };
    el.querySelector('input').addEventListener('input', U.debounce(draw, 150));
    const load = () => ui.load(listEl, () => repo.chat.list(true), d => { all = d; draw(); }, { offline: repo.chat.offline });
    load();
    ctx.onLeave(A.bus.on('data:conversations', () => el.isConnected && load()));
  }, { tab: 'chats' });

  /* ---------------- Conversation ---------------- */
  A.router.register('/chat/:id', async (el, ctx) => {
    const st = { conv: null, messages: [], streaming: false, abort: null, files: [], people: [], memories: [], tasks: [], dictation: null, stopMeter: null, recRaf: 0 };
    const user = repo.auth.user || {};
    const assistant = user.assistantName || 'Adis';

    el.innerHTML = `${ui.appbar({ back: true, title: 'Новый чат', sub: `${assistant} · ${A.api.isDemo() ? 'демо-движок' : 'AI Backend'}`, bordered: true, actions: `<a class="icon-btn" data-go-voice href="#/voice" aria-label="Голосовой режим">${I('mic')}</a><a class="icon-btn" href="#/chat/new" aria-label="Новый чат">${I('plus')}</a><button class="icon-btn hidden" data-del aria-label="Удалить чат">${I('trash', 'sm')}</button>` })}
      <main class="content chat-scroll"><div class="messages" aria-live="polite"></div></main>
      <form class="chat-composer" novalidate>
        <div class="files hidden"></div>
        <div class="composer" data-comp-box>
          <button type="button" class="icon-btn" data-attach aria-label="Прикрепить файл">${I('clip')}</button>
          <textarea name="q" rows="1" placeholder="Сообщение для ${U.esc(assistant)}…" aria-label="Сообщение"></textarea>
          <button type="button" class="icon-btn" data-mic aria-label="Надиктовать сообщение">${I('mic')}</button>
          <button type="submit" class="icon-btn primary send" aria-label="Отправить" disabled>${I('send')}</button>
          <div class="rec-bar hidden" data-rec-bar>
            <button type="button" class="icon-btn rec-cancel" data-rec-cancel aria-label="Отменить запись" title="Отменить">${I('x', 'sm')}</button>
            <span class="rec-dot"></span>
            <span class="rec-time" data-rec-time>0:00</span>
            <div class="rec-eq" data-rec-eq aria-hidden="true">${Array.from({ length: 16 }, () => '<i></i>').join('')}</div>
            <span class="rec-hint ellipsis" data-rec-hint>Слушаю…</span>
            <button type="button" class="icon-btn rec-check" data-rec-insert aria-label="Вставить в поле для проверки" title="Вставить в текст">${I('check', 'sm')}</button>
            <button type="button" class="icon-btn primary rec-send" data-rec-send aria-label="Завершить и отправить" title="Отправить сразу">${I('send', 'sm')}</button>
          </div>
        </div>
        <input type="file" multiple hidden>
      </form>`;

    const msgsEl = el.querySelector('.messages');
    const scroller = el.querySelector('.chat-scroll');
    const form = el.querySelector('form');
    const compBox = form.querySelector('[data-comp-box]');
    const ta = form.q, sendBtn = form.querySelector('.send'), fileInput = form.querySelector('input[type=file]');
    const titleEl = el.querySelector('.appbar .title');
    const voiceLink = el.querySelector('[data-go-voice]');
    const scrollDown = (smooth) => requestAnimationFrame(() => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));

    function syncVoiceHref() {
      if (voiceLink) voiceLink.setAttribute('href', st.conv ? `#/voice?conv=${encodeURIComponent(st.conv.id)}` : '#/voice');
    }
    if (voiceLink) voiceLink.onclick = e => { if (e.isTrusted) { A.voice.unlockAudio(); A.state.voiceAutoStart = true; } };

    function setTitle(t) { titleEl.firstChild.nodeValue = t; el.querySelector('[data-del]').classList.toggle('hidden', !st.conv); syncVoiceHref(); }

    async function loadRefs() {
      try { [st.people, st.memories, st.tasks] = await Promise.all([repo.people.list(), repo.memory.list(), repo.tasks.list()]); } catch (_) { /* cards degrade gracefully */ }
    }

    /* ---------- rendering ---------- */
    function userHtml(m) {
      const imgs = (m.attachments || []).filter(f => f.image), files = (m.attachments || []).filter(f => !f.image);
      return `<div class="msg user" data-mid="${m.id}">
        ${imgs.length ? `<div class="msg-photos">${imgs.map(f => `<button class="msg-photo" data-view-photo="${U.esc(f.image)}" aria-label="Открыть фото"><img src="${U.esc(f.image)}" alt="${U.esc(f.name)}" loading="lazy"></button>`).join('')}</div>` : ''}
        ${m.content || files.length ? `<div class="bubble">${m.source === 'voice' ? `<span class="voice-mark">${I('mic', 'sm')}</span>` : ''}${U.esc(m.content).replace(/\n/g, '<br>')}
        ${files.length ? `<div class="att">${files.map(f => `<span class="tag">${I('file', 'sm')}${U.esc(f.name)}</span>`).join('')}</div>` : ''}</div>` : ''}
        ${m.failed ? `<div class="msg-error">${I('alert', 'sm')}<span>${U.esc(m.failed)}</span><button class="link-btn" data-retry>Повторить</button></div>` : ''}</div>`;
    }

    function assistantHtml(m, isLast) {
      return `<div class="msg ai" data-mid="${m.id}"><div class="orb sm"></div><div class="ai-body">
        <div class="md">${A.markdown.render(m.content)}${m.stopped ? '<p class="tiny faint">Генерация остановлена</p>' : ''}</div>
        <div class="cards">${A.cards.renderList(m.cards, st)}</div>
        <div class="msg-actions">
          <button class="icon-btn" data-copy aria-label="Копировать">${I('copy', 'sm')}</button>
          ${A.voice.ttsSupported ? `<button class="icon-btn" data-speak aria-label="Озвучить">${I('volume', 'sm')}</button>` : ''}
          ${isLast ? `<button class="icon-btn" data-regen aria-label="Сгенерировать заново">${I('refresh', 'sm')}</button>` : ''}
          <span class="tiny faint">${U.fmtTime(m.createdAt)}${m.engine === 'demo' ? ' · демо' : m.engine === 'rules' ? ' · без LLM' : ''}</span>
        </div></div></div>`;
    }

    function introHtml() {
      return `<div class="chat-intro"><div class="orb xl pulse" style="width:96px;height:96px"></div><h2 class="t-h2 mt-4">Я ${U.esc(assistant)}. Чем помочь?</h2>
        <p class="muted small mt-2">Говорите как с человеком — я запомню важное и напомню вовремя.</p>
        <div class="col mt-4 intro-prompts">${['Сегодня познакомился с Артёмом. Он программист, работает с Python и занимается разработкой сайтов', 'С кем я недавно познакомился из программистов?', 'Напомни завтра в 10 позвонить Артёму', 'Что ты умеешь?'].map(p => `<button class="card pressable intro-p" data-prompt="${U.esc(p)}">${U.esc(p)}</button>`).join('')}</div></div>`;
    }

    function sourceFor(m) {
      const idx = st.messages.indexOf(m);
      const um = st.messages.slice(0, idx).reverse().find(x => x.role === 'user');
      return { kind: um && um.source === 'voice' ? 'voice' : 'chat', conversationId: st.conv && st.conv.id, messageId: m.id, excerpt: um ? um.content.slice(0, 300) : '' };
    }

    function renderAll() {
      if (!st.messages.length) { msgsEl.innerHTML = introHtml(); msgsEl.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => send(b.dataset.prompt)); return; }
      const lastAi = [...st.messages].reverse().find(m => m.role === 'assistant');
      msgsEl.innerHTML = st.messages.map(m => m.role === 'user' ? userHtml(m) : assistantHtml(m, m === lastAi && !st.streaming)).join('');
      bindMessages();
    }

    function bindMessages() {
      msgsEl.querySelectorAll('.msg.ai').forEach(node => {
        const m = st.messages.find(x => x.id === node.dataset.mid);
        if (!m) return;
        const c = node.querySelector('[data-copy]'); if (c) c.onclick = async () => ui.toast((await U.copy(m.content)) ? 'Скопировано' : 'Не удалось скопировать', 'success');
        const s = node.querySelector('[data-speak]'); if (s) s.onclick = () => { if (A.voice.speaking) A.voice.stopSpeaking(); else A.voice.speak(m.content); };
        const r = node.querySelector('[data-regen]'); if (r) r.onclick = () => send(null, { regenerate: true });
        A.cards.bind(node, m, {
          convId: st.conv && st.conv.id,
          source: sourceFor,
          root: msgsEl,
          onUpdate: async () => { await loadRefs(); renderAll(); }
        });
      });
      msgsEl.querySelectorAll('[data-view-photo]').forEach(b => b.onclick = () => A.ui.viewPhoto(b.dataset.viewPhoto));
      msgsEl.querySelectorAll('.msg.user [data-retry]').forEach(b => b.onclick = () => {
        const m = st.messages.find(x => x.id === b.closest('.msg').dataset.mid);
        st.messages = st.messages.filter(x => x !== m);
        send(m.content, { source: m.source, retryOf: m });
      });
    }

    /* ---------- sending & streaming ---------- */
    let streamNode = null;
    function showStream() {
      msgsEl.querySelector('.chat-intro') && (msgsEl.innerHTML = '');
      msgsEl.insertAdjacentHTML('beforeend', `<div class="msg ai streaming"><div class="orb sm pulse"></div><div class="ai-body"><div class="gen-status"><span class="dots"><i></i><i></i><i></i></span><span data-status>${U.esc(assistant)} думает…</span></div><div class="md"></div></div></div>`);
      streamNode = msgsEl.lastElementChild;
      scrollDown(true);
    }

    function setStreaming(v) {
      st.streaming = v;
      sendBtn.innerHTML = v ? I('stop') : I('send');
      sendBtn.setAttribute('aria-label', v ? 'Остановить генерацию' : 'Отправить');
      sendBtn.classList.toggle('stop', v);
      sendBtn.disabled = v ? false : (!ta.value.trim() && !st.files.length);
    }

    async function send(text, { source = 'text', regenerate = false, retryOf = null } = {}) {
      if (st.streaming) return;
      const content = (text || '').trim();
      const files = regenerate ? [] : st.files.slice();
      if (!regenerate && !content && !files.length) return;
      const clientMessageId = retryOf ? retryOf.clientMessageId : U.uid('cm');
      const body = { conversationId: st.conv && st.conv.id, content, attachments: files, clientMessageId, regenerate, source, autoSave: !A.settings.get('memoryAskBeforeSave'), sensitiveGuard: A.settings.get('sensitiveGuard'), style: A.settings.get('responseStyle') };
      let localUser = null;
      if (regenerate) {
        const lastAi = st.messages[st.messages.length - 1];
        if (lastAi && lastAi.role === 'assistant') st.messages.pop();
      } else {
        localUser = { id: U.uid('tmp'), role: 'user', content, attachments: files.map(f => ({ name: f.name, size: f.size, type: f.type, image: f.image })), createdAt: new Date().toISOString(), source, clientMessageId };
        st.messages.push(localUser);
        ta.value = ''; st.files = []; drawFiles(); autosize();
      }
      renderAll();
      setStreaming(true);
      showStream();
      st.abort = new AbortController();
      let acc = '', started = false, raf = 0, final = null;
      const flush = () => { raf = 0; if (streamNode) { streamNode.querySelector('.md').innerHTML = A.markdown.render(acc); scrollDown(); } };
      try {
        for await (const evt of repo.chat.stream(body, st.abort.signal)) {
          if (evt.type === 'start') {
            started = true;
            if (!st.conv || st.conv.id !== evt.conversation.id) { st.conv = evt.conversation; A.router.replaceSilently('#/chat/' + st.conv.id); setTitle(st.conv.title); }
            if (localUser && evt.userMessage) Object.assign(localUser, evt.userMessage);
          } else if (evt.type === 'status') {
            const s = streamNode && streamNode.querySelector('[data-status]'); if (s) s.textContent = evt.text;
          } else if (evt.type === 'delta') {
            if (!acc && streamNode) streamNode.querySelector('.gen-status').classList.add('hidden');
            acc += evt.text; if (!raf) raf = requestAnimationFrame(flush);
          } else if (evt.type === 'done') { final = evt.message; }
        }
        if (final) {
          st.messages.push(final);
          if (final.cards && final.cards.some(c => c.status === 'confirmed')) { ['memories', 'people'].forEach(t => repo.invalidate(t)); }
          await loadRefs();
          if (source === 'voice' && A.settings.get('voiceAutoplay')) A.voice.speak(final.content);
        }
      } catch (e) {
        if (e.code === 'aborted' && acc) {
          st.messages.push({ id: U.uid('tmp'), role: 'assistant', content: acc, cards: [], createdAt: new Date().toISOString(), stopped: true });
        } else if (localUser) {
          localUser.failed = e.userMessage || 'Не удалось отправить';
          if (started) { localUser.failed = 'Ответ не получен'; }
        } else {
          ui.toast(e.userMessage || 'Ошибка', 'error');
        }
      } finally {
        cancelAnimationFrame(raf);
        streamNode = null; st.abort = null;
        setStreaming(false);
        renderAll();
        scrollDown(true);
        repo.chat.touched();
      }
    }

    /* ---------- composer & inline voice capsule ---------- */
    const autosize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 150) + 'px'; if (!st.streaming) sendBtn.disabled = !ta.value.trim() && !st.files.length; };
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); send(ta.value); } });
    form.onsubmit = e => { e.preventDefault(); if (st.streaming) { st.abort && st.abort.abort(); } else send(ta.value); };

    function drawFiles() {
      const box = form.querySelector('.files');
      box.classList.toggle('hidden', !st.files.length);
      box.innerHTML = st.files.map((f, i) => f.image
        ? `<span class="file-chip photo"><img src="${U.esc(f.image)}" alt=""><button type="button" data-rm="${i}" aria-label="Убрать фото">${I('x', 'sm')}</button></span>`
        : `<span class="file-chip">${I('file', 'sm')}<span class="ellipsis">${U.esc(f.name)}</span><span class="tiny faint">${U.fmtBytes(f.size)}</span><button type="button" data-rm="${i}" aria-label="Убрать файл">${I('x', 'sm')}</button></span>`).join('');
      box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { st.files.splice(+b.dataset.rm, 1); drawFiles(); autosize(); });
    }
    function addPhoto(shot) {
      if (!shot) return;
      if (st.files.length >= 5) { ui.toast('Не больше 5 вложений за раз', 'error'); return; }
      st.files.push({ name: shot.name, size: shot.size, type: shot.type, width: shot.width, height: shot.height, image: shot.dataUrl });
      drawFiles(); autosize(); ta.focus();
    }
    st.addPhoto = addPhoto;
    form.querySelector('[data-attach]').onclick = () => ui.sheet({
      title: 'Добавить',
      body: `<div class="attach-grid">
        <button data-src="camera"><span class="ico-tile">${I('camera')}</span>Камера</button>
        <button data-src="gallery"><span class="ico-tile">${I('image')}</span>Фото</button>
        <button data-src="file"><span class="ico-tile">${I('file')}</span>Файл</button></div>`,
      onMount(body, close) {
        body.querySelector('[data-src=camera]').onclick = () => { close(); A.camera.capture({ title: 'Фото для Adis' }).then(addPhoto); };
        body.querySelector('[data-src=gallery]').onclick = () => { close(); A.camera.pickFile({ camera: false }).then(addPhoto); };
        body.querySelector('[data-src=file]').onclick = () => { close(); fileInput.click(); };
      }
    });
    fileInput.onchange = async () => {
      for (const f of Array.from(fileInput.files)) {
        if (f.size > 10 * 1048576) { ui.toast(`${f.name}: файл больше 10 МБ`, 'error'); continue; }
        if (st.files.length >= 5) { ui.toast('Не больше 5 файлов за раз', 'error'); break; }
        if (/^image\//.test(f.type)) { try { const shot = await A.camera.fromFile(f); addPhoto(shot); } catch (e) { ui.toast(e.message, 'error'); } continue; }
        const item = { name: f.name, size: f.size, type: f.type };
        if ((f.type.startsWith('text/') || TEXT_EXT.test(f.name)) && f.size < 300 * 1024) item.text = await f.text();
        st.files.push(item);
      }
      fileInput.value = ''; drawFiles(); autosize();
    };

    const micBtn = form.querySelector('[data-mic]');
    const recBar = form.querySelector('[data-rec-bar]');
    const recTime = form.querySelector('[data-rec-time]');
    const recHint = form.querySelector('[data-rec-hint]');
    const eqBars = Array.from(form.querySelectorAll('[data-rec-eq] i'));
    let recMode = 'send', recLevel = 0, recStart = 0;

    function closeRecBar() {
      cancelAnimationFrame(st.recRaf);
      if (st.stopMeter) { st.stopMeter(); st.stopMeter = null; }
      recLevel = 0;
      compBox.classList.remove('is-recording');
      recBar.classList.add('hidden');
      micBtn.classList.remove('listening');
    }

    async function startDictation() {
      if (st.dictation) { recMode = 'send'; st.dictation.stop(); return; }
      A.voice.unlockAudio();
      if (!A.voice.sttSupported) {
        ui.toast('Распознавание речи недоступно в этом браузере. Подключитесь к AI Backend или откройте голосовой режим.', 'error');
        return;
      }
      const before = ta.value.trim();
      recMode = 'send';
      recLevel = 0;
      recStart = Date.now();
      compBox.classList.add('is-recording');
      recBar.classList.remove('hidden');
      micBtn.classList.add('listening');
      recHint.textContent = 'Говорите…';
      recTime.textContent = '0:00';

      let phase = 0;
      const tickEq = () => {
        phase += 0.14;
        const sec = Math.max(0, Math.floor((Date.now() - recStart) / 1000));
        recTime.textContent = `${Math.floor(sec / 60)}:${U.pad(sec % 60)}`;
        const amp = Math.max(0.16, recLevel * 1.2);
        eqBars.forEach((bar, i) => {
          const w = 0.45 + 0.55 * Math.sin(i * 0.7 + phase);
          const h = Math.round(Math.max(4, Math.min(22, amp * w * 22)));
          bar.style.height = h + 'px';
        });
        st.recRaf = requestAnimationFrame(tickEq);
      };
      tickEq();

      if (!A.voice.cloud.stt) st.stopMeter = await A.voice.meter(l => { recLevel = recLevel * 0.65 + l * 0.35; });
      st.dictation = A.voice.listen({
        onLevel: l => { recLevel = recLevel * 0.65 + l * 0.35; },
        onStage: s => { if (s === 'transcribing') recHint.textContent = 'Распознаю…'; },
        onPartial: tx => { if (tx && tx !== '…') recHint.textContent = tx; },
        onFinal: tx => {
          const full = ((before ? before + ' ' : '') + tx).trim();
          const mode = recMode;
          closeRecBar();
          st.dictation = null;
          if (!full) return;
          if (mode === 'insert') {
            ta.value = full;
            autosize();
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
          } else {
            ta.value = '';
            send(full, { source: 'voice' });
          }
        },
        onError: code => {
          closeRecBar();
          st.dictation = null;
          if (code !== 'no-speech' && code !== 'aborted') {
            ui.toast(code === 'not-allowed' ? 'Нет доступа к микрофону' : 'Не удалось распознать речь', 'error');
          }
        },
        onEnd: () => {
          closeRecBar();
          st.dictation = null;
        }
      });
      if (!st.dictation) closeRecBar();
    }

    micBtn.onclick = startDictation;
    form.querySelector('[data-rec-cancel]').onclick = () => { if (st.dictation) st.dictation.abort(); closeRecBar(); st.dictation = null; };
    form.querySelector('[data-rec-insert]').onclick = () => { recMode = 'insert'; if (st.dictation) st.dictation.stop(); };
    form.querySelector('[data-rec-send]').onclick = () => { recMode = 'send'; if (st.dictation) st.dictation.stop(); };

    ctx.onLeave(() => { cancelAnimationFrame(st.recRaf); st.stopMeter && st.stopMeter(); st.dictation && st.dictation.abort(); st.abort && st.abort.abort(); A.voice.stopSpeaking(); });

    el.querySelector('[data-del]').onclick = async () => {
      if (!st.conv || !(await ui.confirmDanger('Удалить чат?', 'История разговора будет удалена. Данные в памяти сохранятся.'))) return;
      await ui.guard(null, async () => { await repo.chat.remove(st.conv.id); ui.toast('Чат удалён', 'success'); A.router.go('#/chats', { replace: true }); });
    };

    /* ---------- init ---------- */
    await loadRefs();
    if (ctx.params.id !== 'new') {
      msgsEl.innerHTML = ui.loading('Загружаю разговор…');
      try {
        const c = await repo.chat.get(ctx.params.id);
        st.conv = c; st.messages = c.messages || []; setTitle(c.title);
      } catch (e) {
        msgsEl.innerHTML = ui.error(e);
        const r = msgsEl.querySelector('[data-retry]'); if (r) r.onclick = () => ctx.refresh();
        return;
      }
    }
    renderAll(); scrollDown();
    if (A.state.pendingPhoto) { addPhoto(A.state.pendingPhoto); A.state.pendingPhoto = null; }
    const q = ctx.query.q;
    if ((q || st.files.length) && ctx.params.id === 'new' && ctx.query.send) send(q || '', { source: ctx.query.source || 'text' });
    else if (q && ctx.params.id === 'new' && !st.files.length) send(q, { source: ctx.query.source || 'text' });
    else if (q) { ta.value = q; autosize(); setTimeout(() => ta.focus({ preventScroll: true }), 300); }
    else setTimeout(() => ta.focus({ preventScroll: true }), 300);
  }, { backTo: '#/chats' });
})(window.Adis);
