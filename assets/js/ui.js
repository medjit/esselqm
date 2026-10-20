/**
 * ui.js — builds the DOM, wires user input to the player and reacts to
 * player events. All catalog text is inserted via textContent (see util.el).
 */
(function () {
  'use strict';

  const App = window.App;
  const { storage, library, player, router, util } = App;
  const { el, icon, formatTime, formatSize, normalize, toast } = util;

  const $ = (id) => document.getElementById(id);

  /** track id → { row, status, len, q } */
  const rows = new Map();
  /** folder name → { section, header, count, folder } */
  const folderEls = new Map();

  let seeking = false;
  let lastRowRefresh = 0;
  let activeSheet = null;
  let lastFocus = null;
  let transcriptToken = 0;
  let infoToken = 0;

  /* =========================================================
     INIT
     ========================================================= */

  function init() {
    if (storage.isFirstRun()) library.folders.forEach((f) => storage.setCollapsed(f.name, true));

    buildLibrary();
    buildThemePicker();
    bindPlayerControls();
    bindSettings();
    bindHistory();
    bindSheets();
    bindSearch();
    bindKeyboard();
    bindBus();
    App.captions.init();

    renderSettings();
    renderHeader(null);
    refreshContinue();
  }

  /* =========================================================
     LIBRARY
     ========================================================= */

  function buildLibrary() {
    const root = $('playlist');
    root.textContent = '';

    library.folders.forEach((folder) => {
      const content = el('div', { class: 'folder-content' });
      const count = el('span', { class: 'folder-count' });
      const header = el(
        'button',
        { class: 'folder-header', type: 'button' },
        el('span', { class: 'folder-name', text: folder.title }),
        count,
        icon('chev')
      );
      const section = el('div', { class: 'folder' }, header, content);

      folder.tracks.forEach((track) => content.append(buildRow(track)));

      header.addEventListener('click', () => {
        setFolderCollapsed(folder.name, !section.classList.contains('collapsed'));
      });

      folderEls.set(folder.name, { section, header, count, folder });
      root.append(section);

      applyCollapsed(folder.name, storage.isCollapsed(folder.name));
      refreshFolderCount(folder);
    });

    library.tracks.forEach(refreshRow);
  }

  function buildRow(track) {
    const status = el('span', { class: 'row-status' });
    const len = el('span');
    const size = el('span', { text: formatSize(track.sizeKb) });

    const hit = el(
      'button',
      { class: 'row-hit', type: 'button', onclick: () => playTrack(track) },
      el('span', { class: 'row-lead' }, el('span', { class: 'row-num', text: track.number }), status),
      el('span', { class: 'row-title', text: track.title }),
      el('span', { class: 'row-meta' }, len, size)
    );
    const more = el(
      'button',
      { class: 'icon-btn row-more', type: 'button', 'aria-label': `Действия: ${track.title}`, onclick: () => openActions(track) },
      icon('more')
    );
    const row = el('div', { class: 'row' }, hit, more);

    rows.set(track.id, { row, status, len, q: normalize(`${track.title} ${track.author}`) });
    return row;
  }

  /** Updates status icon / percent / duration of one row. */
  function refreshRow(track) {
    const entry = rows.get(track.id);
    if (!entry) return;
    const saved = storage.getTrack(track.id);
    const dur = library.duration(track);

    entry.status.textContent = '';
    entry.status.removeAttribute('title');
    if (saved && saved.listened) {
      entry.status.append(icon('check'));
      entry.status.title = 'Изслушан';
    } else if (saved && saved.pos > 5 && dur > 0) {
      entry.status.textContent = `${Math.min(99, Math.round((saved.pos / dur) * 100))}%`;
    }
    entry.row.classList.toggle('is-listened', !!(saved && saved.listened));
    entry.len.textContent = dur ? formatTime(dur) : '';
  }

  function refreshFolderCount(folder) {
    const done = folder.tracks.filter((t) => (storage.getTrack(t.id) || {}).listened).length;
    folderEls.get(folder.name).count.textContent = `${done}/${folder.tracks.length}`;
  }

  function applyCollapsed(name, collapsed) {
    const f = folderEls.get(name);
    f.section.classList.toggle('collapsed', collapsed);
    f.header.setAttribute('aria-expanded', String(!collapsed));
  }

  function setFolderCollapsed(name, collapsed) {
    storage.setCollapsed(name, collapsed);
    applyCollapsed(name, collapsed);
  }

  function setActiveRow(track) {
    rows.forEach((entry) => entry.row.classList.remove('active'));
    const entry = rows.get(track.id);
    if (!entry) return;
    entry.row.classList.add('active');
    if (storage.isCollapsed(track.folder.name)) setFolderCollapsed(track.folder.name, false);
    entry.row.scrollIntoView({ block: 'nearest' });
  }

  function playTrack(track) {
    const cur = player.current;
    if (cur && cur.id === track.id) player.toggle();
    else player.open(track, { autoplay: true });
  }

  /* =========================================================
     SEARCH
     ========================================================= */

  function bindSearch() {
    const input = $('search');
    input.addEventListener('input', util.debounce(() => {
      const q = normalize(input.value.trim());
      let total = 0;
      folderEls.forEach(({ section, folder }) => {
        let matches = 0;
        folder.tracks.forEach((t) => {
          const entry = rows.get(t.id);
          const hit = !q || entry.q.includes(q);
          entry.row.hidden = !hit;
          if (hit) matches++;
        });
        section.hidden = matches === 0;
        section.classList.toggle('searching', !!q);
        total += matches;
      });
      $('no-results').hidden = total > 0;
    }, 120));
  }

  /* =========================================================
     PLAYER HEADER + CONTROLS
     ========================================================= */

  function renderHeader(track) {
    $('np-title').textContent = track ? track.title : 'Изберете запис';
    $('np-author').textContent = track ? track.author : '—';
    document.title = track ? `${track.title} — Аудиокниги` : 'Аудиокниги';
    ['btn-details', 'btn-share', 'btn-download'].forEach((id) => { $(id).disabled = !track; });
    const captions = $('btn-captions');
    captions.disabled = true;
    captions.title = '';
    App.captions.available(track).then((has) => {
      if (player.current !== track) return;
      captions.disabled = !has;
      captions.title = track && !has ? 'Няма текст за този запис' : '';
    });
    $('seek').disabled = !track;
  }

  function renderPlayState(playing) {
    if (playing) $('btn-play').classList.remove('attention');
    $('play-use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    $('btn-play').setAttribute('aria-label', playing ? 'Пауза' : 'Пусни');
    $('cover').classList.toggle('playing', playing);
  }

  function renderProgress(pos, dur) {
    $('t-cur').textContent = formatTime(pos);
    $('t-dur').textContent = dur ? formatTime(dur) : '--:--';
    if (!seeking) setSeekValue(dur ? (pos / dur) * 1000 : 0);
  }

  function setSeekValue(value) {
    const seek = $('seek');
    seek.value = value;
    seek.style.setProperty('--p', `${value / 10}%`);
  }

  function renderSettings() {
    const s = storage.getSettings();
    $('btn-speed').textContent = `${s.speed}×`;
    $('lbl-back').textContent = s.skipBack;
    $('lbl-fwd').textContent = s.skipForward;
    $('btn-back').setAttribute('aria-label', `Назад ${s.skipBack} секунди`);
    $('btn-fwd').setAttribute('aria-label', `Напред ${s.skipForward} секунди`);
    $('set-autoplay').checked = s.autoplay;
    $('set-back').value = String(s.skipBack);
    $('set-fwd').value = String(s.skipForward);
    renderThemePicker();
  }

  function bindPlayerControls() {
    $('btn-play').addEventListener('click', () => {
      if (player.current) player.toggle();
      else if (library.tracks.length) player.open(library.tracks[0], { autoplay: true });
    });
    $('btn-back').addEventListener('click', () => player.skip(-storage.getSettings().skipBack));
    $('btn-fwd').addEventListener('click', () => player.skip(storage.getSettings().skipForward));
    $('btn-prev').addEventListener('click', player.playPrev);
    $('btn-next').addEventListener('click', player.playNext);
    $('btn-speed').addEventListener('click', player.cycleSpeed);
    $('btn-settings').addEventListener('click', () => openSheet('sheet-settings'));
    $('btn-sleep').addEventListener('click', () => openSheet('sheet-settings'));

    const seek = $('seek');
    seek.addEventListener('input', () => {
      seeking = true;
      const dur = player.duration();
      const pos = (seek.value / 1000) * dur;
      seek.style.setProperty('--p', `${seek.value / 10}%`);
      $('t-cur').textContent = formatTime(pos);
    });
    seek.addEventListener('change', () => {
      player.seek((seek.value / 1000) * player.duration());
      seeking = false;
    });

    $('btn-details').addEventListener('click', () => player.current && openDetails(player.current));
    $('btn-share').addEventListener('click', () => player.current && shareTrack(player.current, player.position()));
    $('btn-download').addEventListener('click', () => player.current && downloadTrack(player.current));
    $('btn-captions').addEventListener('click', () => App.captions.open());

    $('cont-btn').addEventListener('click', () => {
      const track = library.get(storage.lastTrackId());
      if (!track) return;
      if (player.current && player.current.id === track.id) player.play();
      else player.open(track, { autoplay: true });
    });
  }

  function refreshContinue() {
    const card = $('continue');
    const track = library.get(storage.lastTrackId());
    if (!track || player.isPlaying()) {
      card.hidden = true;
      return;
    }
    const saved = storage.getTrack(track.id);
    const where = saved && !saved.listened && saved.pos > 0 ? formatTime(saved.pos) : 'от началото';
    $('cont-title').textContent = track.title;
    $('cont-sub').textContent = `${track.author} · ${where}`;
    card.hidden = false;
  }

  /* =========================================================
     SETTINGS
     ========================================================= */

  function bindSettings() {
    $('set-autoplay').addEventListener('change', (e) => storage.setSetting('autoplay', e.target.checked));
    $('set-back').addEventListener('change', (e) => storage.setSetting('skipBack', Number(e.target.value)));
    $('set-fwd').addEventListener('change', (e) => storage.setSetting('skipForward', Number(e.target.value)));
    $('set-sleep').addEventListener('change', (e) => {
      const v = e.target.value;
      player.setSleep(v === 'off' ? null : v === 'end' ? 'end' : Number(v));
    });
    $('btn-reset').addEventListener('click', () => {
      if (!window.confirm('Да изтрия ли целия прогрес и отметките „изслушан"?')) return;
      storage.reset();
      window.location.reload();
    });
  }

  /** One preview card per theme; each card is painted in its own theme colors. */
  function buildThemePicker() {
    const list = $('theme-list');
    list.textContent = '';
    App.theme.list.forEach((theme) => {
      list.append(el('button', {
        class: 'theme-swatch', type: 'button', 'data-theme': theme.id, 'aria-pressed': 'false',
        onclick: () => App.theme.set(theme.id),
      },
      el('span', { class: 'swatch-preview' }, el('span', { class: 'swatch-dot' }), el('span', { class: 'swatch-line' })),
      el('span', { class: 'swatch-name', text: theme.name }),
      icon('check')));
    });
  }

  function renderThemePicker() {
    const active = App.theme.current();
    $('theme-list').querySelectorAll('.theme-swatch').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.theme === active));
    });
  }

  function renderSleep({ mode, remaining }) {
    const btn = $('btn-sleep');
    btn.hidden = mode === null;
    if (mode === 'timer') btn.textContent = `⏾ ${formatTime(remaining)}`;
    else if (mode === 'end') btn.textContent = '⏾ до края';
    else $('set-sleep').value = 'off';
  }

  /* =========================================================
     LISTENING HISTORY
     ========================================================= */

  function bindHistory() {
    const folderSelect = $('history-folder');
    library.folders.forEach((f) => folderSelect.append(el('option', { value: f.name, text: f.title })));

    $('btn-history').addEventListener('click', () => {
      renderHistory();
      openSheet('sheet-history');
    });
    $('history-sort').addEventListener('change', renderHistory);
    folderSelect.addEventListener('change', renderHistory);
    $('btn-history-clear').addEventListener('click', () => {
      if (window.confirm('Да изтрия ли цялата история на слушането?')) App.history.clear();
    });
    App.on('history-change', () => { if (activeSheet === $('sheet-history')) renderHistory(); });
  }

  /** 45 сек / 12 мин / 1 ч 5 мин */
  function formatSpan(ms) {
    const total = Math.round(Math.max(0, ms) / 1000);
    if (total < 60) return `${total} сек`;
    const min = Math.floor(total / 60);
    if (min < 60) return `${min} мин`;
    return `${Math.floor(min / 60)} ч ${min % 60} мин`;
  }

  function dayLabel(date) {
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    if (diff === 0) return 'Днес';
    if (diff === 1) return 'Вчера';
    const text = date.toLocaleDateString('bg-BG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function renderHistory() {
    const newestFirst = $('history-sort').value !== 'old';
    const folder = $('history-folder').value;
    const entries = App.history.list()
      .filter((x) => !folder || x.id.startsWith(`${folder}/`))
      .sort((a, b) => (newestFirst ? b.s - a.s : a.s - b.s));

    const list = $('history-list');
    list.textContent = '';

    const total = entries.reduce((sum, x) => sum + (x.e - x.s), 0);
    $('history-summary').textContent = entries.length
      ? `Общо слушане: ${formatSpan(total)} · ${entries.length} ${entries.length === 1 ? 'сесия' : 'сесии'}`
      : '';
    $('btn-history-clear').hidden = !App.history.list().length;

    if (!entries.length) {
      list.append(el('p', {
        class: 'empty',
        text: folder ? 'Няма история за тази папка.' : 'Все още няма история. Пуснете запис и той ще се появи тук.',
      }));
      return;
    }

    const dayTotals = new Map();
    entries.forEach((x) => {
      const key = new Date(x.s).toDateString();
      dayTotals.set(key, (dayTotals.get(key) || 0) + (x.e - x.s));
    });

    let currentDay = null;
    entries.forEach((entry) => {
      const date = new Date(entry.s);
      const key = date.toDateString();
      if (key !== currentDay) {
        currentDay = key;
        list.append(el('div', { class: 'history-day' },
          el('span', { text: dayLabel(date) }),
          el('span', { class: 'history-day-total', text: formatSpan(dayTotals.get(key)) })));
      }
      list.append(buildHistoryItem(entry, date));
    });
  }

  function buildHistoryItem(entry, date) {
    const track = library.get(entry.id);
    const title = track ? track.title : entry.id.split('/').pop();
    const range = `${formatTime(entry.from)} → ${formatTime(entry.to)}`;
    const clock = date.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });

    return el('button', {
      class: 'history-item', type: 'button', disabled: !track,
      title: track ? 'Продължи от това място' : null,
      onclick: () => {
        closeSheet();
        player.open(track, { startAt: entry.done ? 0 : entry.to, autoplay: true });
      },
    },
    el('span', { class: 'history-time', text: clock }),
    el('span', { class: 'history-main' },
      el('span', { class: 'history-title', text: title }),
      el('span', { class: 'history-sub', text: track ? `${track.author} · ${range}` : range })),
    el('span', { class: 'history-meta' },
      el('span', { text: formatSpan(entry.e - entry.s) }),
      entry.done ? el('span', { class: 'history-done' }, icon('check'), 'Изслушан') : null));
  }

  /* =========================================================
     SHEETS (settings, details, actions)
     ========================================================= */

  function bindSheets() {
    document.querySelectorAll('.sheet').forEach((sheet) => {
      sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
      sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);
    });
  }

  function openSheet(id) {
    if (activeSheet) closeSheet(true);
    const sheet = $(id);
    activeSheet = sheet;
    lastFocus = document.activeElement;
    sheet.hidden = false;
    requestAnimationFrame(() => {
      sheet.classList.add('open');
      sheet.querySelector('.sheet-close').focus();
    });
  }

  function closeSheet(immediate) {
    const sheet = activeSheet;
    if (!sheet) return;
    activeSheet = null;
    sheet.classList.remove('open');
    if (immediate === true) sheet.hidden = true;
    else setTimeout(() => { if (activeSheet !== sheet) sheet.hidden = true; }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ---------- actions ---------- */

  function openActions(track) {
    $('h-actions').textContent = track.title;
    const list = $('actions-list');
    list.textContent = '';

    const saved = storage.getTrack(track.id);
    const listened = !!(saved && saved.listened);
    const add = (iconName, label, handler) => list.append(
      el('button', {
        class: 'action-btn', type: 'button',
        onclick: () => { closeSheet(); handler(); },
      }, icon(iconName), label)
    );

    add('check', listened ? 'Маркирай като неизслушан' : 'Маркирай като изслушан', () => player.setListened(track, !listened));
    add('info', 'Детайли', () => setTimeout(() => openDetails(track), 260));
    add('share', 'Сподели', () => shareTrack(track, 0));
    add('download', 'Изтегли', () => downloadTrack(track));
    openSheet('sheet-actions');
  }

  /* ---------- details + transcript ---------- */

  function openDetails(track) {
    const saved = storage.getTrack(track.id) || {};
    const dur = library.duration(track);
    let progress = 'Не е започнат';
    if (saved.listened) progress = 'Изслушан';
    else if (saved.pos > 0) progress = dur ? `${formatTime(saved.pos)} / ${formatTime(dur)}` : formatTime(saved.pos);

    const items = [
      ['Заглавие', track.title],
      ['Автор', track.author],
      ['Продължителност', dur ? formatTime(dur) : '—'],
      ['Размер', formatSize(track.sizeKb) || '—'],
      ['Прогрес', progress],
      ['Файл', track.filename],
    ];
    const meta = $('details-meta');
    meta.textContent = '';
    items.forEach(([label, value]) => meta.append(
      el('div', { class: 'meta-item' },
        el('span', { class: 'meta-label', text: label }),
        el('span', { class: 'meta-value', text: value }))
    ));

    loadInfo(track);
    loadTranscript(track);
    openSheet('sheet-details');
  }

  /** Shows "<name>.nfo" next to the MP3, if there is one, above the transcript. */
  function loadInfo(track) {
    const token = ++infoToken;
    const box = $('details-info');
    box.hidden = true;
    box.textContent = '';
    if (window.location.protocol === 'file:') return;
    fetch(track.nfoSrc)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then((text) => {
        if (token !== infoToken || !text.trim()) return;
        text.trim().split(/\r?\n/).forEach((line) => {
          box.append(line.trim() ? el('p', { dir: 'auto' }, linkify(line)) : el('br'));
        });
        box.hidden = false;
      })
      .catch(() => { /* no .nfo for this recording */ });
  }

  /** Text with http(s) addresses turned into links (everything stays text nodes). */
  function linkify(line) {
    const parts = [];
    let last = 0;
    line.replace(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, (url, at) => {
      parts.push(line.slice(last, at), el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }));
      last = at + url.length;
      return url;
    });
    parts.push(line.slice(last));
    return parts.filter((p) => p !== '');
  }

  function transcriptNote(text) {
    const box = $('transcript');
    box.textContent = '';
    box.append(el('p', { class: 'tr-note', text }));
  }

  function loadTranscript(track) {
    const token = ++transcriptToken;
    if (window.location.protocol === 'file:') {
      transcriptNote('Транскрипцията е достъпна само когато страницата се отваря през уеб сървър.');
      return;
    }
    transcriptNote('Зареждане…');
    fetch(track.txtSrc)
      .then((res) => {
        if (!res.ok) throw new Error(res.status);
        return res.text();
      })
      .then((text) => { if (token === transcriptToken) renderTranscript(track, text); })
      .catch(() => { if (token === transcriptToken) transcriptNote('Няма транскрипция за този запис.'); });
  }

  function renderTranscript(track, text) {
    const box = $('transcript');
    box.textContent = '';
    const stamp = /^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*(.*)$/;

    text.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const m = stamp.exec(line.trim());
      if (!m) {
        box.append(el('p', { dir: 'auto', text: line }));
        return;
      }
      const seconds = util.parseStamp(m[1]);
      box.append(el('button', {
        class: 'tr-line', type: 'button',
        onclick: () => seekTranscript(track, seconds),
      }, el('span', { class: 'tr-time', text: m[1] }), el('span', { text: m[2] })));
    });
    if (!box.childNodes.length) transcriptNote('Транскрипцията е празна.');
  }

  function seekTranscript(track, seconds) {
    if (player.current && player.current.id === track.id) {
      player.seek(seconds);
      player.play();
    } else {
      player.open(track, { startAt: seconds, autoplay: true });
    }
  }

  /* ---------- share + download ---------- */

  function downloadTrack(track) {
    const a = el('a', { href: track.src, download: track.filename });
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function shareTrack(track, pos) {
    const url = router.build(track, pos);
    if (navigator.share) {
      try {
        await navigator.share({ title: track.title, text: track.author, url });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Връзката е копирана');
    } catch (err) {
      window.prompt('Копирайте връзката:', url);
    }
  }

  /* =========================================================
     KEYBOARD
     ========================================================= */

  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeSheet) {
        closeSheet();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || activeSheet) return;
      if (e.target.matches('input, select, textarea')) return;

      const s = storage.getSettings();
      switch (e.key) {
        case ' ':
          if (e.target.closest('button')) return; // let the focused button handle it
          e.preventDefault();
          player.toggle();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) player.playPrev();
          else player.skip(-s.skipBack);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) player.playNext();
          else player.skip(s.skipForward);
          break;
        default:
      }
    });
  }

  /* =========================================================
     PLAYER EVENTS
     ========================================================= */

  function bindBus() {
    App.on('track-change', ({ track }) => {
      renderHeader(track);
      setActiveRow(track);
      refreshContinue();
    });

    App.on('track-meta', ({ track }) => refreshRow(track));

    App.on('state', ({ playing }) => {
      renderPlayState(playing);
      refreshContinue();
      if (!playing && player.current) refreshRow(player.current);
    });

    App.on('progress', ({ pos, dur }) => {
      renderProgress(pos, dur);
      const now = Date.now();
      if (player.current && now - lastRowRefresh > 5000) {
        lastRowRefresh = now;
        refreshRow(player.current);
      }
    });

    App.on('listened', ({ track }) => {
      refreshRow(track);
      refreshFolderCount(track.folder);
      refreshContinue();
    });

    App.on('settings', renderSettings);
    App.on('sleep-tick', renderSleep);

    // Browsers only allow sound after a tap: point the listener at the play button.
    App.on('autoplay-blocked', () => {
      $('btn-play').classList.add('attention');
      toast('Натиснете ▶, за да пуснете записа');
    });
  }

  App.ui = { init };
})();
