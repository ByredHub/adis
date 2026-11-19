/* Notifications. Server-side scheduling is the source of truth (notification_schedule → push via APNs/FCM).
 * While the app is open, this client watcher additionally shows due reminders in-app / as system notifications. */
(function (A) {
  'use strict';
  const fired = new Set(A.storage.get('notif.fired', []));
  let timer = null;

  const supported = () => 'Notification' in window;
  const permission = () => (supported() ? Notification.permission : 'unsupported');

  async function request() {
    if (!supported()) return 'unsupported';
    try { return await Notification.requestPermission(); } catch (_) { return Notification.permission; }
  }

  function show(title, body, route) {
    A.ui && A.ui.toast(`${title}: ${body}`, 'info', route ? { label: 'Открыть', onClick: () => { location.hash = route; } } : null, 6000);
    if (A.settings.get('notifications') && permission() === 'granted') {
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: title + body, data: { route } }));
        } else new Notification(title, { body, icon: 'icons/icon-192.png' });
      } catch (e) { A.log.warn('notif', e); }
    }
  }

  async function check() {
    if (!A.repo.auth.user) return;
    let tasks;
    try { tasks = await A.repo.tasks.list(); } catch (_) { return; }
    const now = Date.now();
    tasks.filter(t => !t.done && t.remind && t.dueAt).forEach(t => {
      const due = new Date(t.dueAt).getTime();
      const key = t.id + '@' + t.dueAt;
      if (due <= now && now - due < 10 * 60000 && !fired.has(key)) {
        fired.add(key); A.storage.set('notif.fired', Array.from(fired).slice(-200));
        show('Напоминание', t.title, '#/tasks');
      }
    });
    let events = [];
    try { events = await A.repo.events.list(); } catch (_) { return; }
    events.filter(e => e.remindMinutes).forEach(e => {
      const at = new Date(e.startAt).getTime() - e.remindMinutes * 60000;
      const key = e.id + '@' + e.startAt;
      if (at <= now && now < new Date(e.startAt).getTime() && !fired.has(key)) {
        fired.add(key); A.storage.set('notif.fired', Array.from(fired).slice(-200));
        show('Скоро событие', `${e.title} в ${A.util.fmtTime(e.startAt)}`, '#/calendar');
      }
    });
  }

  A.notifications = {
    supported, permission, request, show,
    start() { if (!timer) { timer = setInterval(check, 30000); setTimeout(check, 4000); } },
    stop() { clearInterval(timer); timer = null; },
    check
  };
})(window.Adis);
