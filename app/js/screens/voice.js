/* Full-screen Voice Studio: sculpted 3D orb + high-DPI harmonic visualizer, live streaming answers,
 * interactive confirmation cards right on screen, multi-turn transcript, hands-free mode & inline text edit. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;

  A.router.register('/voice', async (el, ctx) => {
    const autoStart = !!A.state.voiceAutoStart;
    A.state.voiceAutoStart = false;
    if (!A.voice.cloud.checked) await A.voice.refreshCloud();

    const st = {
      state: 'idle',
      convId: ctx.query.conv || null,
      rec: null,
      stopMeter: null,
      abortStream: null,
      level: 0,
      demo: !A.voice.sttSupported,
      typing: !A.voice.sttSupported,
      lastYou: '',
      lastMsg: null,
      lastReply: '',
      turns: [],
      recStartedAt: 0,
      refs: { people: [], memories: [], tasks: [], events: [] }
    };
    const assistant = (repo.auth.user && repo.auth.user.assistantName) || 'Adis';

    el.classList.add('voice-screen');
    el.innerHTML = `
      <div class="voice-aurora" aria-hidden="true">
        <span class="vb b1"></span><span class="vb b2"></span><span class="vb b3"></span>
      </div>
      <header class="appbar voice-bar">
        <button class="icon-btn voice-nav-btn" data-close aria-label="Закрыть голосовой режим">${I('back')}</button>
        <div class="voice-head-center">
          <div class="voice-brand-row"><span class="v-live-dot"></span><span class="voice-title">${U.esc(assistant)}</span></div>
          <button type="button" class="voice-mode-pill" data-voice-opts title="Настройки голоса">
            <span data-mode></span>${I('down', 'sm')}
          </button>
        </div>
        <div class="voice-head-actions">
          <button class="icon-btn voice-nav-btn" data-voice-settings aria-label="Настройки голоса">${I('sliders', 'sm')}</button>
          <a class="icon-btn voice-nav-btn" data-to-chat href="#/chats" aria-label="Открыть чат">${I('chat', 'sm')}<span class="v-chat-badge hidden" data-turn-count>0</span></a>
        </div>
      </header>

      <main class="voice-main">
        <section class="voice-stage">
          <button type="button" class="voice-orb-wrap" data-orb aria-label="Управление микрофоном">
            <span class="ring r1"></span>
            <span class="ring r2"></span>
            <span class="ring r3"></span>
            <span class="orb voice-orb"><span class="voice-orb-glint"></span></span>
          </button>
          <canvas class="wave" width="340" height="68" aria-hidden="true"></canvas>
          <div class="voice-status-bar">
            <div class="voice-state-pill">
              <span class="v-state-ind"></span>
              <span class="voice-state" data-state role="status" aria-live="polite"></span>
              <span class="voice-timer hidden" data-timer>0:00</span>
            </div>
            <button type="button" class="voice-hf-chip${A.settings.get('voiceContinuous') ? ' on' : ''}" data-hf title="Автоматически слушать дальше после ответа Adis">
              ${I('repeat', 'sm')}<span>Авто-диалог</span>
            </button>
          </div>
        </section>

        <section class="voice-starters" data-starters>
          <div class="v-sec-head">Скажите или нажмите для примера</div>
          <div class="v-starter-grid" data-starter-list></div>
        </section>

        <section class="voice-dialogue">
          <div class="voice-history" data-history></div>
          <div class="voice-current hidden" data-current>
            <div class="v-you-row hidden" data-you-wrap>
              <div class="v-you-bubble">
                <span class="v-you-mic">${I('mic', 'sm')}</span>
                <p class="you" data-you></p>
                <button type="button" class="v-you-edit" data-edit-you aria-label="Исправить фразу" title="Исправить текст">${I('edit', 'sm')}</button>
              </div>
            </div>
            <div class="v-ai-wrap hidden" data-ai-wrap>
              <div class="v-ai-card">
                <div class="v-ai-head"><span class="orb sm"></span><b>${U.esc(assistant)}</b><span class="v-ai-sub" data-ai-sub></span></div>
                <div class="ai md" data-ai></div>
                <div class="v-ai-tools hidden" data-ai-tools>
                  ${A.voice.ttsSupported ? `<button type="button" class="v-tool-btn" data-replay>${I('volume', 'sm')}<span>Озвучить</span></button>` : ''}
                  <button type="button" class="v-tool-btn" data-copy-ai>${I('copy', 'sm')}<span>Копировать</span></button>
                </div>
              </div>
            </div>
            <div class="voice-cards" data-cards></div>
          </div>
        </section>
      </main>

      <footer class="voice-foot">
        ${st.demo ? `<div class="v-demo-note">${I('info', 'sm')}<span>Микрофон недоступен в этом браузере — напишите фразу ниже, ${U.esc(assistant)} ответит${A.voice.ttsSupported ? ' голосом' : ''}.</span></div>` : ''}
        <form class="composer voice-composer${st.typing ? '' : ' hidden'}" data-type-form novalidate>
          <textarea name="q" rows="1" placeholder="Напишите или подправьте фразу…"></textarea>
          <button class="icon-btn primary send" type="submit" aria-label="Отправить">${I('send', 'sm')}</button>
        </form>
        <div class="voice-dock">
          <div class="v-dock-slot">
            <button type="button" class="v-side-btn${st.typing ? ' active' : ''}" data-left-act aria-label="Текстовый ввод">
              <span class="v-side-ico" data-left-ico>${I('keyboard')}</span>
              <small data-left-lbl>Текст</small>
            </button>
          </div>
          <div class="v-dock-center">
            <button type="button" class="mic-big" data-mic aria-label="Говорить" ${st.demo ? 'disabled' : ''}>
              <span class="mic-big-ring"></span>
              <span data-mic-ico>${I('mic', 'lg')}</span>
            </button>
            <small class="v-mic-lbl" data-mic-lbl>${st.demo ? 'Недоступно' : 'Говорить'}</small>
          </div>
          <div class="v-dock-slot">
            <button type="button" class="v-side-btn" data-speakstop aria-label="Управление озвучкой">
              <span class="v-side-ico" data-right-ico>${I(A.settings.get('voiceAutoplay') ? 'volume' : 'x')}</span>
              <small data-right-lbl>${A.settings.get('voiceAutoplay') ? 'Голос вкл' : 'Без звука'}</small>
            </button>
          </div>
        </div>
      </footer>`;

    const $ = s => el.querySelector(s);
    const canvas = $('.wave'), g = canvas.getContext('2d');
    const orb = $('.voice-orb');
    const mainEl = $('.voice-main');

    const LABEL = {
      idle: st.demo ? 'Введите фразу — отвечу вслух' : 'Готов слушать вас',
      listening: 'Слушаю вас…',
      recognizing: 'Распознаю речь…',
      processing: `${assistant} думает…`,
      speaking: `${assistant} говорит`,
      error: 'Не расслышал — попробуйте ещё раз'
    };

    function syncVisibility() {
      const hasCurrent = !!(st.lastYou || $('[data-you]').textContent || $('[data-ai]').innerHTML || $('[data-cards]').innerHTML || st.state === 'listening' || st.state === 'recognizing' || st.state === 'processing');
      const hasAny = st.turns.length > 0 || hasCurrent;
      el.classList.toggle('has-turns', hasAny);
      $('[data-starters]').classList.toggle('hidden', hasAny);
      $('[data-current]').classList.toggle('hidden', !hasCurrent);
      $('[data-you-wrap]').classList.toggle('hidden', !($('[data-you]').textContent || st.state === 'listening'));
      $('[data-edit-you]').classList.toggle('hidden', !st.lastYou || st.state === 'listening' || st.state === 'processing');
      $('[data-ai-wrap]').classList.toggle('hidden', !($('[data-ai]').innerHTML || st.state === 'processing'));
      $('[data-ai-tools]').classList.toggle('hidden', !st.lastReply || st.state === 'processing');
      const chatLink = $('[data-to-chat]');
      chatLink.setAttribute('href', st.convId ? `#/chat/${st.convId}` : '#/chats');
      const total = st.turns.length + (st.lastReply ? 1 : 0);
      const badge = $('[data-turn-count]');
      badge.textContent = String(total);
      badge.classList.toggle('hidden', total === 0);
    }

    function syncDock() {
      const s = st.state;
      const micBtn = $('[data-mic]'), micIco = $('[data-mic-ico]'), micLbl = $('[data-mic-lbl]');
      const leftBtn = $('[data-left-act]'), leftIco = $('[data-left-ico]'), leftLbl = $('[data-left-lbl]');
      const rightBtn = $('[data-speakstop]'), rightIco = $('[data-right-ico]'), rightLbl = $('[data-right-lbl]');

      micBtn.classList.toggle('on', s === 'listening');
      micBtn.classList.toggle('busy', s === 'recognizing' || s === 'processing');
      micBtn.classList.toggle('interrupt', s === 'speaking');
      if (st.demo) {
        micIco.innerHTML = I('mic', 'lg');
        micLbl.textContent = 'Только текст';
      } else if (s === 'listening') {
        micIco.innerHTML = I('send', 'lg');
        micLbl.textContent = 'Отправить';
        micBtn.setAttribute('aria-label', 'Закончить и отправить фразу');
      } else if (s === 'recognizing' || s === 'processing') {
        micIco.innerHTML = '<span class="spinner v-mic-spin"></span>';
        micLbl.textContent = s === 'recognizing' ? 'Распознаю' : 'Думаю…';
        micBtn.setAttribute('aria-label', 'Остановить');
      } else if (s === 'speaking') {
        micIco.innerHTML = I('mic', 'lg');
        micLbl.textContent = 'Перебить';
        micBtn.setAttribute('aria-label', 'Перебить и говорить');
      } else {
        micIco.innerHTML = I('mic', 'lg');
        micLbl.textContent = 'Говорить';
        micBtn.setAttribute('aria-label', 'Говорить');
      }

      if (s === 'listening') {
        leftBtn.classList.add('danger');
        leftBtn.classList.remove('active');
        leftIco.innerHTML = I('x');
        leftLbl.textContent = 'Сбросить';
        leftBtn.setAttribute('aria-label', 'Отменить запись');
      } else {
        leftBtn.classList.remove('danger');
        leftBtn.classList.toggle('active', st.typing);
        leftIco.innerHTML = I('keyboard');
        leftLbl.textContent = st.typing ? 'Скрыть поле' : 'Клавиатура';
        leftBtn.setAttribute('aria-label', 'Текстовый ввод');
      }

      if (s === 'speaking') {
        rightBtn.classList.add('stop-active');
        rightBtn.classList.remove('active');
        rightIco.innerHTML = I('stop');
        rightLbl.textContent = 'Стоп';
        rightBtn.setAttribute('aria-label', 'Остановить озвучивание');
      } else if (st.lastReply && A.voice.ttsSupported) {
        rightBtn.classList.remove('stop-active', 'active');
        rightIco.innerHTML = I('volume');
        rightLbl.textContent = 'Повторить';
        rightBtn.setAttribute('aria-label', 'Озвучить ответ заново');
      } else {
        const auto = !!A.settings.get('voiceAutoplay');
        rightBtn.classList.remove('stop-active');
        rightBtn.classList.toggle('active', auto);
        rightIco.innerHTML = I(auto ? 'volume' : 'x');
        rightLbl.textContent = auto ? 'Озвучка' : 'Без звука';
        rightBtn.setAttribute('aria-label', 'Переключить озвучивание ответов');
      }
    }

    function setState(s, customLabel) {
      st.state = s;
      el.dataset.vstate = s;
      $('[data-state]').textContent = customLabel || LABEL[s] || LABEL.idle;
      $('[data-mode]').textContent = A.api.isDemo()
        ? 'Демо · голос на устройстве'
        : A.voice.cloud.stt ? 'Голосовой режим · облачный голос' : 'Голосовой режим · голос устройства';
      const timerEl = $('[data-timer]');
      if (s !== 'listening') timerEl.classList.add('hidden');
      const replayBtn = $('[data-replay]');
      if (replayBtn) replayBtn.innerHTML = `${I(s === 'speaking' ? 'stop' : 'volume', 'sm')}<span>${s === 'speaking' ? 'Стоп' : 'Озвучить'}</span>`;
      syncDock();
      syncVisibility();
    }

    /* ---------- High-DPI Harmonic Ribbon & Spectrum Visualizer ---------- */
    let raf = 0, t = 1.4;
    function draw() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const cw = canvas.clientWidth || 340, ch = canvas.clientHeight || 68;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, ch);

      t += st.state === 'listening' ? 0.085 : st.state === 'speaking' ? 0.075 : st.state === 'processing' || st.state === 'recognizing' ? 0.095 : 0.028;

      if (st.state === 'listening' && st.recStartedAt) {
        const sec = Math.max(0, Math.floor((Date.now() - st.recStartedAt) / 1000));
        const timerEl = $('[data-timer]');
        timerEl.textContent = `${Math.floor(sec / 60)}:${U.pad(sec % 60)}`;
        timerEl.classList.remove('hidden');
      }

      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const speakWave = 0.56 + 0.24 * Math.sin(t * 2.7) + 0.14 * Math.cos(t * 4.3);
      const procWave = 0.44 + 0.14 * Math.sin(t * 3.2);
      const idleWave = 0.38 + 0.07 * Math.sin(t * 1.4);
      const energy = st.state === 'listening' ? Math.max(0.34, st.level * 1.25)
        : st.state === 'speaking' ? speakWave
          : (st.state === 'processing' || st.state === 'recognizing') ? procWave : idleWave;

      const c1 = st.state === 'listening' ? '#FF5C87' : (dark ? '#9E88FF' : '#7457F5');
      const c2 = st.state === 'listening' ? '#8A5CF6' : (dark ? '#D27BFF' : '#B463FF');
      const c3 = st.state === 'listening' ? '#5EC2FF' : (dark ? '#66D4FF' : '#5EC2FF');

      const grad = g.createLinearGradient(0, 0, cw, 0);
      grad.addColorStop(0, c3);
      grad.addColorStop(0.5, c1);
      grad.addColorStop(1, c2);

      /* Sculpted translucent aurora wave envelope */
      const mid = ch / 2;
      for (let layer = 0; layer < 2; layer++) {
        const phase = t * (layer === 0 ? 1.5 : -1.15) + layer * 1.7;
        const scaleY = (ch * 0.44) * energy * (layer === 0 ? 1 : 0.72);
        g.beginPath();
        g.moveTo(0, mid);
        for (let x = 0; x <= cw; x += 3) {
          const u = x / cw;
          const env = Math.pow(Math.sin(u * Math.PI), 1.65);
          const waveY = (0.62 + 0.38 * Math.sin(u * 10 + phase) * Math.cos(u * 4 - phase * 0.5)) * scaleY * env;
          g.lineTo(x, mid - waveY);
        }
        for (let x = cw; x >= 0; x -= 3) {
          const u = x / cw;
          const env = Math.pow(Math.sin(u * Math.PI), 1.65);
          const waveY = (0.62 + 0.38 * Math.sin(u * 10 + phase + 0.8) * Math.cos(u * 4 - phase * 0.5)) * scaleY * env;
          g.lineTo(x, mid + waveY);
        }
        g.closePath();
        g.fillStyle = grad;
        g.globalAlpha = layer === 0 ? (dark ? 0.22 : 0.16) : (dark ? 0.14 : 0.10);
        g.fill();
      }

      /* Symmetric sculpted audio capsules */
      const bars = 29;
      const padX = cw * 0.07;
      const innerW = cw - padX * 2;
      const step = innerW / bars;
      const bw = Math.max(3.5, step * 0.44);
      g.fillStyle = grad;
      for (let i = 0; i < bars; i++) {
        const dist = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const bell = Math.pow(Math.cos(dist * Math.PI * 0.47), 1.55);
        const wave = 0.56 + 0.28 * Math.sin(i * 0.58 - t * 2.1) + 0.16 * Math.cos(i * 1.05 + t * 1.4);
        const amp = Math.min(0.96, Math.max(0.08, energy * bell * wave));
        const bh = Math.max(4, amp * (ch - 6));
        const x = padX + i * step + (step - bw) / 2;
        const y = (ch - bh) / 2;
        g.globalAlpha = 0.22 + bell * 0.45 + amp * 0.33;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, bw, bh, bw / 2);
        else g.rect(x, y, bw, bh);
        g.fill();
      }
      g.globalAlpha = 1;

      const scale = st.state === 'listening' ? 1 + st.level * 0.2
        : st.state === 'speaking' ? 1 + (speakWave - 0.3) * 0.18 : 1;
      orb.style.transform = `scale(${scale.toFixed(3)})`;
      raf = requestAnimationFrame(draw);
    }
    draw();

    /* ---------- Context & Starters ---------- */
    function renderStarters() {
      const today = new Date();
      const todayTasks = st.refs.tasks.filter(x => x.status === 'overdue' || (x.status === 'active' && x.dueAt && U.isSameDay(x.dueAt, today))).length;
      const todayEvents = st.refs.events.filter(x => U.isSameDay(x.startAt, today)).length;
      const daySub = (todayTasks || todayEvents)
        ? `Сегодня: ${todayTasks + todayEvents} ${U.plural(todayTasks + todayEvents, 'пункт', 'пункта', 'пунктов')}`
        : 'Сводка задач и встреч';
      const starters = [
        { icon: 'calendar', tone: 'c-plan', title: 'Планы на день', sub: daySub, prompt: 'Что у меня на сегодня?' },
        { icon: 'bell', tone: 'c-event', title: 'Напоминание', sub: '«Завтра в 10 позвонить…»', prompt: 'Напомни завтра в 10 позвонить Артёму' },
        { icon: 'users', tone: 'c-person', title: 'Люди и память', sub: 'Запомнить знакомство', prompt: 'Сегодня познакомился с Анной, она дизайнер' },
        { icon: 'wallet', tone: 'c-fact', title: 'Финансы', sub: 'Записать расход голосом', prompt: 'Потратил 1200 на продукты' }
      ];
      const box = $('[data-starter-list]');
      box.innerHTML = starters.map((s, idx) => `
        <button type="button" class="v-starter-card" data-starter="${idx}">
          <span class="ico-tile ${s.tone}">${I(s.icon, 'sm')}</span>
          <span class="v-starter-txt">
            <b>${U.esc(s.title)}</b>
            <small>${U.esc(s.sub)}</small>
          </span>
        </button>`).join('');
      box.querySelectorAll('[data-starter]').forEach(btn => {
        btn.onclick = () => {
          A.voice.unlockAudio();
          process(starters[+btn.dataset.starter].prompt);
        };
      });
    }

    async function loadRefs() {
      const safe = p => p.catch(() => []);
      const [tasks, people, memories, events] = await Promise.all([
        safe(repo.tasks.list()), safe(repo.people.list()), safe(repo.memory.list()), safe(repo.events.list())
      ]);
      if (!el.isConnected) return;
      st.refs = { tasks, people, memories, events };
      if (!st.turns.length && !st.lastYou) renderStarters();
    }
    renderStarters();
    loadRefs();

    /* ---------- Multi-turn History & Cards ---------- */
    function archiveCurrentTurn() {
      if (!st.lastYou && !st.lastReply) return;
      st.turns.push({
        you: st.lastYou,
        msg: st.lastMsg ? JSON.parse(JSON.stringify(st.lastMsg)) : { id: U.uid('vm'), content: st.lastReply, cards: [] }
      });
      st.lastYou = '';
      st.lastReply = '';
      st.lastMsg = null;
      $('[data-you]').textContent = '';
      $('[data-ai]').innerHTML = '';
      $('[data-cards]').innerHTML = '';
      renderHistory();
    }

    function renderHistory() {
      const box = $('[data-history]');
      if (!st.turns.length) { box.innerHTML = ''; return; }
      box.innerHTML = st.turns.map((turn, idx) => `
        <div class="v-hist-turn" data-hti="${idx}">
          ${turn.you ? `<div class="v-hist-you">${I('mic', 'sm')}<span>${U.esc(turn.you)}</span></div>` : ''}
          ${turn.msg && turn.msg.content ? `<div class="v-hist-ai md">${A.markdown.render(turn.msg.content)}</div>` : ''}
          ${turn.msg && (turn.msg.cards || []).length ? `<div class="v-hist-cards">${A.cards.renderList(turn.msg.cards, st.refs)}</div>` : ''}
        </div>`).join('');
      box.querySelectorAll('.v-hist-turn').forEach(node => {
        const turn = st.turns[+node.dataset.hti];
        if (turn && turn.msg) {
          A.cards.bind(node, turn.msg, {
            convId: st.convId,
            source: { kind: 'voice', conversationId: st.convId, messageId: turn.msg.id, excerpt: (turn.you || '').slice(0, 300) },
            onUpdate: async () => { await loadRefs(); renderHistory(); },
            onTaskChange: () => loadRefs()
          });
        }
      });
    }

    function renderCurrentCards() {
      const box = $('[data-cards]');
      if (!st.lastMsg || !(st.lastMsg.cards || []).length) { box.innerHTML = ''; syncVisibility(); return; }
      box.innerHTML = A.cards.renderList(st.lastMsg.cards, st.refs);
      A.cards.bind(box, st.lastMsg, {
        convId: st.convId,
        source: { kind: 'voice', conversationId: st.convId, messageId: st.lastMsg.id, excerpt: (st.lastYou || '').slice(0, 300) },
        onUpdate: async () => { await loadRefs(); renderCurrentCards(); },
        onTaskChange: () => loadRefs()
      });
      syncVisibility();
    }

    function scrollBottom() {
      requestAnimationFrame(() => { mainEl.scrollTo({ top: mainEl.scrollHeight, behavior: 'smooth' }); });
    }

    /* ---------- Recording & Streaming ---------- */
    function stopMeter() {
      if (st.stopMeter) { st.stopMeter(); st.stopMeter = null; }
      st.level = 0;
      st.recStartedAt = 0;
    }

    function cancelListening() {
      if (st.rec) { st.rec.abort(); st.rec = null; }
      stopMeter();
      if (!st.lastYou) $('[data-you]').textContent = '';
      setState('idle');
    }

    async function startListening() {
      if (st.demo) { openComposer(true); return; }
      if (st.state === 'listening') { st.rec && st.rec.stop(); return; }
      if (st.state === 'recognizing' || st.state === 'processing') {
        st.rec && st.rec.abort();
        st.abortStream && st.abortStream.abort();
        stopMeter();
        setState('idle');
        return;
      }
      A.voice.stopSpeaking();
      A.voice.unlockAudio();
      if (st.lastYou || st.lastReply) archiveCurrentTurn();
      $('[data-you]').textContent = 'Говорите…';
      st.recStartedAt = Date.now();
      setState('listening');
      scrollBottom();

      const cloud = A.voice.cloud.stt;
      if (!cloud) st.stopMeter = await A.voice.meter(l => { st.level = st.level * 0.68 + l * 0.32; });
      st.rec = A.voice.listen({
        onPartial: tx => { $('[data-you]').textContent = tx || 'Говорите…'; },
        onLevel: l => { st.level = st.level * 0.68 + l * 0.32; },
        onStage: s => { if (s === 'transcribing') setState('recognizing'); },
        onFinal: tx => { stopMeter(); st.rec = null; process(tx); },
        onError: code => {
          stopMeter(); st.rec = null;
          if (!st.lastYou) $('[data-you]').textContent = '';
          if (code === 'not-allowed') ui.toast('Нет доступа к микрофону. Разрешите его в настройках браузера.', 'error');
          setState(code === 'no-speech' || code === 'aborted' ? 'idle' : 'error');
        },
        onEnd: () => {
          stopMeter(); st.rec = null;
          if (st.state === 'listening' || st.state === 'recognizing') {
            if (!st.lastYou) $('[data-you]').textContent = '';
            setState('idle');
          }
        }
      });
      if (!st.rec) { stopMeter(); $('[data-you]').textContent = ''; setState('error'); }
    }

    async function process(rawText) {
      const text = (rawText || '').trim();
      if (!text) return;
      A.voice.stopSpeaking();
      if (st.lastYou || st.lastReply) archiveCurrentTurn();

      st.lastYou = text;
      st.lastReply = '';
      st.lastMsg = null;
      $('[data-you]').textContent = text;
      $('[data-ai]').innerHTML = '<div class="gen-status"><span class="dots"><i></i><i></i><i></i></span><span data-stream-status>Формирую ответ…</span></div>';
      $('[data-ai-sub]').textContent = '';
      $('[data-cards]').innerHTML = '';
      setState('processing');
      scrollBottom();

      const body = {
        conversationId: st.convId,
        content: text,
        source: 'voice',
        clientMessageId: U.uid('cm'),
        autoSave: !A.settings.get('memoryAskBeforeSave'),
        sensitiveGuard: A.settings.get('sensitiveGuard'),
        style: A.settings.get('responseStyle')
      };

      st.abortStream = new AbortController();
      let acc = '', finalMsg = null;
      try {
        for await (const evt of repo.chat.stream(body, st.abortStream.signal)) {
          if (!el.isConnected) return;
          if (evt.type === 'start') {
            st.convId = evt.conversation.id;
          } else if (evt.type === 'status') {
            setState('processing', evt.text);
            const ss = $('[data-stream-status]');
            if (ss) ss.textContent = evt.text;
          } else if (evt.type === 'delta') {
            acc += evt.text;
            $('[data-ai]').innerHTML = A.markdown.render(acc);
            scrollBottom();
          } else if (evt.type === 'done') {
            finalMsg = evt.message;
          }
        }
        if (!finalMsg && acc) {
          finalMsg = { id: U.uid('vm'), role: 'assistant', content: acc, cards: [] };
        }
        if (finalMsg) {
          st.lastMsg = finalMsg;
          st.lastReply = finalMsg.content || '';
          $('[data-ai]').innerHTML = A.markdown.render(st.lastReply);
          $('[data-ai-sub]').textContent = finalMsg.engine === 'demo' ? 'демо' : finalMsg.engine === 'rules' ? 'быстрый ответ' : '';
          if ((finalMsg.cards || []).some(c => c.status === 'confirmed')) {
            ['memories', 'people'].forEach(k => repo.invalidate(k));
          }
          await loadRefs();
          renderCurrentCards();
          scrollBottom();

          if (A.voice.ttsSupported && A.settings.get('voiceAutoplay') && st.lastReply) {
            setState('speaking');
            const hasPendingCard = (finalMsg.cards || []).some(c => c.status === 'pending');
            A.voice.speak(st.lastReply, {
              onEnd: () => {
                if (!el.isConnected || st.state !== 'speaking') return;
                setState('idle');
                if (A.settings.get('voiceContinuous') && !st.demo && !hasPendingCard) {
                  setTimeout(() => { if (el.isConnected && st.state === 'idle') startListening(); }, 380);
                }
              }
            });
          } else {
            setState('idle');
          }
        } else {
          setState('idle');
        }
      } catch (e) {
        if (e && e.code === 'aborted') { setState('idle'); return; }
        $('[data-ai]').innerHTML = `<p class="danger-text">${U.esc((e && e.userMessage) || 'Не удалось получить ответ')}</p>`;
        setState('idle');
      } finally {
        st.abortStream = null;
      }
    }

    /* ---------- Inline Text Bar & Voice Settings Sheet ---------- */
    const typeForm = $('[data-type-form]');
    const typeTa = typeForm.q;
    function openComposer(show, prefill) {
      st.typing = show;
      typeForm.classList.toggle('hidden', !show);
      if (prefill !== undefined) {
        typeTa.value = prefill;
        typeTa.style.height = 'auto';
        typeTa.style.height = Math.min(typeTa.scrollHeight, 120) + 'px';
      }
      syncDock();
      if (show) setTimeout(() => { typeTa.focus(); typeTa.setSelectionRange(typeTa.value.length, typeTa.value.length); }, 60);
    }

    typeTa.addEventListener('input', () => {
      typeTa.style.height = 'auto';
      typeTa.style.height = Math.min(typeTa.scrollHeight, 120) + 'px';
    });
    typeTa.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
        e.preventDefault();
        typeForm.onsubmit(e);
      }
    });
    typeForm.onsubmit = e => {
      e.preventDefault();
      const v = typeTa.value.trim();
      if (!v) return;
      A.voice.unlockAudio();
      typeTa.value = '';
      typeTa.style.height = 'auto';
      if (!st.demo) openComposer(false);
      process(v);
    };

    function openVoiceSheet() {
      const c = A.voice.cloud;
      const devVoices = A.voice.voices();
      const S = () => A.settings.get();
      ui.sheet({
        title: 'Голос и диалог',
        body: `
          <div class="list">
            <div class="list-item no-icon"><div class="grow"><div class="li-title">Озвучивать ответы</div><div class="li-sub">Читать реплики ${U.esc(assistant)} вслух</div></div>${ui.switchHtml('vAuto', S().voiceAutoplay, 'Озвучивать ответы')}</div>
            <div class="list-item no-icon"><div class="grow"><div class="li-title">Авто-диалог (без рук)</div><div class="li-sub">Слушать следующую фразу сразу после ответа</div></div>${ui.switchHtml('vCont', S().voiceContinuous, 'Авто-диалог')}</div>
          </div>
          <div class="field mt-4"><label>Темп речи</label>
            <div class="segmented" data-vrate>
              ${[[0.8, '0.8× Медленно'], [1, '1× Обычно'], [1.2, '1.2× Быстро']].map(([v, l]) => `<button type="button" data-r="${v}" class="${S().voiceRate === v ? 'active' : ''}">${l}</button>`).join('')}
            </div>
          </div>
          ${c.tts ? `<div class="field"><label>Тембр голоса (облачный)</label>
            <select class="select" name="vCloud"><option value="">По умолчанию (${U.esc(A.voice.VOICE_NAMES[c.defaultVoice] || c.defaultVoice)})</option>
              ${c.voices.map(v => `<option value="${v}" ${S().voiceCloud === v ? 'selected' : ''}>${U.esc(A.voice.VOICE_NAMES[v] || v)}</option>`).join('')}
            </select></div>`
          : devVoices.length ? `<div class="field"><label>Голос устройства</label>
            <select class="select" name="vDev"><option value="">Системный по умолчанию</option>
              ${devVoices.map(v => `<option value="${U.esc(v.name)}" ${S().voiceName === v.name ? 'selected' : ''}>${U.esc(v.name)}</option>`).join('')}
            </select></div>` : ''}
          <button type="button" class="btn btn-secondary btn-block mt-2" data-vtest ${A.voice.ttsSupported ? '' : 'disabled'}>${I('volume', 'sm')}Проверить голос</button>`,
        onMount(body) {
          body.querySelector('[name=vAuto]').onchange = e => { A.settings.set({ voiceAutoplay: e.target.checked }); syncDock(); };
          body.querySelector('[name=vCont]').onchange = e => {
            A.settings.set({ voiceContinuous: e.target.checked });
            $('[data-hf]').classList.toggle('on', e.target.checked);
          };
          body.querySelectorAll('[data-vrate] button').forEach(b => b.onclick = () => {
            const r = parseFloat(b.dataset.r);
            A.settings.set({ voiceRate: r });
            body.querySelectorAll('[data-vrate] button').forEach(x => x.classList.toggle('active', x === b));
          });
          const vc = body.querySelector('[name=vCloud]');
          if (vc) vc.onchange = () => { A.settings.set({ voiceCloud: vc.value }); A.voice.speak(`Привет! Я ${assistant}, теперь звучу так.`); };
          const vd = body.querySelector('[name=vDev]');
          if (vd) vd.onchange = () => { A.settings.set({ voiceName: vd.value }); A.voice.speak(`Привет! Я ${assistant}.`); };
          body.querySelector('[data-vtest]').onclick = () => A.voice.speak(`Привет! Я ${assistant}. Готова помочь с делами, памятью и расписанием.`);
        }
      });
    }

    /* ---------- Wire Interactive Controls ---------- */
    $('[data-mic]').onclick = startListening;
    $('[data-orb]').onclick = () => {
      if (st.state === 'speaking') { A.voice.stopSpeaking(); setState('idle'); if (!st.demo) startListening(); return; }
      startListening();
    };
    $('[data-left-act]').onclick = () => {
      if (st.state === 'listening') { cancelListening(); return; }
      openComposer(!st.typing);
    };
    $('[data-speakstop]').onclick = () => {
      if (st.state === 'speaking') { A.voice.stopSpeaking(); setState('idle'); return; }
      if (st.lastReply && A.voice.ttsSupported) {
        A.voice.unlockAudio();
        setState('speaking');
        A.voice.speak(st.lastReply, { onEnd: () => { if (el.isConnected && st.state === 'speaking') setState('idle'); } });
        return;
      }
      const next = !A.settings.get('voiceAutoplay');
      A.settings.set({ voiceAutoplay: next });
      ui.toast(next ? 'Озвучивание ответов включено' : 'Ответы без озвучки', 'info');
      syncDock();
    };
    $('[data-hf]').onclick = () => {
      const next = !A.settings.get('voiceContinuous');
      A.settings.set({ voiceContinuous: next });
      $('[data-hf]').classList.toggle('on', next);
      ui.toast(next ? 'Авто-диалог включён: слушаю дальше после ответа' : 'Авто-диалог выключен', 'info');
    };
    $('[data-edit-you]').onclick = () => openComposer(true, st.lastYou);
    const replayInline = $('[data-replay]');
    if (replayInline) replayInline.onclick = () => {
      if (st.state === 'speaking') { A.voice.stopSpeaking(); setState('idle'); return; }
      if (!st.lastReply) return;
      A.voice.unlockAudio();
      setState('speaking');
      A.voice.speak(st.lastReply, { onEnd: () => { if (el.isConnected && st.state === 'speaking') setState('idle'); } });
    };
    $('[data-copy-ai]').onclick = async () => {
      if (st.lastReply) ui.toast((await U.copy(st.lastReply)) ? 'Ответ скопирован' : 'Не удалось скопировать', 'success');
    };
    $('[data-voice-settings]').onclick = openVoiceSheet;
    $('[data-voice-opts]').onclick = openVoiceSheet;
    $('[data-close]').onclick = () => A.router.back('#/home');

    setState('idle');
    if (autoStart && !st.demo) {
      setTimeout(() => { if (el.isConnected && st.state === 'idle') startListening(); }, 80);
    }

    ctx.onLeave(() => {
      cancelAnimationFrame(raf);
      stopMeter();
      st.rec && st.rec.abort();
      st.abortStream && st.abortStream.abort();
      A.voice.stopSpeaking();
      if (st.convId) repo.chat.touched();
    });
  }, { fade: true, backTo: '#/home' });
})(window.Adis);
