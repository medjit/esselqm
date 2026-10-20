# Audiobook Player — Implementation Plan

See [REQUIREMENTS.md](REQUIREMENTS.md) for the FR/NFR numbers referenced here.

## 1. Folder structure
```
index.html                 markup skeleton (player, library, sheets, timed-text view) + <script> tags in load order
assets/
  css/style.css            theme tokens, layout, components
  js/
    util.js                event bus, formatting, DOM helper, throttle/debounce, toast
    storage.js             localStorage wrapper (schema, settings, per-track progress)
    theme.js               color theme list, apply + remember
    history.js             listening sessions (own localStorage key)
    library.js             catalog normalization, media URLs, track lookup
    router.js              deep-link parse/build
    player.js              <audio> wrapper, resume, listened, speed, sleep timer, Media Session
    captions.js            timed-text view: VTT/SRT parsing, phrases, word highlight, text shift
    ui.js                  rendering + event wiring for player, library, sheets, details (.nfo, transcript)
    app.js                 boot sequence
db/
  dataset.js               catalog (hand-written titles + generated fields)
  dataset_<date>_<time>.js backups written by the tools before each change (not deployed)
media/                     <folder>/<name>/<name>.mp3 + optional .txt / .vtt / .srt / .nfo
server.js                  local static server + start-up menu for catalog updates (not deployed)
tools/
  generate-dataset.js      catalog scanner/merger + MP3 duration reader (CLI, also used by server.js)
  serve.py                 alternative Range-aware dev server (Python, no menu)
docs/                      REQUIREMENTS.md, IMPLEMENTATION_PLAN.md
README.md
```

## 2. Architecture
- All modules attach to one namespace:
  `window.App = { bus, util, storage, theme, history, library, router, player, captions, ui }`.
  Files are plain IIFEs loaded with classic `<script>` tags so `file://` works (C-2).
- Communication: `App.bus` (an `EventTarget`), via `App.emit(name, detail)` / `App.on(name, fn)`.
  - The player emits `track-change`, `track-meta`, `state` (play/pause), `progress`, `listened`,
    `sleep-tick` and `autoplay-blocked`. Storage emits `settings`, and history emits `history-change`.
  - UI and captions subscribe and call player methods directly. This keeps rendering out of the
    player and audio logic out of the UI.
- Single source of truth for user data: `App.storage` (progress, settings) and `App.history`
  (sessions, own key). Nothing else touches `localStorage`. The exception is the inline `<head>`
  script, which only reads the theme before the first paint.
- The site is static. Everything that needs the file system (scanning `media/`, measuring MP3s,
  writing `db/dataset.js`) lives in the local tools, never in the page (C-6).

### Module responsibilities
| Module | Public API |
|---|---|
| util | `formatTime(sec)`, `formatSize(kb)`, `parseStamp(str)`, `normalize(str)` (lowercase, strip diacritics), `throttle`, `debounce`, `el(tag, props, ...children)`, `icon(name)`, `toast(msg)` |
| storage | `load()`, `isFirstRun()`, `getSettings()`, `setSetting(k, v)`, `getTrack(id)`, `updateTrack(id, patch)`, `lastTrackId()`, `setLastTrack(id)`, `isCollapsed(f)`, `setCollapsed(f, bool)`, `reset()` |
| theme | `list`, `current()`, `apply(id)`, `set(id)` (apply + save) |
| history | `load()`, `start(track, pos)`, `update(track, pos)`, `stop(track, pos)`, `markDone(track)`, `list()`, `clear()` |
| library | `init(playlistData)`, `folders`, `tracks`, `get(id)`, `next(id)`, `prev(id)`, `duration(track)`; each track has `src`, `txtSrc`, `subSrc`, `subGuess`, `nfoSrc` |
| router | `parse(hash) → {id, t} \| null`, `build(track, t) → url` |
| player | `init()`, `open(track, {startAt, autoplay})`, `play()`, `pause()`, `toggle()`, `seek(t)`, `skip(delta)`, `playNext()`, `playPrev()`, `setListened(track, bool)`, `setSpeed(x)`, `cycleSpeed()`, `setSleep(minutes \| "end" \| null)`, `saveProgress()`, `isPlaying()`, `position()`, `duration()`, `current` |
| captions | `init()`, `open()`, `close()`, `available(track) → Promise<bool>`, `parseCues(text)`, `groupPhrases(cues)` |
| ui | `init()`: player header, continue card, library, search, sheets (settings, history, details, track actions), keyboard |
| app | boot: `storage.load` → `history.load` → `theme.apply` → `library.init` → `player.init` → `ui.init` (which calls `captions.init`) → deep link or last track → `pagehide`/`visibilitychange` flush |

