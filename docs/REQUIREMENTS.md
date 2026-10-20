# Audiobook Player — Requirements

## 1. Goal
A single-page web audiobook / lecture player that runs entirely in the browser. There is no backend:
the catalog is a static data file, audio and transcripts are static files, and all user state
(progress, listened marks, history, settings) is kept in `localStorage`.

## 2. Constraints
| ID | Constraint |
|----|------------|
| C-1 | No backend, no database, no build step. Deploy = copy the folder to any static web server (nginx, Apache, Cloudflare Pages, …). The host must support HTTP Range requests (MP3 seeking). |
| C-2 | Must work from a web server (`http(s)://`) **and** when `index.html` is opened directly from disk (`file://`). Therefore classic `<script>` tags are used (no ES modules) and the catalog is a script, not fetched. Files that must be fetched (transcript, timed text, `.nfo`) are only available over http; on `file://` a short notice is shown instead. |
| C-3 | Vanilla HTML/CSS/JavaScript only. No frameworks, no external CDNs (works offline / on a LAN). |
| C-4 | All persistent user data lives in `localStorage` of the visitor's browser. |
| C-5 | UI language: Bulgarian. |
| C-6 | The site must not depend on the local tools: `server.js` and `tools/` are for preparing and testing only, and the site behaves the same on any static host. |

## 3. Data contract

### 3.1 Catalog — `db/dataset.js`
The file defines one global constant, `playlistData`:

```js
const playlistData = {
  folders: [
    {
      folder_name:  "006_arif_abdullah",            // directory name under media/
      display_name: "Ариф Абдуллах",                // shown in UI (author / collection)
      files: [
        {
          title:      "Обетът на хората пред Аллах",  // shown in UI
          filename:   "<name>.mp3",
          length:     2143,                          // seconds, or null if unknown
          size_kb:    54263,                         // kilobytes, or null if unknown
          transcript: "<name> (transcribed on …).txt", // optional, file name next to the MP3
          subtitles:  "<name> (transcribed on …).vtt"  // optional, .vtt or .srt next to the MP3
        }
      ]
    }
  ]
};
```

- `length` / `size_kb` may be `null`. When `length` is null the app learns the duration
  from the audio element the first time a track is loaded and caches it in `localStorage`.
  When `size_kb` is null the size column is left empty.
- `transcript` / `subtitles` are optional. Without them the player looks for `<name>.txt` and
  `<name>.vtt`, then `<name>.srt` (§3.2).
- Folder and track order in the file is the display order.
- `display_name` / `title` are written by hand. New entries added by the tools get the placeholder
  `=======12345678910=======` (§4.8).
- Extra keys are allowed and ignored by the player.

### 3.2 Media path rule
```
media/<folder_name>/<name>/<name>.mp3     the audio; <name> = filename without extension
media/<folder_name>/<name>/<transcript>   catalog `transcript`, else <name>.txt        (optional)
media/<folder_name>/<name>/<subtitles>    catalog `subtitles`, else <name>.vtt / .srt  (optional)
media/<folder_name>/<name>/<name>.nfo     extra information                            (optional)
```

### 3.3 Track identity
`trackId = "<folder_name>/<filename>"` — stable, used as the `localStorage` key and in deep links.

### 3.4 Transcript (`.txt`, optional)
Plain UTF-8 text, shown line by line. A line that starts with `[mm:ss]` or `[h:mm:ss]` becomes a
clickable seek point.

### 3.5 Timed text (`.vtt` / `.srt`, optional)
WebVTT or SRT. Each cue is one word or a few words with start / end times. Both formats are read
the same way (`.` or `,` before the milliseconds). Tags (`<i>` …) are removed, and blocks without
`-->` (header, `NOTE`, `STYLE`) are skipped.

### 3.6 Extra information (`.nfo`, optional)
UTF-8 text, any length. Each line is a paragraph, and `http(s)://` addresses become links that open
in a new tab.

## 4. Functional requirements

