/* Minimal i18n. Russian is the primary language; English covers navigation and key labels. */
(function (A) {
  'use strict';
  const dict = {
    ru: {
      'nav.home': 'Главная', 'nav.chats': 'Чаты', 'nav.memory': 'Память', 'nav.tasks': 'Задачи', 'nav.profile': 'Профиль',
      'greet.morning': 'Доброе утро', 'greet.day': 'Добрый день', 'greet.evening': 'Добрый вечер', 'greet.night': 'Доброй ночи',
      'home.ask': 'Спросите Adis о чём угодно…', 'home.quick': 'Быстрые действия', 'home.tasks': 'Ближайшие задачи', 'home.for_you': 'Adis предлагает'
    },
    en: {
      'nav.home': 'Home', 'nav.chats': 'Chats', 'nav.memory': 'Memory', 'nav.tasks': 'Tasks', 'nav.profile': 'Profile',
      'greet.morning': 'Good morning', 'greet.day': 'Good afternoon', 'greet.evening': 'Good evening', 'greet.night': 'Good night',
      'home.ask': 'Ask Adis anything…', 'home.quick': 'Quick actions', 'home.tasks': 'Upcoming tasks', 'home.for_you': 'Adis suggests'
    }
  };
  A.LANGUAGES = [
    { code: 'ru', name: 'Русский', native: 'Русский' },
    { code: 'en', name: 'English', native: 'English (интерфейс частично)' }
  ];
  A.t = key => (dict[A.settings.get('language')] || dict.ru)[key] || dict.ru[key] || key;
})(window.Adis);
