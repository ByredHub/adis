/* User/app settings: theme, font size, language, timezone, voice, memory, privacy, API mode. */
(function (A) {
  'use strict';
  const DEFAULTS = {
    theme: 'light',            // light | dark | system
    fontScale: 1,              // 0.9 .. 1.4
    contrast: 'normal',        // normal | high
    language: 'ru',
    timezone: A.util.timezone(),
    onboarded: false,
    notifications: true,
    proactiveFrequency: 'normal', // off | rare | normal
    voiceAutoplay: true,
    voiceContinuous: false,     // hands-free: auto-listen after assistant finishes speaking
    voiceRate: 1,
    voiceName: '',              // device voice
    voiceProvider: 'auto',      // auto (cloud when the server has it) | cloud | device
    voiceCloud: '',             // cloud voice name, '' = server default
    memoryAskBeforeSave: true,
    memorySuggest: true,
    sensitiveGuard: true,
    apiMode: 'demo',           // demo | server
    apiBaseUrl: '',
    apiModeChosen: false,       // true once the user picked a mode manually (disables auto-connect)
    simulateNetworkErrors: false,
    simulateSlowNetwork: false
  };

  let state = Object.assign({}, DEFAULTS, A.storage.get('settings', {}));
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function apply() {
    const root = document.documentElement;
    const dark = state.theme === 'dark' || (state.theme === 'system' && media && media.matches);
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.body && document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.setAttribute('data-contrast', state.contrast);
    root.style.setProperty('--font-scale', state.fontScale);
    root.lang = state.language;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0E0D14' : '#F7F6FB');
  }

  if (media && media.addEventListener) media.addEventListener('change', () => state.theme === 'system' && apply());

  A.settings = {
    DEFAULTS,
    get: k => (k ? state[k] : Object.assign({}, state)),
    set(patch) {
      state = Object.assign({}, state, patch);
      A.storage.set('settings', state);
      apply();
      A.bus.emit('settings:changed', patch);
    },
    reset() { state = Object.assign({}, DEFAULTS); A.storage.set('settings', state); apply(); },
    apply
  };
})(window.Adis);