### 4.1 Library
- **FR-1** Render all folders from the catalog as collapsible groups. The header shows the folder name and the listened count `X/Y`.
- **FR-2** Each row shows: number, status (in progress with % / listened ✓), title, duration, size, and a ⋮ actions button (mark listened / not listened, Детайли, Сподели, Изтегли).
- **FR-3** Collapsed/expanded state of folders is remembered. On the very first visit all folders start collapsed.
- **FR-4** Search box filters tracks by title and folder name, case- and diacritics-insensitive; folders with matches auto-expand; "Няма намерени резултати." state.
- **FR-5** The currently loaded track is highlighted, its folder expanded, and the row scrolled into view.

### 4.2 Playback
- **FR-6** Clicking a row loads and plays the track (clicking the current one toggles play/pause). Custom controls: play/pause, seek bar, elapsed / total time, skip back and forward, previous / next.
- **FR-7** Skip back / forward amounts are configurable: back 10 / 15 / 30 s (default 15), forward 15 / 30 / 60 s (default 30).
- **FR-8** Playback speed: 0.75, 1, 1.25, 1.5, 1.75, 2 — cycled with the speed button, remembered globally.
- **FR-9** Autoplay next track (toggle, default on), including across folders.
- **FR-10** Sleep timer: off / 15 / 30 / 45 / 60 min / "до края на записа". While active, a pill next to the controls shows the remaining time (tap → Settings). The last 10 s fade out, then playback pauses. "До края на записа" pauses at the end of the current recording instead of moving on.
- **FR-11** Media Session API: title, author and album "Аудиокниги" on the lock screen / notification; play, pause, seek back/forward, previous/next track, seek-to; position state.
- **FR-12** Keyboard shortcuts: Space = play/pause, ← / → = skip, Shift+← / Shift+→ = previous / next track, Esc = close the open panel. Ignored while typing in a field or while a panel (sheet) is open.

### 4.3 Progress & persistence
- **FR-13** Playback position per track is saved periodically (≈ every 5 s while playing) and on pause, track change, tab hide and page close.
- **FR-14** Selecting a track that has a saved position resumes there (minus 3 s of context). A listened track restarts from 0.
- **FR-15** A track is auto-marked **listened** when position ≥ 95 % of duration or the `ended` event fires.
- **FR-16** User can manually mark / unmark a track as listened.
- **FR-17** On startup the last played track is loaded (paused) at its saved position, and a "Продължи слушането" card is shown (hidden while playing).
- **FR-18** Settings persist across sessions: speed, autoplay, skip amounts, theme, timed-text layout and text shift.
- **FR-19** Settings panel offers "Изчисти прогреса" (with confirmation) to reset all stored progress and settings; the page reloads. The listening history is kept (it has its own clear button, FR-28).
- **FR-26** Settings panel offers a color theme picker. Each theme is shown as a preview card in its own colors. Brown is the default. The choice is remembered and applied before the first paint, so there is no flash of the wrong colors.