## 3. Key behaviours
- **Resume** (FR-14): on `open`, `startAt = saved.listened ? 0 : max(0, saved.pos - 3)`; applied on `loadedmetadata` (`pendingStart`).
- **Progress save** (FR-13): `timeupdate` → throttled 5 s `storage.updateTrack`; forced save on pause, track change, hidden tab and `pagehide`.
- **Listened** (FR-15): on `timeupdate` when `pos/dur ≥ 0.95` (once per load) and on `ended`.
- **Durations** (catalog `length: null`): saved as `dur` on `loadedmetadata`; `library.duration()` falls back to it.
- **Sleep timer** (FR-10): one `setInterval(1 s)` countdown; last 10 s ramp volume down; "end" mode pauses on `ended` instead of advancing, and is cancelled when the track changes.
- **Errors** (FR-24): the `error` event shows a toast, closes the history session and stops; there is no automatic skip.
- **Search** (FR-4): rows carry a precomputed normalized string; input handler (debounced 120 ms) toggles `hidden` (no re-render).
- **History** (FR-27): `playing` → `start`; pause, track change, error → `stop`; seek while playing → `stop` + `start`; the 5 s progress save → `update`; 95 % / `ended` → `markDone`.
- **Media URLs** (§3.2): `library` builds `src`, `txtSrc` (catalog `transcript` or `<name>.txt`),
  `subSrc` (catalog `subtitles`), `subGuess` (`<name>.vtt`, `<name>.srt` when the catalog names
  none) and `nfoSrc` (`<name>.nfo`). Every path segment is URL-encoded, because file names contain
  spaces and brackets.
- **Details** (FR-20): on open, `.nfo` and transcript are fetched in parallel, each guarded by a token against stale responses. A missing `.nfo` (404) shows nothing.
  - `.nfo` lines become `<p dir="auto">`, and `http(s)://` addresses become `<a target="_blank" rel="noopener noreferrer">`, all built as text nodes.
  - `res.text()` always decodes UTF-8, so the result does not depend on the `Content-Type` the host sends.
- **Timed text** (FR-29, FR-30):
  - *Availability*: `captions.available(track)` is called on every track change. It returns `true` for a catalog `subtitles` entry; otherwise it sends a `HEAD` request for each `subGuess` once and caches the result on the track. The Текст button is disabled until that answers.
  - *Parsing*: the file is split into blocks on blank lines. In each block, the `-->` line gives start/end, and the following lines give the text (tags removed, basic entities decoded). Cues are sorted by start.
  - *Phrases*: the rules in FR-29, applied in one pass. Each cue stores its phrase index, and each phrase stores its first/last cue and start time.
  - *Rendering*: one `<p class="cc-line" dir="auto">` per phrase and one `<span class="cc-w">` per cue, built once per track. A click handler on the container reads `data-i` / `data-p`.
  - *Following*: while the view is open, a `requestAnimationFrame` loop reads `player.position() + captionShift`.
    - A binary search finds the last cue that has started.
    - When the phrase changes, the `is-active` / `is-prev` / `is-next` classes move, and in full mode the line is scrolled to the center (smooth, or instant after a jump).
    - When the word changes, `is-on` / `is-said` are updated only inside the current phrase.
  - *Layouts*: `focus` vs `full` is just a CSS class on the view (`.cc.focus` hides every line except prev/active/next and enlarges the active one).
  - *Hand scrolling* (`wheel` / `touchmove`, full mode only) pauses following for 5 s and shows "Към текущото място".
  - *Seeking from the text*: `player.seek(cue.start − captionShift)`, then play.

## 4. Local tools
- **`tools/generate-dataset.js`** — pure functions plus a thin CLI. `server.js` requires the same module.
  - `mp3Duration(bytes)`: skips ID3v2 / ID3v1. Uses the Xing/Info/VBRI frame count when present, otherwise a full frame scan (exact for CBR and VBR). Supports MPEG 1/2/2.5, Layers I–III.
  - `scanMedia()`: reads `media/<folder>/<name>/<name>.mp3` and finds the companion `.txt` / `.vtt` / `.srt` (FR-33). Misplaced or misnamed MP3s are reported as warnings and skipped.
  - `mergeDataset(data, media, measure, {prune, placeholder})`: no file system access.
    - Keeps hand-written fields and extra keys.
    - Keeps the order unless the old list was already sorted (then new entries are sorted in).
    - Refreshes the generated fields and reports new / updated / missing / pruned / unreadable entries.
  - `readDataset()`: evaluates `db/dataset.js` in a `vm` sandbox, so hand edits with comments or trailing commas still load. A syntax error stops the update.
  - `writeDataset()`: makes a dated backup (`COPYFILE_EXCL`, `_2`, `_3`… on a name clash), then writes a temp file and renames it.
