/* Welcome, registration, login, password recovery. */
(function (A) {
  'use strict';
  const { ui, icon: I, util: U, repo } = A;
  const DEMO = { email: 'demo@adis.app', password: 'adis-demo-2026' };

  async function afterAuth() {
    A.router.go(A.settings.get('onboarded') ? '#/home' : '#/onboarding', { replace: true });
  }

  A.router.register('/welcome', el => {
    el.innerHTML = `<main class="content welcome">
      <div class="welcome-hero">
        <div class="orb xl pulse"></div>
        <h1 class="t-display mt-6">Adis</h1>
        <p class="welcome-tag">Личный ИИ-помощник, который помнит главное о твоей жизни</p>
      </div>
      <div class="welcome-points">
        <div class="wp">${I('memory')}<span><b>Долговременная память</b>Люди, события, факты и планы — в одном месте</span></div>
        <div class="wp">${I('mic')}<span><b>Голос и текст</b>Говори как с человеком: «Напомни завтра в 10…»</span></div>
        <div class="wp">${I('sparkles')}<span><b>Сам подсказывает</b>Напоминает о важном и не надоедает</span></div>
      </div>
      <div class="col mt-6">
        <button class="btn btn-primary btn-block" data-demo>${I('play', 'sm')}Демо для презентации</button>
        <a class="btn btn-outline btn-block" href="#/register">Создать аккаунт</a>
        <a class="btn btn-ghost btn-block" href="#/login">У меня уже есть аккаунт</a>
      </div>
      <p class="tiny faint text-center mt-4">Демо-режим: данные хранятся только на этом устройстве.</p>
    </main>`;
    el.querySelector('[data-demo]').onclick = e => ui.guard(e.currentTarget, async () => {
      await repo.auth.login(DEMO.email, DEMO.password, { demo: true });
      A.settings.set({ onboarded: true });
      ui.toast('Вы вошли в демо-аккаунт', 'success');
      A.router.go('#/home', { replace: true });
    });
  }, { public: true, guestOnly: true, fade: true });

  function authForm(el, { mode }) {
    const isReg = mode === 'register';
    el.innerHTML = `${ui.appbar({ back: true })}
      <main class="content">
        <div class="auth-head"><div class="orb"></div><h1 class="t-h1 mt-4">${isReg ? 'Создание аккаунта' : 'Вход в Adis'}</h1>
        <p class="muted mt-2">${isReg ? 'Пара шагов — и Adis начнёт помогать.' : 'С возвращением! Adis помнит, на чём вы остановились.'}</p></div>
        <form class="mt-6" novalidate>
          ${isReg ? `<div class="field"><label for="f-name">Как вас зовут</label><input class="input" id="f-name" name="name" autocomplete="given-name" placeholder="Имя" autofocus></div>` : ''}
          <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" ${isReg ? '' : 'autofocus'}></div>
          <div class="field"><label for="f-pass">Пароль</label>
            <div class="input-wrap"><input class="input" id="f-pass" name="password" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}" placeholder="${isReg ? 'Минимум 8 символов' : 'Пароль'}">
            <button type="button" class="icon-btn" data-toggle-pass aria-label="Показать пароль">${I('eye', 'sm')}</button></div>
          </div>
          ${isReg ? `<p class="tiny faint mb-4">Регистрируясь, вы соглашаетесь с условиями использования и политикой конфиденциальности. Чувствительные данные Adis не сохраняет без вашего подтверждения.</p>`
        : `<div class="row between mb-4"><label class="row gap-2 small"><input type="checkbox" name="remember" checked> Запомнить меня</label><a class="link-btn" href="#/forgot">Забыли пароль?</a></div>`}
          <button class="btn btn-primary btn-block" type="submit">${isReg ? 'Создать аккаунт' : 'Войти'}</button>
        </form>
        <p class="text-center small muted mt-6">${isReg ? 'Уже есть аккаунт? <a href="#/login" class="bold">Войти</a>' : 'Нет аккаунта? <a href="#/register" class="bold">Зарегистрироваться</a>'}</p>
      </main>`;
    const form = el.querySelector('form');
    el.querySelector('[data-toggle-pass]').onclick = () => { const p = form.password; p.type = p.type === 'password' ? 'text' : 'password'; };
    form.onsubmit = e => {
      e.preventDefault();
      const v = ui.formData(form);
      if (isReg && (!v.name || v.name.length < 2)) return ui.fieldError(form, 'name', 'Введите имя');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return ui.fieldError(form, 'email', 'Введите корректный email');
      if (isReg && v.password.length < 8) return ui.fieldError(form, 'password', 'Минимум 8 символов');
      if (!v.password) return ui.fieldError(form, 'password', 'Введите пароль');
      ui.guard(form.querySelector('[type=submit]'), async () => {
        if (isReg) await repo.auth.register(v.name, v.email, v.password);
        else await repo.auth.login(v.email, v.password, { remember: v.remember });
        await afterAuth();
      });
    };
  }

  A.router.register('/login', el => authForm(el, { mode: 'login' }), { public: true, guestOnly: true, backTo: '#/welcome' });
  A.router.register('/register', el => authForm(el, { mode: 'register' }), { public: true, guestOnly: true, backTo: '#/welcome' });

  A.router.register('/forgot', el => {
    el.innerHTML = `${ui.appbar({ back: true })}
      <main class="content">
        <div class="auth-head"><div class="ico-tile" style="width:56px;height:56px;border-radius:18px">${I('lock')}</div>
        <h1 class="t-h1 mt-4">Восстановление пароля</h1><p class="muted mt-2">Укажите email — мы отправим ссылку для сброса пароля.</p></div>
        <form class="mt-6" novalidate>
          <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" autofocus></div>
          <button class="btn btn-primary btn-block" type="submit">Отправить ссылку</button>
        </form>
        <div class="sent hidden mt-6"></div>
      </main>`;
    const form = el.querySelector('form');
    form.onsubmit = e => {
      e.preventDefault();
      const { email } = ui.formData(form);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ui.fieldError(form, 'email', 'Введите корректный email');
      ui.guard(form.querySelector('[type=submit]'), async () => {
        const r = await repo.auth.forgot(email);
        form.classList.add('hidden');
        const sent = el.querySelector('.sent'); sent.classList.remove('hidden');
        sent.innerHTML = `<div class="card tinted"><div class="row">${I('check')}<b>Если аккаунт существует, письмо отправлено на ${U.esc(email)}</b></div>${r && r.demoNote ? `<p class="small muted mt-2">${U.esc(r.demoNote)}</p>` : ''}</div><a class="btn btn-outline btn-block mt-4" href="#/login">Вернуться ко входу</a>`;
      });
    };
  }, { public: true, guestOnly: true, backTo: '#/login' });

  // Link from the password-reset email: #/reset?token=...
  A.router.register('/reset', (el, ctx) => {
    const token = ctx.query.token || '';
    el.innerHTML = `${ui.appbar({ back: true })}
      <main class="content">
        <div class="auth-head"><div class="ico-tile" style="width:56px;height:56px;border-radius:18px">${I('lock')}</div>
        <h1 class="t-h1 mt-4">Новый пароль</h1><p class="muted mt-2">Придумайте новый пароль. После сохранения все устройства выйдут из аккаунта.</p></div>
        ${token ? `<form class="mt-6" novalidate>
          <div class="field"><label for="f-pass">Новый пароль</label><input class="input" id="f-pass" name="password" type="password" autocomplete="new-password" placeholder="Минимум 8 символов" autofocus></div>
          <div class="field"><label for="f-pass2">Повторите пароль</label><input class="input" id="f-pass2" name="password2" type="password" autocomplete="new-password"></div>
          <button class="btn btn-primary btn-block" type="submit">Сохранить пароль</button>
        </form>` : `<div class="card tinted mt-6"><b>Ссылка неполная</b><p class="small muted mt-2">Откройте ссылку из письма целиком или запросите восстановление ещё раз.</p></div>
          <a class="btn btn-outline btn-block mt-4" href="#/forgot">Восстановить пароль</a>`}
        <div class="sent hidden mt-6"></div>
      </main>`;
    const form = el.querySelector('form');
    if (!form) return;
    form.onsubmit = e => {
      e.preventDefault();
      const v = ui.formData(form);
      if ((v.password || '').length < 8) return ui.fieldError(form, 'password', 'Минимум 8 символов');
      if (v.password !== v.password2) return ui.fieldError(form, 'password2', 'Пароли не совпадают');
      ui.guard(form.querySelector('[type=submit]'), async () => {
        await repo.auth.resetPassword(token, v.password);
        if (repo.auth.user) await repo.auth.clearLocal(); // the server signed out every session
        form.classList.add('hidden');
        const sent = el.querySelector('.sent'); sent.classList.remove('hidden');
        sent.innerHTML = `<div class="card tinted"><div class="row">${I('check')}<b>Пароль изменён</b></div><p class="small muted mt-2">Войдите с новым паролем.</p></div><a class="btn btn-primary btn-block mt-4" href="#/login">Войти</a>`;
      });
    };
  }, { public: true, backTo: '#/login' });
})(window.Adis);
