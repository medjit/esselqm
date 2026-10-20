/**
 * theme.js — color themes. The colors themselves live in assets/css/style.css
 * as `[data-theme="<id>"]` blocks; this module lists them and switches them.
 * The first theme is the default.
 */
(function () {
  'use strict';

  const App = window.App;

  const THEMES = [
    { id: 'brown', name: 'Кафява' },
    { id: 'dark', name: 'Тъмна' },
    { id: 'light', name: 'Светла' },
    { id: 'orange', name: 'Оранжева' },
    { id: 'peach', name: 'Праскова' },
    { id: 'green', name: 'Зелена' },
    { id: 'mint', name: 'Мента' },
    { id: 'blue', name: 'Синя' },
    { id: 'sky', name: 'Небесна' },
    { id: 'slate', name: 'Сиво-синя' },
    { id: 'purple', name: 'Лилава' },
    { id: 'sepia', name: 'Сепия' },
    { id: 'contrast', name: 'Висок контраст' },
  ];
  const DEFAULT = THEMES[0].id;

  const isKnown = (id) => THEMES.some((t) => t.id === id);

  /** The saved theme, or the default when nothing valid is saved. */
  function current() {
    const id = App.storage.getSettings().theme;
    return isKnown(id) ? id : DEFAULT;
  }

  /** Applies a theme to the page (and the mobile browser bar color). */
  function apply(id) {
    const theme = isKnown(id) ? id : DEFAULT;
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
    return theme;
  }

  /** Applies and remembers a theme. */
  function set(id) {
    App.storage.setSetting('theme', apply(id));
  }

  App.theme = { list: THEMES, current, apply, set };
})();
