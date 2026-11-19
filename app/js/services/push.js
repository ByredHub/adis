/* Web Push subscription for server reminders, event reminders and alarms while Adis is closed.
 * Android (Chrome, Edge, Samsung): works in the browser and in the installed app.
 * iPhone/iPad: iOS 16.4+ and only for the app added to the Home Screen. Requires HTTPS (or localhost). */
(function (A) {
  'use strict';
  const FLAG = 'push.endpoint';

  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function keyBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  async function registration() {
    return Promise.race([navigator.serviceWorker.ready, A.util.sleep(5000).then(() => { throw new A.ApiError('not_supported', 'Служебный модуль приложения не запустился. Обновите страницу.'); })]);
  }

  async function current() {
    if (!supported()) return null;
    try { return await (await registration()).pushManager.getSubscription(); } catch (_) { return null; }
  }

  async function status() {
    if (A.api.isDemo()) return { state: 'demo', text: 'Доступно при подключении к AI Backend' };
    if (!supported()) {
      if (isIOS() && !A.install.isStandalone()) return { state: 'install', text: 'На iPhone: «Поделиться» → «На экран Домой», затем откройте Adis с экрана Домой' };
      return { state: 'unsupported', text: window.isSecureContext ? 'Этот браузер не поддерживает push-уведомления' : 'Нужен защищённый адрес (https://)' };
    }
    if (Notification.permission === 'denied') return { state: 'denied', text: 'Запрещено в настройках браузера' };
    const sub = await current();
    return sub && A.storage.get(FLAG) === sub.endpoint ? { state: 'on', text: 'Включено на этом устройстве' } : { state: 'off', text: 'Выключено' };
  }

  async function enable() {
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') throw new A.ApiError('forbidden', 'Разрешите уведомления в настройках браузера');
    const reg = await registration();
    const { publicKey } = await A.repo.push.key();
    let sub = await reg.pushManager.getSubscription();
    if (sub && A.storage.get('push.key') !== publicKey) { await sub.unsubscribe(); sub = null; }  // server key rotated
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    const json = sub.toJSON();
    await A.repo.push.subscribe({ endpoint: json.endpoint, keys: json.keys });
    A.storage.set(FLAG, json.endpoint); A.storage.set('push.key', publicKey);
    A.settings.set({ notifications: true });
  }

  async function disable() {
    const sub = await current();
    if (sub) {
      try { await A.repo.push.unsubscribe(sub.endpoint); } catch (e) { A.log.warn('push', e.code); }
      await sub.unsubscribe().catch(() => {});
    }
    A.storage.remove(FLAG);
  }

  /* On logout: detach this device from the account, so the next user doesn't get someone else's reminders */
  async function forget() {
    if (A.api.isDemo() || !A.storage.get(FLAG)) return;
    const sub = await current();
    if (sub) { try { await A.repo.push.unsubscribe(sub.endpoint); } catch (_) { /* offline: server drops it later */ } }
  }

  /* After login: re-attach the existing subscription to the signed-in account */
  async function resume() {
    if (A.api.isDemo() || !A.storage.get(FLAG) || !supported() || Notification.permission !== 'granted') return;
    try { await enable(); } catch (e) { A.log.warn('push', 'resume', e.code || e.message); }
  }

  A.push = { supported, status, enable, disable, forget, resume, test: () => A.repo.push.test() };
})(window.Adis);
