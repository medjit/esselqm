# Audiobook Player

A static, backend-less audiobook / lecture player in Bulgarian. The catalog is a plain JavaScript
file, the audio is plain MP3 files, and each listener's progress, listened marks, history and
settings stay in their own browser (`localStorage`).

- Requirements: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- Implementation plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

## Features
- Library grouped by folder (author / collection), with search, listened counts and per-track progress.
- Player: seek bar, skip back / forward (configurable), previous / next, speed 0.75–2×, autoplay of
  the next recording, sleep timer, lock-screen controls (Media Session).
- Resume where you stopped; recordings are marked listened at 95 %; "Продължи слушането" card.
- **Детайли**: track data, extra information from a `.nfo` file, and the full transcript (`.txt`).
- **Текст**: the timed text (`.vtt` / `.srt`) follows the audio word by word, either one phrase at
  a time in large type (Изречение) or the whole text, scrolling (Целия текст). Tapping a word jumps
  there. The text can be shifted against the audio with **−1 с / +1 с**. The shift is remembered for
  all recordings (see [Known issue](#known-issue-text-and-audio-out-of-sync)).
- **Сподели**: a link that opens the recording at the current second. **Изтегли**: download the MP3.
- Listening history (Settings → История на слушането), 13 color themes, clear-progress button.
- Keyboard: Space play/pause, ←/→ skip, Shift+←/→ previous/next recording, Esc closes a panel.

## Run locally
Start the local server (needs [Node.js](https://nodejs.org) 14+, no `npm install`):

```bash
node server.js
```

then open http://localhost:8000/. Another port: `node server.js 3000`; to open it from a phone on
the same network: `node server.js --host 0.0.0.0`.

At start it asks what to do:

1. Only start the server; nothing is changed.
2. Scan `media/` and add the new MP3s to `db/dataset.js`, then start the server.
3. Like 2, and also remove the entries whose MP3 file is missing.

Enter, or no answer within 60 seconds, means 1. Before `db/dataset.js` is changed, a copy is saved
next to it as `db/dataset_<date>_<time>.js` (for example `db/dataset_2026-10-20_20-45-07.js`).

`server.js` is a plain static file server, like nginx: it serves files on request (with HTTP Range,
so you can seek inside MP3s) and does nothing else for the site. `python3 tools/serve.py 8000` works
too, as a server only, without the menu.

`index.html` can also be opened directly from disk (`file://`), but then transcripts, the timed
text and the `.nfo` information cannot be loaded (browsers block it); everything else works.

## Add recordings
1. Put each recording in its own folder:

   ```
   media/<folder_name>/<name>/<name>.mp3              the audio (required)
   media/<folder_name>/<name>/<name>….txt             transcript, shown in Детайли (optional)
   media/<folder_name>/<name>/<name>….vtt  or  ….srt  timed text for the Текст button (optional)
   media/<folder_name>/<name>/<name>.nfo              extra information, shown in Детайли (optional)
   ```

   The `.txt` / `.vtt` / `.srt` names only have to start with `<name>`, so files like
   `<name> (transcribed on 29-May-2026 16-23-51).vtt` work without renaming. The `.nfo` must be
   named exactly `<name>.nfo`. It is UTF-8 text; each line becomes a paragraph and `https://…`
   addresses become links.
2. Run `node server.js` and choose 2. The terminal lists what was added.
3. In `db/dataset.js`, replace every `=======12345678910=======` with the Bulgarian text:
   `display_name` of a new folder, `title` of a new recording.

What the update does:
- Filled in automatically: `filename`, `length` (seconds), `size_kb`, `transcript` and
  `subtitles` (the names of the transcript files found next to the MP3). These are refreshed on
  every update.
- Never changed: what you wrote — `display_name`, `title`, the order of folders and recordings,
  and any extra fields.
- Entries whose MP3 was deleted are kept, with a warning; option 3 removes them.

Without the server, the same update can be run by hand:

```bash
node tools/generate-dataset.js --dry-run   # show what would change
node tools/generate-dataset.js             # write it
node tools/generate-dataset.js --prune     # also remove entries whose MP3 is missing
```

Even without an update, the player finds `<name>.txt`, `<name>.vtt` and `<name>.srt` next to the
MP3 by name.

## Known issue: text and audio out of sync
The `.vtt` timings are accurate, but browsers seek inaccurately inside VBR (variable bitrate) MP3s:
after a jump (seek bar, skip buttons, tapping a word, resuming after a reload) the player's clock
can be a few seconds off the real audio, by a different amount after each jump. Playing from the
start without jumping is exact. Use −1 с / +1 с in the Текст view to correct it. Re-encoding the
MP3s at a constant bitrate (CBR) would remove the problem; the files are kept VBR by choice.

## Deploy
Copy the folder to any static web host (nginx, Apache, Cloudflare Pages, …). There is no build
step and no backend. Not needed on the host: `server.js`, `tools/`, `docs/` and the
`db/dataset_<date>_<time>.js` backups.

The host must support HTTP Range requests for MP3 seeking (nginx, Apache and Cloudflare do).
Cloudflare Pages accepts files only up to 25 MB, and most of the MP3s are larger. The player loads
the audio from `media/` next to `index.html`, so the whole site needs a host without that limit
(e.g. nginx).
# esselqm
