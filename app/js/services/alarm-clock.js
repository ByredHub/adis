/* Alarm clock while Adis is open: full-screen ringing with sound and vibration, snooze / turn off.
 * When the app is closed the server worker sends a push notification instead (see services/push.js).
 * A PWA cannot ring through silent mode or wake a locked phone like the system clock app. */
(function (A) {
  'use strict';
  const { util: U, icon: I } = A;
  let alarms = [], timer = null, refreshTimer = null, ringingId = null, audio = null, beepTimer = null, vibeTimer = null;
  const handled = new Set();  // ring keys already dismissed locally (avoid re-ringing before the server answers)

  /* Browsers allow sound only after a user gesture: unlock the audio context on the first tap */
  function unlockAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audio) audio = new Ctx();
      if (audio.state === 'suspended') audio.resume();
    } catch (_) { /* no audio */ }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(e => window.addEventListener(e, unlockAudio, { passive: true }));

  function beep() {
    if (!audio || audio.state !== 'running') return;
    const t0 = audio.currentTime;
    [0, 0.25, 0.5].forEach(dt => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.18);
      o.connect(g).connect(audio.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.2);
    });
  }

  function ringKey(a) { return a.id + '@' + (a.ringAt || a.nextAt); }

  function dueNow(a) {
    if (handled.has(ringKey(a))) return false;
    if (a.ringing) return true;
    if (!a.enabled || !a.nextAt) return false;
    const d = Date.now() - new Date(a.nextAt).getTime();
    return d >= 0 && d < 10 * 60000;
  }

  function stop() {
    clearInterval(beepTimer); clearInterval(vibeTimer); beepTimer = vibeTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
    const el = document.getElementById('alarm-ring'); if (el) el.remove();
    ringingId = null;
  }

  function ring(a) {
    if (ringingId === a.id) return;
    stop();
    ringingId = a.id;
    const root = document.getElementById('overlay-root') || document.body;
    const el = document.createElement('div');
    el.id = 'alarm-ring'; el.className = 'alarm-ring'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', 'Будильник');
    el.innerHTML = `<div class="alarm-ring-inner">
        <div class="orb xl pulse"></div>
        <div class="alarm-ring-time">${U.esc(a.time)}</div>
        <div class="alarm-ring-label">${U.esc(a.label || 'Будильник')}</div>
        ${audio && audio.state === 'running' ? '' : `<button class="btn btn-ghost btn-sm" data-sound>${I('volume', 'sm')}Включить звук</button>`}
        <div class="alarm-ring-btns">
          <button class="btn btn-secondary btn-block" data-snooze>${I('clock', 'sm')}Отложить на 10 минут</button>
          <button class="btn btn-primary btn-block" data-off>${I('check', 'sm')}Выключить</button>
        </div>
      </div>`;
    root.appendChild(el);
    const key = ringKey(a);
    const finish = async (fn, msg) => {
      handled.add(key); stop();
      try { await fn(); A.ui.toast(msg, 'success'); } catch (e) { A.ui.toast(e.userMessage || 'Не удалось', 'error'); }
      refresh();
    };
    el.querySelector('[data-off]').onclick = () => finish(() => A.repo.alarms.dismiss(a.id), 'Будильник выключен');
    el.querySelector('[data-snooze]').onclick = () => finish(() => A.repo.alarms.snooze(a.id, 10), 'Отложено на 10 минут');
    const snd = el.querySelector('[data-sound]'); if (snd) snd.onclick = () => { unlockAudio(); beep(); snd.remove(); };
    beep(); beepTimer = setInterval(beep, 1200);
    if (navigator.vibrate) { navigator.vibrate([600, 300, 600]); vibeTimer = setInterval(() => navigator.vibrate([600, 300, 600]), 2000); }
    if (document.hidden) A.notifications.show(`Будильник ${a.time}`, a.label || 'Пора вставать!', '#/alarms');
    setTimeout(() => { if (ringingId === a.id) { handled.add(key); stop(); } }, 10 * 60000);  // stop by itself after 10 minutes
  }

  function check() {
    if (ringingId) return;
    const a = alarms.find(dueNow);
    if (a) ring(a);
  }

  async function refresh() {
    if (!A.repo.auth.user) return;
    try { alarms = await A.repo.alarms.list(true); } catch (_) { return; }
    check();
  }

  A.alarmClock = {
    start() {
      if (timer) return;
      refresh();
      timer = setInterval(check, 5000);
      refreshTimer = setInterval(refresh, 60000);
    },
    stop() { clearInterval(timer); clearInterval(refreshTimer); timer = refreshTimer = null; stop(); alarms = []; },
    refresh, ring,
    get ringingId() { return ringingId; }
  };

  A.bus.on('data:alarms', () => setTimeout(refresh, 50));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})(window.Adis);
