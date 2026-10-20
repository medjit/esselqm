/**
 * player.js — wraps the single <audio> element: loading/resuming tracks,
 * progress persistence, "listened" detection, speed, sleep timer and
 * Media Session (lock-screen) integration.
 *
 * Emits on App.bus: track-change, track-meta, state, progress, listened, sleep-tick.
 */
(function () {
  'use strict';

  const App = window.App;
  const { storage, library, util } = App;

  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const LISTENED_RATIO = 0.95;
  const RESUME_REWIND = 3; // seconds of context when resuming
  const FADE_SECONDS = 10;

  let audio = null;
  let current = null;
  let pendingStart = null; // seconds to seek to once metadata is loaded
  let autoMarkDone = false; // listened check already happened for this load
  let sleepMode = null; // null | 'timer' | 'end'
  let sleepEnd = 0;
  let sleepInterval = null;

  const isPlaying = () => !!audio && !audio.paused;
  const position = () => (audio ? audio.currentTime : 0);
  const duration = () => {
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return current ? library.duration(current) : 0;
  };

  function init() {
    audio = document.getElementById('audio');
    audio.preload = 'metadata';
    applySpeed();

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', emitState);
    audio.addEventListener('playing', () => { if (current) App.history.start(current, audio.currentTime); });
    audio.addEventListener('pause', () => {
      saveProgress();
      if (current) App.history.stop(current, audio.currentTime);
      emitState();
    });
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    setupMediaSession();
  }

  /**
   * Loads a track.
   * @param {object} track
   * @param {{startAt?: number, autoplay?: boolean}} [opts] startAt defaults to the saved position.
   */
  function open(track, opts = {}) {
    saveProgress();
    if (current) App.history.stop(current, position());
    clearSleepIfEnded();

    current = track;
    autoMarkDone = false;

    let startAt = opts.startAt;
    if (startAt == null) {
      const saved = storage.getTrack(track.id);
      startAt = !saved || saved.listened ? 0 : Math.max(0, (saved.pos || 0) - RESUME_REWIND);
    }
    pendingStart = startAt;

    audio.src = track.src;
    applySpeed();
    storage.setLastTrack(track.id);
    updateMediaMetadata();

    App.emit('track-change', { track });
    App.emit('progress', { pos: startAt, dur: library.duration(track) });
    emitState();

    if (opts.autoplay) play();
  }

  function play() {
    if (!current) return;
    const result = audio.play();
    if (result && result.catch) {
      // Load failures are reported by the 'error' event. An autoplay block
      // (no user tap yet) is reported so the UI can ask the listener to press play.
      result.catch((err) => {
        if (err && err.name === 'NotAllowedError') App.emit('autoplay-blocked', { track: current });
        else console.debug('play() rejected:', err && err.name);
      });
    }
  }

  function pause() {
    if (audio) audio.pause();
  }

  function toggle() {
    if (!current) return;
    if (audio.paused) play();
    else pause();
  }

  function seek(t) {
    if (!current) return;
    const max = duration() || Infinity;
    const target = Math.min(Math.max(0, t), max);
    const restartSession = isPlaying() && pendingStart === null;
    if (restartSession) App.history.stop(current, audio.currentTime);
    if (pendingStart !== null) pendingStart = target; // metadata not ready yet
    else audio.currentTime = target;
    if (restartSession) App.history.start(current, target);
    App.emit('progress', { pos: target, dur: duration() });
  }

  const skip = (delta) => seek(position() + delta);

  function playNext() {
    const next = current && library.next(current.id);
    if (next) open(next, { autoplay: true });
  }

  function playPrev() {
    if (!current) return;
    const prev = library.prev(current.id);
    if (position() > 3 || !prev) seek(0);
    else open(prev, { autoplay: true });
  }

  /** Manual (or automatic) listened flag. */
  function setListened(track, listened) {
    storage.updateTrack(track.id, listened ? { listened: true } : { listened: false });
    if (current && current.id === track.id) autoMarkDone = true;
    App.emit('listened', { track, listened });
  }

  /* ---------- speed ---------- */

  function applySpeed() {
    const speed = storage.getSettings().speed;
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
  }

  function setSpeed(speed) {
    storage.setSetting('speed', speed);
    applySpeed();
  }

  function cycleSpeed() {
    const i = SPEEDS.indexOf(storage.getSettings().speed);
    setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }

  /* ---------- persistence ---------- */

  /** Writes the current position. Safe to call at any time. */
  function saveProgress() {
    if (!current || pendingStart !== null || audio.ended) return;
    const patch = { pos: audio.currentTime };
    if (Number.isFinite(audio.duration)) patch.dur = audio.duration;
    storage.updateTrack(current.id, patch);
    if (!audio.paused) App.history.update(current, audio.currentTime);
  }
  const saveProgressThrottled = util.throttle(saveProgress, 5000);

  /* ---------- audio events ---------- */

  function onMetadata() {
    if (!current) return;
    storage.updateTrack(current.id, { dur: audio.duration });
    if (pendingStart !== null) {
      if (pendingStart > 0 && pendingStart < audio.duration) audio.currentTime = pendingStart;
      pendingStart = null;
    }
    App.emit('track-meta', { track: current });
    App.emit('progress', { pos: audio.currentTime, dur: audio.duration });
    updatePositionState();
  }

  const updatePositionStateThrottled = util.throttle(updatePositionState, 1000);

  function onTimeUpdate() {
    if (!current || pendingStart !== null) return;
    const pos = audio.currentTime;
    const dur = duration();
    App.emit('progress', { pos, dur });
    saveProgressThrottled();
    updatePositionStateThrottled();

    if (!autoMarkDone && !audio.paused && dur > 0 && pos / dur >= LISTENED_RATIO) {
      autoMarkDone = true;
      const saved = storage.getTrack(current.id);
      if (!saved || !saved.listened) setListened(current, true);
      App.history.markDone(current);
    }
  }

  function onEnded() {
    if (!current) return;
    storage.updateTrack(current.id, { listened: true, pos: 0 });
    autoMarkDone = true;
    App.emit('listened', { track: current, listened: true });
    App.history.markDone(current);
    emitState();

    if (sleepMode === 'end') {
      clearSleep();
      return;
    }
    if (storage.getSettings().autoplay) playNext();
  }

  function onError() {
    if (!current || !audio.getAttribute('src')) return;
    util.toast('Файлът не може да бъде зареден');
    App.history.stop(current, position());
    pendingStart = null;
    emitState();
  }

  function emitState() {
    App.emit('state', { playing: isPlaying() });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying() ? 'playing' : 'paused';
    }
  }

  /* ---------- sleep timer ---------- */

  /** @param {number|'end'|null} value minutes, 'end' of track, or null to cancel */
  function setSleep(value) {
    clearSleep();
    if (value === 'end') {
      sleepMode = 'end';
      App.emit('sleep-tick', { mode: 'end', remaining: null });
    } else if (Number(value) > 0) {
      sleepMode = 'timer';
      sleepEnd = Date.now() + Number(value) * 60000;
      sleepInterval = setInterval(sleepTick, 1000);
      sleepTick();
    }
  }

  function sleepTick() {
    const remaining = Math.max(0, Math.ceil((sleepEnd - Date.now()) / 1000));
    App.emit('sleep-tick', { mode: 'timer', remaining });
    if (remaining <= FADE_SECONDS) {
      try { audio.volume = remaining / FADE_SECONDS; } catch (err) { /* iOS ignores volume */ }
    }
    if (remaining <= 0) {
      pause();
      clearSleep();
    }
  }

  function clearSleep() {
    clearInterval(sleepInterval);
    sleepInterval = null;
    const wasActive = sleepMode !== null;
    sleepMode = null;
    try { audio.volume = 1; } catch (err) { /* ignore */ }
    if (wasActive) App.emit('sleep-tick', { mode: null, remaining: null });
  }

  /** 'end of track' timers only apply to the track they were set on. */
  function clearSleepIfEnded() {
    if (sleepMode === 'end') clearSleep();
  }

  /* ---------- Media Session ---------- */

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const set = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch (err) { /* unsupported */ }
    };
    set('play', play);
    set('pause', pause);
    set('seekbackward', () => skip(-storage.getSettings().skipBack));
    set('seekforward', () => skip(storage.getSettings().skipForward));
    set('previoustrack', playPrev);
    set('nexttrack', playNext);
    set('seekto', (d) => seek(d.seekTime));
  }

  function updateMediaMetadata() {
    if (!('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.author,
      album: 'Аудиокниги',
    });
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, dur),
      });
    } catch (err) { /* ignore invalid state */ }
  }

  App.player = {
    init, open, play, pause, toggle, seek, skip, playNext, playPrev, setListened,
    setSpeed, cycleSpeed, setSleep, saveProgress, isPlaying, position, duration,
    speeds: SPEEDS,
    get current() { return current; },
  };
})();