- **`server.js`** — Node `http` only, no dependencies.
  - *Start-up*: a `readline` menu with a 60 s timer, or option 1 straight away without a TTY. Ctrl+C exits.
  - *Options 2/3*: run the merge once. `measure` reuses the catalog `length` when `size_kb` is unchanged, so only new or changed MP3s are read in full.
  - *Serving*: generic static file server with path-traversal guard, Range (206/416), HEAD, 301 to the trailing slash for folders, `Cache-Control: no-cache`. Nothing in it is specific to the site.

## 5. Milestones & acceptance

### M1 — Skeleton & library
- [x] `index.html`, `style.css`, util/storage/library/ui render.
- [x] Folders and tracks render; collapse state persists; search works (FR-1–5).

### M2 — Playback
- [x] Custom controls, seek bar, skip, speed, autoplay (FR-6–9).
- [x] Active row highlight; equalizer cover animates only while playing.

### M3 — Persistence
- [x] Resume, listened auto/manual, continue card, cached durations, reset (FR-13–19).

### M4 — Extras
- [x] Sleep timer, Media Session, keyboard shortcuts (FR-10–12).
- [x] Details + transcript, download, share, deep link (FR-20–23).

### M5 — Polish
- [x] Error toasts & storage fallback (FR-24–25), a11y pass (NFR-3), 360 px layout (NFR-1), README.

### M6 — Themes
- [x] All component colors moved to theme tokens; 13 `[data-theme]` blocks (NFR-7).
- [x] Theme picker in Settings, brown default, saved in `settings.theme`, applied pre-paint by an inline `<head>` script (FR-26).

### M7 — Listening history
- [x] `history.js` session recorder and player hooks (FR-27).
- [x] History window from Settings: day groups, sort, folder filter, summary, tap to continue, clear (FR-28).

### M8 — Catalog generator
- [x] `tools/generate-dataset.js` with `--dry-run` / `--prune`, MP3 duration reader, merge that keeps hand-written data (FR-33).
- [x] Placeholder `=======12345678910=======` for new names; dated backups instead of `.bak`.

### M9 — Local server
- [x] `server.js`: static serving with Range (FR-31).
- [x] Start-up menu: serve only / add new / add new + prune, 60 s timeout → serve only (FR-32).

### M10 — Transcripts & timed text
- [x] Scanner records `transcript` / `subtitles`. Files named `<name> (transcribed on …)` work without renaming, and the player also finds `<name>.txt/.vtt/.srt` without a catalog entry.
- [x] Текст button and full-screen view: VTT/SRT parser, phrase grouping, word highlight, Изречение / Целия текст, tap to seek (FR-29).
- [x] Text shift −1 с / +1 с, remembered globally (FR-30). The VBR seek offset was investigated and documented (REQUIREMENTS §7).

### M11 — Extra information
- [x] `<name>.nfo` shown in Details above the transcript, as plain paragraphs with links (FR-20, §3.6).

## 6. Verification
- `node server.js` → option 1 (or `python3 tools/serve.py 8000`) → `http://localhost:8000/`; also `file:///…/index.html` (catalog and playback work; fetched texts show a notice).
- Catalog update on a copy of the project:
  - new folder / new recording → placeholders, measured `length` / `size_kb`, companion files found;
  - hand edits survive;
  - unchanged → no write and no backup;
  - option 3 removes missing entries;
  - a dated backup appears before every write.
- Server: `curl` checks for 200 / 206 (Range) / 416 / 301 / 404, and that `../` cannot escape the folder.
- Timed text: the lecture in `media/005_ahmed_hayrola` (~2000 one-word cues) → phrases of mostly 3–13 words. The highlight follows playback; both layouts, tap-to-seek and the shift buttons work; the `.srt` parses the same as the `.vtt`.
- Details: `media/006_arif_abdullah` has `<name>.nfo` → info block with a link; recordings without `.nfo` show none.
- Inspect `localStorage['audiobook:v1']` / `['audiobook:history:v1']` in DevTools after play/pause/reload.
- Mobile viewport 375×812 (four buttons fit in the extras row); no console errors.

## 7. Risks / open points
- **VBR seek inaccuracy** (REQUIREMENTS §7): after a jump the timed text can be off by a few seconds.
  It is corrected by hand with the shift buttons. The full fix would be CBR re-encoding, which is
  declined: the media stays VBR.
- `fetch` of transcripts, timed text and `.nfo` is blocked on `file://` → notice shown; full feature over http.
- `localStorage` on `file://` is shared per browser profile (Chrome) or per directory (Firefox) — acceptable.
- iOS Safari ignores `audio.volume` → sleep-timer fade is skipped there (pause still works).
- Web Share API requires a secure context; on `http://` LAN it falls back to clipboard (and to a prompt if clipboard is also unavailable).
- Cloudflare Pages has a 25 MB per-file limit; most MP3s exceed it, so the site needs a host without that limit (e.g. nginx).
- Possible v2: PWA offline mode.
