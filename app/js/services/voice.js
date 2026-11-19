/* Voice service: pluggable STT/TTS providers behind one interface.
 * - "cloud": AI Backend (OpenAI speech models). The app records with MediaRecorder, the server transcribes / synthesises.
 *   Works the same on iPhone, Android and desktop, understands names from memory and writes numbers as digits.
 * - "device": Web Speech API (browser recognition + speechSynthesis). Fallback in demo mode or without the server.
 * If no provider is available, the UI says so instead of pretending it works. */
(function (A) {
  'use strict';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const MR = window.MediaRecorder;
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const VOICE_NAMES = {
    coral: 'Корал — тёплый женский',
    nova: 'Нова — живой женский',
    shimmer: 'Шиммер — мягкий женский',
    sage: 'Сейдж — спокойный',
    alloy: 'Эллой — нейтральный',
    ash: 'Эш — мужской',
    ballad: 'Баллад — мужской, мягкий',
    echo: 'Эхо — мужской',
    fable: 'Фейбл — выразительный',
    onyx: 'Оникс — низкий мужской',
    verse: 'Верс — универсальный'
  };
  const cloud = { available: false, voices: [], defaultVoice: 'coral', checked: false };
  let player = null, speakSeq = 0;

  const micSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const recorderSupported = micSupported && !!MR;
  const lang = () => (A.settings.get('language') === 'en' ? 'en' : 'ru');
  const pref = () => A.settings.get('voiceProvider') || 'auto';
  const useCloudStt = () => cloud.available && recorderSupported && pref() !== 'device';
  const useCloudTts = () => cloud.available && pref() !== 'device';

  function audioEl() {
    if (!player) { player = new Audio(); player.preload = 'auto'; player.setAttribute('playsinline', ''); }
    return player;
  }

  function pickMime() {
    if (!MR || !MR.isTypeSupported) return '';
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MR.isTypeSupported(t)) || '';
  }

  function clean(text) {
    return String(text).replace(/```[\s\S]*?```/g, ' Код показан на экране. ').replace(/[*_#>`]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/^- /gm, '');
  }

  /* ---------- device provider ---------- */
  function deviceListen({ onPartial, onFinal, onError, onEnd }) {
    if (!SR) { onError && onError('unsupported'); return null; }
    const rec = new SR();
    rec.lang = lang() === 'en' ? 'en-US' : 'ru-RU';
    rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = '', aborted = false;
    rec.onresult = e => {
      if (aborted) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      onPartial && onPartial((finalText + ' ' + interim).trim());
    };
    rec.onerror = e => { if (!aborted) onError && onError(e.error || 'error'); };
    rec.onend = () => {
      if (!aborted && finalText.trim()) onFinal && onFinal(finalText.trim());
      else if (aborted) onError && onError('aborted');
      onEnd && onEnd();
    };
    try { rec.start(); } catch (e) { onError && onError('busy'); return null; }
    return {
      cloud: false,
      stop: () => { try { rec.stop(); } catch (_) { /* */ } },
      abort: () => { aborted = true; try { rec.abort(); } catch (_) { /* */ } }
    };
  }

  function deviceSpeak(text, onEnd) {
    if (!synth) { onEnd && onEnd(); return false; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean(text).slice(0, 1200));
    u.lang = lang() === 'en' ? 'en-US' : 'ru-RU';
    u.rate = A.settings.get('voiceRate') || 1;
    const pick = voice.voices().find(v => v.name === A.settings.get('voiceName')) || voice.voices()[0];
    if (pick) u.voice = pick;
    u.onend = () => onEnd && onEnd();
    u.onerror = () => onEnd && onEnd();
    synth.speak(u);
    return true;
  }

  /* ---------- cloud provider ---------- */
  /* Records until the user stops or ~1.9 s of silence after speech, then sends the audio to /voice/transcribe */
  function cloudListen({ onPartial, onFinal, onError, onEnd, onLevel, onStage, silenceMs }) {
    const pauseLimit = silenceMs || 1900;
    const ctl = {
      cloud: true,
      stopped: false,
      aborted: false,
      rec: null,
      stop() { ctl.stopped = true; if (ctl.rec && ctl.rec.state !== 'inactive') ctl.rec.stop(); },
      abort() { ctl.aborted = true; ctl.stop(); }
    };
    let ended = false;
    const end = () => { if (!ended) { ended = true; onEnd && onEnd(); } };
    (async () => {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch (_) { onError && onError('not-allowed'); end(); return; }
      if (ctl.aborted) { stream.getTracks().forEach(t => t.stop()); end(); return; }
      const mime = pickMime();
      const rec = mime ? new MR(stream, { mimeType: mime }) : new MR(stream);
      ctl.rec = rec;
      const chunks = [];
      let heard = false, quietSince = 0, raf = 0, ctx = null;
      const started = Date.now();
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ctx = new Ctx();
        const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const data = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(data);
          let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
          onLevel && onLevel(level);
          const now = Date.now();
          if (level > 0.085) { heard = true; quietSince = 0; } else if (heard && !quietSince) quietSince = now;
          if ((heard && quietSince && now - quietSince > pauseLimit) || now - started > 55000 || (!heard && now - started > 10000)) { ctl.stop(); return; }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (_) { heard = true; /* no analyser: rely on the stop button */ }
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); if (ctx) ctx.close().catch(() => {});
        onLevel && onLevel(0);
        if (ctl.aborted) { onError && onError('aborted'); end(); return; }
        const type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!heard || blob.size < 1200) { onError && onError('no-speech'); end(); return; }
        onStage && onStage('transcribing'); onPartial && onPartial('…');
        try {
          const r = await A.api.request(A.API.voice.transcribe, { query: { lang: lang() }, body: blob, raw: true, contentType: type, timeout: 60000 });
          if (ctl.aborted) { onError && onError('aborted'); end(); return; }
          if (r.text) onFinal && onFinal(r.text); else onError && onError('no-speech');
        } catch (e) { onError && onError(e.code === 'network' ? 'network' : 'server', e); }
        end();
      };
      rec.start(250);
      if (ctl.stopped) rec.stop();
    })();
    return ctl;
  }

  async function cloudSpeak(text, onEnd) {
    const seq = ++speakSeq;
    const el = audioEl();
    try {
      const blob = await A.api.request(A.API.voice.speak, { body: { text, voice: A.settings.get('voiceCloud') || cloud.defaultVoice, speed: A.settings.get('voiceRate') || 1 }, responseType: 'blob', timeout: 60000, dedupe: false });
      if (seq !== speakSeq) return;  // stopped or superseded while loading
      const url = URL.createObjectURL(blob);
      el.onended = el.onerror = () => { URL.revokeObjectURL(url); if (seq === speakSeq) onEnd && onEnd(); };
      el.src = url;
      await el.play();
    } catch (e) {
      if (seq !== speakSeq) return;
      A.log.warn('voice', 'cloud tts failed, using device', e && (e.code || e.name));
      if (!deviceSpeak(text, onEnd)) onEnd && onEnd();
    }
  }

  const voice = {
    VOICE_NAMES,
    micSupported,
    get sttSupported() { return useCloudStt() || !!SR; },
    get ttsSupported() { return useCloudTts() || !!synth; },
    get cloud() { return Object.assign({}, cloud, { stt: useCloudStt(), tts: useCloudTts() }); },

    /* Ask the server whether cloud voice is configured (called after login / mode change) */
    async refreshCloud() {
      cloud.available = false;
      if (A.api.isDemo() || !A.repo.auth.user) { cloud.checked = true; return cloud; }
      try {
        const s = await A.api.request(A.API.voice.status);
        Object.assign(cloud, { available: !!s.enabled, voices: s.voices || [], defaultVoice: s.defaultVoice || 'coral' });
      } catch (_) { /* offline: device voice */ }
      cloud.checked = true;
      A.bus.emit('voice:providers');
      return cloud;
    },

    /* iOS/Safari only let audio play inside a user gesture: call this from the tap that starts a voice turn */
    unlockAudio() {
      if (!useCloudTts()) return;
      const el = audioEl();
      try { el.src = SILENT_WAV; const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* */ }
    },

    async micPermission() {
      try {
        if (navigator.permissions && navigator.permissions.query) return (await navigator.permissions.query({ name: 'microphone' })).state;
      } catch (_) { /* Safari */ }
      return 'prompt';
    },

    async requestMic() {
      if (!micSupported) return 'unsupported';
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return 'granted'; } catch (_) { return 'denied'; }
    },

    /* Returns a controller: { stop(), abort(), cloud }. Callbacks: onPartial(text), onFinal(text), onError(code), onEnd(),
     * cloud only: onLevel(0..1) for the waveform, onStage('transcribing') */
    listen(opts) { return useCloudStt() ? cloudListen(opts) : deviceListen(opts); },

    voices() {
      if (!synth) return [];
      return synth.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(lang()));
    },

    speak(text, { onEnd } = {}) {
      voice.stopSpeaking();
      if (useCloudTts()) { voice.unlockAudio(); cloudSpeak(text, onEnd); return true; }
      return deviceSpeak(text, onEnd);
    },
    stopSpeaking() {
      speakSeq++;
      if (player) { try { player.pause(); } catch (_) { /* */ } }
      if (synth) synth.cancel();
    },
    get speaking() { return !!((player && !player.paused && !player.ended && player.src !== SILENT_WAV) || (synth && synth.speaking)); },

    /* Microphone level stream for waveform visualisation (device provider; cloud recording reports levels itself) */
    async meter(onLevel) {
      if (!micSupported) return null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser(); an.fftSize = 256;
        src.connect(an);
        const data = new Uint8Array(an.frequencyBinCount);
        let raf;
        const tick = () => { an.getByteTimeDomainData(data); let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; } onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4)); raf = requestAnimationFrame(tick); };
        tick();
        return () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ctx.close(); };
      } catch (_) { return null; }
    }
  };

  if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = () => A.bus.emit('voice:voices');
  A.bus.on('auth:changed', () => voice.refreshCloud());
  A.bus.on('settings:changed', p => { if ('apiMode' in p || 'apiBaseUrl' in p) voice.refreshCloud(); });
  A.voice = voice;
})(window.Adis);
