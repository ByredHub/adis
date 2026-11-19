/* Camera: full-screen viewfinder (getUserMedia) with front/back switch, torch, gallery and preview.
 * Falls back to the native camera picker (<input capture>) when live camera is unavailable (http, no permission, desktop without camera).
 * A.camera.capture({ facing, title }) → Promise<{ dataUrl, width, height, size, name, type } | null> */
(function (A) {
  'use strict';
  const { icon: I, util: U } = A;
  const MAX_SIDE = 1024, QUALITY = 0.78;

  const liveSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);

  function drawToDataUrl(source, sw, sh, mirror) {
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    const g = c.getContext('2d');
    if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(source, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', QUALITY);
    return { dataUrl, width: c.width, height: c.height, size: Math.round(dataUrl.length * 0.75), type: 'image/jpeg', name: `Фото ${U.fmtDate(new Date())} ${U.fmtTime(new Date())}.jpg` };
  }

  /* Image file → compressed JPEG data URL */
  function fromFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Это не изображение')); return; }
      const img = new Image();
      img.onload = () => { const r = drawToDataUrl(img, img.naturalWidth, img.naturalHeight, false); URL.revokeObjectURL(img.src); r.name = file.name; resolve(r); };
      img.onerror = () => reject(new Error('Не удалось открыть изображение'));
      img.src = URL.createObjectURL(file);
    });
  }

  function pickFile({ facing = 'environment', camera = true } = {}) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      if (camera) inp.setAttribute('capture', facing === 'user' ? 'user' : 'environment');
      inp.style.display = 'none';
      document.body.appendChild(inp);
      let done = false;
      const finish = v => { if (done) return; done = true; inp.remove(); resolve(v); };
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return finish(null);
        try { finish(await fromFile(f)); } catch (e) { A.ui.toast(e.message, 'error'); finish(null); }
      };
      window.addEventListener('focus', () => setTimeout(() => { if (!inp.files.length) finish(null); }, 1200), { once: true });
      inp.click();
    });
  }

  function capture({ facing = 'environment', title = '' } = {}) {
    /* Must stay synchronous until input.click() so the browser treats it as a user gesture */
    if (!liveSupported()) return pickFile({ facing });

    return new Promise(resolve => {
      const root = document.getElementById('overlay-root');
      const el = document.createElement('div');
      el.className = 'cam';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Камера');
      el.innerHTML = `
        <video class="cam-video" playsinline muted autoplay></video>
        <img class="cam-shot hidden" alt="Снимок">
        <div class="cam-msg hidden"></div>
        <header class="cam-top">
          <button class="cam-ic" data-close aria-label="Закрыть">${I('x')}</button>
          <span class="cam-title">${U.esc(title)}</span>
          <button class="cam-ic hidden" data-torch aria-label="Вспышка">${I('zap')}</button>
        </header>
        <footer class="cam-bottom">
          <div class="cam-row" data-live>
            <button class="cam-ic" data-gallery aria-label="Выбрать из галереи">${I('image')}</button>
            <button class="cam-shutter" data-shoot aria-label="Сделать снимок"><span></span></button>
            <button class="cam-ic" data-flip aria-label="Сменить камеру">${I('repeat')}</button>
          </div>
          <div class="cam-row hidden" data-review>
            <button class="cam-pill" data-retake>Переснять</button>
            <button class="cam-pill main" data-use>${I('check', 'sm')}Готово</button>
          </div>
        </footer>`;
      root.appendChild(el);

      const video = el.querySelector('video'), shotImg = el.querySelector('.cam-shot'), msg = el.querySelector('.cam-msg');
      const live = el.querySelector('[data-live]'), review = el.querySelector('[data-review]'), torchBtn = el.querySelector('[data-torch]');
      let stream = null, current = facing, result = null, torchOn = false, closed = false;

      function stop() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
      function close(v) {
        if (closed) return; closed = true;
        stop(); el.classList.add('closing');
        window.removeEventListener('hashchange', onHash);
        setTimeout(() => el.remove(), 220);
        resolve(v);
      }
      const onHash = () => close(null);
      window.addEventListener('hashchange', onHash);

      function showError(text) {
        msg.classList.remove('hidden');
        msg.innerHTML = `${I('camera', 'lg')}<b>Камера недоступна</b><span>${U.esc(text)}</span><button class="cam-pill main" data-pick>${I('image', 'sm')}Открыть камеру телефона или галерею</button>`;
        msg.querySelector('[data-pick]').onclick = async () => { const r = await pickFile({ facing: current }); if (r) close(r); };
        el.querySelector('[data-shoot]').disabled = true;
      }

      async function start() {
        stop();
        msg.classList.add('hidden');
        el.querySelector('[data-shoot]').disabled = false;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: current }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
          if (closed) { stop(); return; }
          video.srcObject = stream;
          video.classList.toggle('mirror', current === 'user');
          await video.play().catch(() => {});
          const track = stream.getVideoTracks()[0];
          const caps = track && track.getCapabilities ? track.getCapabilities() : {};
          torchBtn.classList.toggle('hidden', !caps.torch);
          torchOn = false; torchBtn.classList.remove('on');
        } catch (e) {
          A.log.warn('camera', e.name);
          showError(e.name === 'NotAllowedError' ? 'Доступ к камере запрещён. Разрешите его в настройках браузера.' : e.name === 'NotFoundError' ? 'На устройстве не найдена камера.' : 'Не удалось включить камеру.');
        }
      }

      el.querySelector('[data-close]').onclick = () => close(null);
      el.querySelector('[data-flip]').onclick = () => { current = current === 'user' ? 'environment' : 'user'; start(); };
      torchBtn.onclick = async () => {
        const track = stream && stream.getVideoTracks()[0];
        if (!track) return;
        torchOn = !torchOn;
        try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); torchBtn.classList.toggle('on', torchOn); } catch (_) { torchOn = false; }
      };
      el.querySelector('[data-gallery]').onclick = async () => { const r = await pickFile({ camera: false }); if (r) close(r); };
      el.querySelector('[data-shoot]').onclick = () => {
        if (!video.videoWidth) return;
        result = drawToDataUrl(video, video.videoWidth, video.videoHeight, current === 'user');
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 260);
        shotImg.src = result.dataUrl; shotImg.classList.remove('hidden');
        video.classList.add('hidden'); live.classList.add('hidden'); review.classList.remove('hidden');
        stop();
      };
      el.querySelector('[data-retake]').onclick = () => {
        result = null; shotImg.classList.add('hidden'); video.classList.remove('hidden');
        review.classList.add('hidden'); live.classList.remove('hidden'); start();
      };
      el.querySelector('[data-use]').onclick = () => close(result);
      el.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });

      start();
    });
  }

  A.camera = { capture, pickFile, fromFile, liveSupported };
})(window.Adis);