### 4.4 Details, download, share
- **FR-20** Details panel (player button or ⋮): title, author, duration, size, progress, file name; then the extra information from `.nfo` (§3.6) if the file exists (nothing is shown otherwise); then the transcript (§3.4) with clickable timestamps, or "Няма транскрипция за този запис."
- **FR-21** Download button saves the MP3 (`<a download>`).
- **FR-22** Share button produces a deep link `index.html#/<folder_name>/<filename>?t=<seconds>` (from the player: the current second; from ⋮: the start). Uses the native share sheet (Web Share API) when available, otherwise copies to clipboard and shows a toast (or a prompt if the clipboard is unavailable).
- **FR-23** Opening a deep link finds the track in the list, expands its folder, highlights it, positions it at `t` (or at the listener's saved position when there is no `t`), and starts playing.
  - If the browser blocks autoplay (no tap yet), the play button pulses and a toast asks the listener to press ▶.
  - An unknown link shows "Записът от връзката не е намерен".
  - The link is then removed from the address bar, so a reload continues the listener's own progress.

### 4.5 Listening history
- **FR-27** Every continuous stretch of playback is recorded as a session: the recording, the start and end time (wall clock), the part of the recording that was played (from → to), and whether it was finished. Sessions shorter than 5 s are dropped. A seek during playback starts a new session. The running session is saved every 5 s, so it survives an abrupt close. At most 1000 sessions are kept, and the oldest are dropped first.
- **FR-28** Settings → "История на слушането" → "Отвори" opens the history window:
  - sessions grouped by day (Днес / Вчера / full date), with a total per day;
  - each session shows the time, title, folder, the range played, the length of the session, and "Изслушан" if it was finished;
  - a summary of total time and number of sessions;
  - sort newest or oldest first, and filter by folder;
  - tapping a session continues the recording from where that session ended;
  - "Изчисти историята" deletes the history (after a confirmation).

### 4.6 Timed text ("Текст")
- **FR-29** A "Текст" button next to Изтегли opens a full-screen view of the current recording's timed text (§3.5). The button is disabled (tooltip "Няма текст за този запис") when the recording has none.
  - The words are grouped into short phrases: a phrase ends at `.` `!` `?` `…` `؟`, at a comma once it is over 45 characters, always at 80 characters, at a pause ≥ 1.2 s once it is over 20 characters, and at any pause ≥ 2.5 s.
  - The current phrase follows the audio. In it, the spoken word is highlighted (accent box), the words already spoken are bright and the coming words dim. A word stays highlighted up to 0.6 s after it ends.
  - Two layouts, switched with a button and remembered:
    - **Изречение** (default) — only the current phrase, large and centered, with the previous and next phrase small and faint;
    - **Целия текст** — all phrases, the current one bright, kept in the middle by scrolling. If the listener scrolls by hand, following stops for 5 s, and a "Към текущото място" button brings it back at once.
  - Tapping a word jumps to that word, and tapping elsewhere on a line jumps to the start of the phrase. Playback starts if it was paused.
  - The view has its own back / play-pause / forward buttons and a thin progress bar. Esc or ✕ closes it. When the recording changes, the view loads the new text.
  - Mixed-direction text (Cyrillic, Latin, Arabic) is shown with automatic direction per line.
- **FR-30** Text shift: "−1 с" / "+1 с" buttons move the text against the audio by 1 s per tap (limit ±30 s). The value is shown between them, and tapping it resets the shift to 0. The shift is one global setting for all recordings. Jumps by tapping a word take the shift into account. Purpose: browsers seek inaccurately in VBR MP3s (§7).

### 4.7 Errors
- **FR-24** Missing or unplayable audio shows a non-blocking toast ("Файлът не може да бъде зареден") and does not break the app. Playback stops there; nothing is skipped automatically, so there is no error loop.
- **FR-25** If `localStorage` is unavailable or full, the app still plays audio and shows a single warning.

### 4.8 Local tools (not deployed)
- **FR-31** `server.js` (Node.js) serves the project folder like a plain static host: GET/HEAD, HTTP Range (206 / 416), MIME types, `index.html` for folders, `Cache-Control: no-cache`, no access outside the folder. Options: port, `--host`.
- **FR-32** At start, `server.js` asks:
  1. only start the server (Enter, or no answer within 60 s, or no terminal);
  2. scan `media/` and add new recordings to `db/dataset.js`, then start;
  3. like 2, and also remove entries whose MP3 is missing.
- **FR-33** Catalog update (`server.js` options 2/3 and `tools/generate-dataset.js`):
  - **Added automatically:** new folders and recordings, with `display_name` / `title` = `=======12345678910=======`.
  - **Filled and refreshed on every update:** `filename`, `length` (read from the MP3, no dependencies), `size_kb`, `transcript`, `subtitles`.
  - **Never changed:** hand-written fields, order and extra keys.
  - **Missing MP3s:** kept with a warning, or removed with prune (option 3 / `--prune`); folders left empty are removed too.
  - **Backups:** before `db/dataset.js` is changed, the old file is copied to `db/dataset_<YYYY-MM-DD>_<HH-MM-SS>.js`. Nothing is written when nothing changed. A file with a syntax error is never overwritten.
  - **Files found next to the MP3:** `transcript` = `<name>.txt`, else the last `<name>….txt` alphabetically. `subtitles` = the same rule for `.vtt`, and if there is none, for `.srt`.

## 5. Non-functional requirements
- **NFR-1 Mobile-first**: usable on a 360 px wide phone; touch targets ≥ 40 px; works in portrait and on desktop.
- **NFR-2 Performance**: renders 250+ tracks instantly; one DOM build, filtering toggles visibility; storage writes throttled. The timed text handles several thousand words: it is built once, and while playing only the changed elements are updated (`requestAnimationFrame`).
- **NFR-3 Accessibility**: semantic buttons, `aria-label`s, visible focus, `aria-pressed`/`aria-expanded` states, sufficient contrast, respects `prefers-reduced-motion`.
- **NFR-4 Browsers**: latest Chrome, Firefox, Safari (desktop + iOS/Android).
- **NFR-5 Security**: catalog, transcript, timed text and `.nfo` text is inserted with `textContent` only (no `innerHTML` with data). Links from `.nfo` are created only for `http(s)://` addresses, with `rel="noopener noreferrer"`.
- **NFR-6 Maintainability**: code split into small single-purpose files, JSDoc on public functions, no globals except `window.App` and the catalog's `playlistData`.
- **NFR-7 Themes**: 13 color themes:
  - dark: Кафява (default), Тъмна, Оранжева, Зелена, Синя, Лилава, Висок контраст;
  - mid-tone: Сиво-синя;
  - light: Светла, Праскова, Мента, Небесна, Сепия.

  All colors are tokens in `[data-theme="…"]` blocks at the top of `assets/css/style.css`; no component uses a hard-coded color. To add a theme, add a CSS block and one entry in `assets/js/theme.js`.

## 6. localStorage schema
Single key `audiobook:v1`:
```json
{
  "version": 1,
  "settings": {
    "speed": 1, "autoplay": true, "skipBack": 15, "skipForward": 30, "theme": "brown",
    "captionMode": "focus", "captionShift": 0
  },
  "tracks": {
    "<folder_name>/<filename>": { "pos": 123.4, "dur": 3600, "listened": false, "updatedAt": 1760000000000 }
  },
  "lastTrackId": "<folder_name>/<filename>",
  "collapsed": ["<folder_name>"]
}
```
- `captionMode`: `"focus"` (Изречение) or `"full"` (Целия текст).
- `captionShift`: seconds, −30…30. Both are written only once the listener changes them; absent means the default.
- The `version` field allows future migrations; unknown settings keys are kept.

Listening history is kept under a separate key, `audiobook:history:v1`:
```json
{ "version": 1,
  "entries": [ { "id": "<folder_name>/<filename>", "s": 1760000000000, "e": 1760000600000,
                "from": 120, "to": 720, "done": false } ] }
```
- `s` / `e`: session start and end, in ms since the epoch.
- `from` / `to`: the position in the recording, in seconds.

## 7. Known limitations
- **VBR seeking**: in VBR MP3s browsers find the target of a seek from a coarse table in the file
  (Xing TOC: 100 points, positions rounded to 1/256 of the file, ≈ 8 s for a 55 MB lecture). After
  a jump, the player's clock can therefore be a few seconds off the real audio, by a different amount after each jump. Playing from the start is exact.
  Measured on a 35-min lecture, the offset was 3.1 s after a jump to 17:08 (0.1 s with a CBR copy).
  The `.vtt` timings themselves were checked against the audio and are accurate. All media is VBR by
  choice, so FR-30 offers a manual correction.
- Cloudflare Pages accepts files only up to 25 MB, and most of the MP3s are larger (see README → Deploy).

## 8. Out of scope (v1)
- User accounts, cross-device sync, server-side statistics.
- Offline caching / PWA install (possible v2).
- Bookmarks / notes inside a track, chapters within one MP3.
- Editing the catalog inside the app. It is prepared offline with `server.js` / `tools/generate-dataset.js` (see README).
- Automatic correction of the VBR seek offset.
