/**
 * storage.js — the only module that touches localStorage.
 * Schema is documented in docs/REQUIREMENTS.md §6.
 */
(function () {
  'use strict';

  const App = window.App;
  const KEY = 'audiobook:v1';

  const defaults = () => ({
    version: 1,
    settings: { speed: 1, autoplay: true, skipBack: 15, skipForward: 30, theme: 'brown' },
    tracks: {},
    lastTrackId: null,
    collapsed: [],
  });

  let state = defaults();
  let firstRun = true;
  let warned = false;
  let locked = false;

  function warn() {
    if (warned) return;
    warned = true;
    App.util.toast('Прогресът не може да бъде запазен в този браузър');
  }

  /** Brings stored data up to the current schema. */
  function migrate(stored) {
    const base = defaults();
    return {
      version: base.version,
      settings: Object.assign(base.settings, stored.settings),
      tracks: stored.tracks && typeof stored.tracks === 'object' ? stored.tracks : {},
      lastTrackId: stored.lastTrackId || null,
      collapsed: Array.isArray(stored.collapsed) ? stored.collapsed : [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        state = migrate(JSON.parse(raw));
        firstRun = false;
      }
    } catch (err) {
      console.warn('storage: cannot read saved data', err);
      warn();
    }
  }

  function save() {
    if (locked) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('storage: cannot write', err);
      warn();
    }
  }

  const getSettings = () => state.settings;
  function setSetting(key, value) {
    state.settings[key] = value;
    save();
    App.emit('settings', { key, value });
  }

  const getTrack = (id) => state.tracks[id] || null;
  function updateTrack(id, patch) {
    state.tracks[id] = Object.assign({}, state.tracks[id], patch, { updatedAt: Date.now() });
    save();
  }

  const lastTrackId = () => state.lastTrackId;
  function setLastTrack(id) {
    state.lastTrackId = id;
    save();
  }

  const isCollapsed = (folder) => state.collapsed.includes(folder);
  function setCollapsed(folder, collapsed) {
    const has = isCollapsed(folder);
    if (collapsed && !has) state.collapsed.push(folder);
    else if (!collapsed && has) state.collapsed = state.collapsed.filter((f) => f !== folder);
    else return;
    save();
  }

  /** Deletes everything and blocks further writes (the page is reloaded afterwards). */
  function reset() {
    locked = true;
    try {
      localStorage.removeItem(KEY);
    } catch (err) {
      console.warn('storage: cannot reset', err);
    }
  }

  App.storage = {
    load, isFirstRun: () => firstRun, getSettings, setSetting, getTrack, updateTrack,
    lastTrackId, setLastTrack, isCollapsed, setCollapsed, reset,
  };
})();
