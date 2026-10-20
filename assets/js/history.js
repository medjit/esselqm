/**
 * history.js — listening history. A "session" is one continuous stretch of
 * playback of one recording: when it started/ended (wall clock) and which
 * part of the recording was played. Kept under its own localStorage key so
 * it never interferes with progress data.
 *
 * The open session is written every few seconds (via player.saveProgress),
 * so it survives the browser being closed abruptly.
 *
 * Emits: history-change
 */
(function () {
  'use strict';

  const App = window.App;
  const KEY = 'audiobook:history:v1';
  const MAX_ENTRIES = 1000;
  const MIN_SESSION_MS = 5000; // shorter sessions (quick taps, skips) are not kept
  const DONE_WINDOW_MS = 60000;

  /** @type {Array<{id: string, s: number, e: number, from: number, to: number, done: boolean}>} */
  let entries = [];
  let open = null; // the session being recorded

  const valid = (x) => x && typeof x.id === 'string' && Number.isFinite(x.s) && Number.isFinite(x.e);
  const sec = (pos) => Math.max(0, Math.round(Number(pos) || 0));

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && Array.isArray(raw.entries)) {
        entries = raw.entries.filter(valid).map((x) => ({
          id: x.id, s: x.s, e: Math.max(x.s, x.e), from: sec(x.from), to: sec(x.to), done: x.done === true,
        }));
      }
    } catch (err) {
      console.warn('history: cannot read saved history', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, entries }));
    } catch (err) {
      console.warn('history: cannot write', err);
    }
  }

  function finishOpen(pos) {
    open.e = Date.now();
    open.to = sec(pos);
    if (open.e - open.s < MIN_SESSION_MS && !open.done) entries.splice(entries.indexOf(open), 1);
    open = null;
  }

  /** Playback of `track` began at `pos` seconds. */
  function start(track, pos) {
    if (open && open.id === track.id) return;
    if (open) finishOpen(open.to);
    const now = Date.now();
    open = { id: track.id, s: now, e: now, from: sec(pos), to: sec(pos), done: false };
    entries.push(open);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    save();
    App.emit('history-change');
  }

  /** Still playing `track`, now at `pos`. */
  function update(track, pos) {
    if (!open || open.id !== track.id) return;
    open.e = Date.now();
    open.to = sec(pos);
    save();
  }

  /** Playback of `track` stopped at `pos`. */
  function stop(track, pos) {
    if (!open || open.id !== track.id) return;
    finishOpen(pos);
    save();
    App.emit('history-change');
  }

  /** `track` was finished: flag the running (or just finished) session. */
  function markDone(track) {
    let target = open && open.id === track.id ? open : null;
    if (!target) {
      const last = entries[entries.length - 1];
      if (last && last.id === track.id && Date.now() - last.e < DONE_WINDOW_MS) target = last;
    }
    if (!target || target.done) return;
    target.done = true;
    save();
    App.emit('history-change');
  }

  function clear() {
    entries = [];
    open = null;
    save();
    App.emit('history-change');
  }

  App.history = {
    load, start, update, stop, markDone, clear,
    list: () => entries.map((x) => ({ ...x })),
  };
})();
