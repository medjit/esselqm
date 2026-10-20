/**
 * captions.js — full-screen timed text (the "Текст" button).
 *
 * Loads the track's subtitles (.vtt or .srt; one word per cue works best),
 * groups the words into short phrases and follows the audio: the current
 * phrase is shown, the spoken word highlighted. Two layouts:
 *   focus — one big phrase at a time, like captions on a short video;
 *   full  — the whole text, scrolling with the audio.
 * Tapping a word (or a line) jumps there.
 *
 * The listener can shift the text against the audio (settings.captionShift,
 * seconds, the same for every recording). Browsers seek inaccurately in VBR
 * MP3s, so after a jump the text can be a few seconds off.
 */
(function () {
  'use strict';

  const App = window.App;
  const { player, storage, util } = App;
  const { el } = util;

  const $ = (id) => document.getElementById(id);

  /* ---------- phrase grouping ---------- */
  const SENTENCE_END = /[.!?…؟]["'»”)\]]*$/;
  const SOFT_END = /[,;:—–]["'»”)\]]*$/;
  const SOFT_CHARS = 45; // after this many characters, break at a comma
  const MAX_CHARS = 80; // never longer than this
  const PAUSE_BREAK = 1.2; // seconds of silence that end a phrase of at least PAUSE_MIN_CHARS
  const PAUSE_MIN_CHARS = 20;
  const LONG_PAUSE = 2.5; // seconds of silence that always end a phrase
  const WORD_HOLD = 0.6; // a word stays highlighted this long after it ends

  const FOLLOW_PAUSE_MS = 5000; // after the listener scrolls, stop following for this long
  const SHIFT_STEP = 1; // seconds per tap on the shift buttons
  const SHIFT_MAX = 30;

  let cues = []; // { start, end, text, phrase, node }
  let phrases = []; // { start, first, last, node }
  let loadedId = null;
  let loadToken = 0;
  let isOpen = false;
  let frame = 0;
  let activeCue = -2;
  let activePhrase = -2;
  let followPausedUntil = 0;
  let lastFocus = null;

  /* =========================================================
     PARSING
     ========================================================= */

  const STAMP = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

  function toSeconds(stamp) {
    const m = STAMP.exec(stamp);
    if (!m) return null;
    return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
  }

  function decode(text) {
    return text
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /** WebVTT or SRT text → cues sorted by start time. */
  function parseCues(text) {
    const out = [];
    text.replace(/\r/g, '').split(/\n{2,}/).forEach((block) => {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => l.includes('-->'));
      if (at < 0) return;
      const [from, to] = lines[at].split('-->');
      const start = toSeconds(from);
      const end = toSeconds(to || '');
      const words = decode(lines.slice(at + 1).join(' ')).replace(/\s+/g, ' ').trim();
      if (start == null || !words) return;
      out.push({ start, end: end == null ? start : Math.max(start, end), text: words });
    });
    return out.sort((a, b) => a.start - b.start);
  }

  /** Splits the cues into phrases at sentence ends, long pauses and length limits. */
  function groupPhrases(list) {
    const out = [];
    let current = null;
    let chars = 0;
    list.forEach((cue, i) => {
      if (!current) {
        current = { start: cue.start, first: i, last: i, node: null };
        out.push(current);
        chars = 0;
      }
      current.last = i;
      chars += cue.text.length + 1;
      cue.phrase = out.length - 1;

      const next = list[i + 1];
      if (!next
        || SENTENCE_END.test(cue.text)
        || chars >= MAX_CHARS
        || (chars >= SOFT_CHARS && SOFT_END.test(cue.text))
        || next.start - cue.end >= LONG_PAUSE
        || (next.start - cue.end >= PAUSE_BREAK && chars >= PAUSE_MIN_CHARS)) {
        current = null;
      }
    });
    return out;
  }

  /* =========================================================
     LOADING + RENDERING
     ========================================================= */

  function note(text) {
    cues = [];
    phrases = [];
    const box = $('cc-lines');
    box.textContent = '';
    box.append(el('p', { class: 'cc-note', text }));
  }

  function load(track) {
    const token = ++loadToken;
    loadedId = track ? track.id : null;
    activeCue = -2;
    activePhrase = -2;

    if (!track || !track.subSrc) {
      note('Няма текст за този запис.');
      return;
    }
    if (window.location.protocol === 'file:') {
      note('Текстът е достъпен само когато страницата се отваря през уеб сървър.');
      return;
    }
    note('Зареждане…');
    fetch(track.subSrc)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then((text) => {
        if (token !== loadToken) return;
        cues = parseCues(text);
        if (!cues.length) {
          note('Файлът с текста е празен.');
          return;
        }
        phrases = groupPhrases(cues);
        render();
        sync(true);
      })
      .catch(() => { if (token === loadToken) note('Текстът не може да бъде зареден.'); });
  }

  function render() {
    const box = $('cc-lines');
    box.textContent = '';
    const fragment = document.createDocumentFragment();
    phrases.forEach((phrase, p) => {
      const line = el('p', { class: 'cc-line', dir: 'auto', 'data-p': p });
      for (let i = phrase.first; i <= phrase.last; i++) {
        if (i > phrase.first) line.append(' ');
        const word = el('span', { class: 'cc-w', 'data-i': i, text: cues[i].text });
        cues[i].node = word;
        line.append(word);
      }
      phrase.node = line;
      fragment.append(line);
    });
    box.append(fragment);
  }

  /* =========================================================
     FOLLOWING THE AUDIO
     ========================================================= */

  /** Index of the last cue that has started at `t`, or -1. */
  function cueAt(t) {
    let lo = 0;
    let hi = cues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }

  /** Seconds the text is moved ahead of the audio (negative: behind). */
  const shift = () => Number(storage.getSettings().captionShift) || 0;

  function sync(jump) {
    const dur = player.duration();
    $('cc-progress').style.width = dur ? `${Math.min(100, (player.position() / dur) * 100)}%` : '0';
    if (!cues.length) return;

    const pos = player.position() + shift();

    const last = cueAt(pos);
    const phrase = last < 0 ? 0 : cues[last].phrase;
    const nextStart = cues[last + 1] ? cues[last + 1].start : Infinity;
    const spoken = last >= 0 && pos < Math.min(nextStart, cues[last].end + WORD_HOLD) ? last : -1;

    if (phrase !== activePhrase || jump) setPhrase(phrase, jump);
    if (spoken !== activeCue || jump) setWord(spoken, last);
  }

  function setPhrase(p, jump) {
    const classes = ['is-active', 'is-prev', 'is-next'];
    $('cc-lines').querySelectorAll('.is-active, .is-prev, .is-next').forEach((n) => n.classList.remove(...classes));
    activePhrase = p;
    if (phrases[p - 1]) phrases[p - 1].node.classList.add('is-prev');
    if (phrases[p + 1]) phrases[p + 1].node.classList.add('is-next');
    const line = phrases[p] && phrases[p].node;
    if (!line) return;
    line.classList.add('is-active');
    if (jump || Date.now() > followPausedUntil) scrollTo(line, jump);
  }

  /** Highlights the spoken word and marks the words before it in the current phrase. */
  function setWord(spoken, last) {
    if (cues[activeCue]) cues[activeCue].node.classList.remove('is-on');
    activeCue = spoken;
    const phrase = phrases[activePhrase];
    if (!phrase) return;
    for (let i = phrase.first; i <= phrase.last; i++) {
      cues[i].node.classList.toggle('is-said', i <= last && i !== spoken);
    }
    if (cues[spoken]) cues[spoken].node.classList.add('is-on');
  }

  function scrollTo(line, jump) {
    if (isFocusMode()) return;
    line.scrollIntoView({ block: 'center', behavior: jump ? 'auto' : 'smooth' });
    $('cc-follow').hidden = true;
  }

  function tick() {
    if (!isOpen) return;
    if (!document.hidden) sync(false);
    if (followPausedUntil && Date.now() > followPausedUntil) {
      followPausedUntil = 0;
      const line = phrases[activePhrase] && phrases[activePhrase].node;
      if (line) scrollTo(line, false);
    }
    frame = requestAnimationFrame(tick);
  }

  /** The listener scrolled by hand: leave the text where it is for a while. */
  function pauseFollow() {
    if (isFocusMode() || !cues.length) return;
    followPausedUntil = Date.now() + FOLLOW_PAUSE_MS;
    $('cc-follow').hidden = false;
  }

  function resumeFollow() {
    followPausedUntil = 0;
    const line = phrases[activePhrase] && phrases[activePhrase].node;
    if (line) scrollTo(line, false);
  }

  /**
   * Resolves with true if the track has subtitles. When db/dataset.js does not name
   * the file, "<name>.vtt" and then "<name>.srt" are tried once (the result is kept).
   */
  function available(track) {
    if (!track) return Promise.resolve(false);
    if (track.subSrc) return Promise.resolve(true);
    if (!track.subGuess.length || window.location.protocol === 'file:') return Promise.resolve(false);
    if (!track.subProbe) {
      track.subProbe = track.subGuess.reduce((found, url) => found.then((hit) => hit || fetch(url, { method: 'HEAD' })
        .then((res) => (res.ok ? url : null))
        .catch(() => null)), Promise.resolve(null))
        .then((url) => {
          if (url) track.subSrc = url;
          return !!url;
        });
    }
    return track.subProbe;
  }

  /* =========================================================
     OPEN / CLOSE + CONTROLS
     ========================================================= */

  const isFocusMode = () => storage.getSettings().captionMode !== 'full';

  function renderMode() {
    const focus = isFocusMode();
    $('cc').classList.toggle('focus', focus);
    $('cc-mode').textContent = focus ? 'Целия текст' : 'Изречение';
    $('cc-mode').setAttribute('aria-label', focus ? 'Покажи целия текст' : 'Покажи само текущото изречение');
  }

  function renderTrack(track) {
    $('cc-title').textContent = track ? track.title : '';
    $('cc-author').textContent = track ? track.author : '';
  }

  function renderPlay() {
    const playing = player.isPlaying();
    $('cc-play-use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    $('cc-play').setAttribute('aria-label', playing ? 'Пауза' : 'Пусни');
  }

  function renderShift() {
    const value = shift();
    const text = value ? `${value > 0 ? '+' : '−'}${Math.abs(value)} с` : '0 с';
    $('cc-shift-value').textContent = text;
    $('cc-shift-value').disabled = !value;
    $('cc-shift-value').title = value ? 'Нулирай изместването' : '';
  }

  function changeShift(delta) {
    const next = Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, delta === 0 ? 0 : shift() + delta));
    storage.setSetting('captionShift', next);
    renderShift();
    sync(true);
  }

  function renderSkips() {
    const s = storage.getSettings();
    $('cc-lbl-back').textContent = s.skipBack;
    $('cc-lbl-fwd').textContent = s.skipForward;
  }

  function open() {
    const track = player.current;
    if (!track) return;
    lastFocus = document.activeElement;
    isOpen = true;
    renderMode();
    renderTrack(track);
    renderPlay();
    renderSkips();
    renderShift();
    $('cc-follow').hidden = true;
    followPausedUntil = 0;
    $('cc').hidden = false;
    requestAnimationFrame(() => {
      $('cc').classList.add('open');
      $('cc-close').focus();
    });

    if (loadedId !== track.id) load(track);
    else sync(true);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    cancelAnimationFrame(frame);
    $('cc').classList.remove('open');
    setTimeout(() => { if (!isOpen) $('cc').hidden = true; }, 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /** Jumps so that the text at `seconds` is the one being heard. */
  function seekTo(seconds) {
    player.seek(Math.max(0, seconds - shift()));
    if (!player.isPlaying()) player.play();
    followPausedUntil = 0;
    $('cc-follow').hidden = true;
    sync(true);
  }

  function init() {
    $('cc-close').addEventListener('click', close);
    $('cc-play').addEventListener('click', player.toggle);
    $('cc-back').addEventListener('click', () => player.skip(-storage.getSettings().skipBack));
    $('cc-fwd').addEventListener('click', () => player.skip(storage.getSettings().skipForward));
    $('cc-mode').addEventListener('click', () => {
      storage.setSetting('captionMode', isFocusMode() ? 'full' : 'focus');
      renderMode();
      followPausedUntil = 0;
      $('cc-follow').hidden = true;
      sync(true);
    });
    $('cc-follow').addEventListener('click', resumeFollow);
    $('cc-shift-minus').addEventListener('click', () => changeShift(-SHIFT_STEP));
    $('cc-shift-plus').addEventListener('click', () => changeShift(SHIFT_STEP));
    $('cc-shift-value').addEventListener('click', () => changeShift(0));

    $('cc-lines').addEventListener('click', (e) => {
      const word = e.target.closest('.cc-w');
      const line = e.target.closest('.cc-line');
      if (word) seekTo(cues[Number(word.dataset.i)].start);
      else if (line) seekTo(phrases[Number(line.dataset.p)].start);
    });

    const scroller = $('cc-scroll');
    scroller.addEventListener('wheel', pauseFollow, { passive: true });
    scroller.addEventListener('touchmove', pauseFollow, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (isOpen && e.key === 'Escape') close();
    });

    App.on('track-change', ({ track }) => {
      if (!isOpen) return;
      renderTrack(track);
      load(track);
    });
    App.on('state', () => { if (isOpen) renderPlay(); });
    App.on('settings', ({ key }) => { if (key === 'skipBack' || key === 'skipForward') renderSkips(); });
  }

  App.captions = { init, open, close, available, parseCues, groupPhrases };
})();
