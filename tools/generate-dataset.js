#!/usr/bin/env node
/**
 * generate-dataset.js — builds db/dataset.js from the MP3 files in media/.
 *
 * Usage (from the project folder):
 *   node tools/generate-dataset.js             update db/dataset.js (old copy kept as db/dataset_<date>_<time>.js)
 *   node tools/generate-dataset.js --dry-run   only show what would change
 *   node tools/generate-dataset.js --prune     also remove entries whose MP3 no longer exists
 *
 * What it does:
 *   - Anything already in db/dataset.js stays as you wrote it: display_name, title,
 *     order and any extra fields. Only `length` (seconds) and `size_kb` are
 *     refreshed from the real files.
 *   - New folders and recordings are added. Their display_name / title start as
 *     the PLACEHOLDER text below, so they are easy to find and replace by hand.
 *   - Entries whose MP3 is missing are kept (with a warning) unless --prune is given.
 *   - Transcript files next to the MP3 are recorded in `transcript` (.txt, shown in
 *     Details) and `subtitles` (.vtt, or .srt if there is no .vtt; timed text). Their
 *     names may differ from the MP3, e.g. "<name> (transcribed on 29-May-2026 16-23-51).vtt".
 *   - Expected layout (the same rule the player uses):
 *       media/<folder>/<name>/<name>.mp3
 *
 * No dependencies. Needs Node.js 14 or newer.
 */
'use strict';

/* =========================================================
   MP3 DURATION (pure functions, work on any Uint8Array/Buffer)
   ========================================================= */

const BITRATES = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };
const SYNC_SEARCH_LIMIT = 1024 * 1024; // how far to look for the next frame after damaged data

/** Decodes the 4-byte MPEG audio frame header at `i`, or returns null. */
function parseFrameHeader(b, i) {
  if (i < 0 || i + 4 > b.length) return null;
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (b[i + 1] >> 3) & 3; // 0 = MPEG 2.5, 1 = reserved, 2 = MPEG 2, 3 = MPEG 1
  const layerBits = (b[i + 1] >> 1) & 3; // 1 = Layer III, 2 = Layer II, 3 = Layer I
  const bitrateIndex = (b[i + 2] >> 4) & 0xf;
  const rateIndex = (b[i + 2] >> 2) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;

  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const table = version === 1 ? `v1l${layer}` : layer === 1 ? 'v2l1' : 'v2l23';
  const bitrate = BITRATES[table][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (b[i + 2] >> 1) & 1;
  const samples = layer === 1 ? 384 : layer === 3 && version !== 1 ? 576 : 1152;
  const length = layer === 1
    ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
    : Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;

  return { version, layer, sampleRate, samples, length, mono: ((b[i + 3] >> 6) & 3) === 3 };
}

/** Offset of the audio data, after any ID3v2 tags at the start. */
function audioStart(b) {
  let i = 0;
  while (i + 10 <= b.length && b[i] === 0x49 && b[i + 1] === 0x44 && b[i + 2] === 0x33) { // "ID3"
    const size = ((b[i + 6] & 0x7f) << 21) | ((b[i + 7] & 0x7f) << 14) | ((b[i + 8] & 0x7f) << 7) | (b[i + 9] & 0x7f);
    const footer = b[i + 5] & 0x10 ? 10 : 0;
    i += 10 + size + footer;
  }
  return i;
}

/** End of the audio data, before an ID3v1 tag at the end. */
function audioEnd(b) {
  const n = b.length;
  return n >= 128 && b[n - 128] === 0x54 && b[n - 127] === 0x41 && b[n - 126] === 0x47 ? n - 128 : n; // "TAG"
}

/** First real frame at or after `from`: a valid header followed by another valid header. */
function findFrame(b, from, end) {
  const limit = Math.min(end - 4, from + SYNC_SEARCH_LIMIT);
  for (let i = from; i <= limit; i++) {
    const h = parseFrameHeader(b, i);
    if (!h || h.length < 4) continue;
    const next = i + h.length;
    if (next + 4 > end || parseFrameHeader(b, next)) return { offset: i, header: h };
  }
  return null;
}

const readU32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const tagAt = (b, i) => (i + 4 <= b.length ? String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]) : '');

/** Frame count from a Xing/Info (LAME) or VBRI header in the first frame, if present. */
function headerFrameCount(b, offset, h) {
  const side = h.version === 1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
  const x = offset + 4 + side;
  const xing = tagAt(b, x);
  if ((xing === 'Xing' || xing === 'Info') && x + 12 <= b.length && readU32(b, x + 4) & 1) {
    return readU32(b, x + 8) || null;
  }
  const v = offset + 4 + 32;
  if (tagAt(b, v) === 'VBRI' && v + 18 <= b.length) return readU32(b, v + 14) || null;
  return null;
}

/** Adds up every frame — exact for CBR and VBR files without a Xing/VBRI header. */
function scanDuration(b, offset, end) {
  let seconds = 0;
  let i = offset;
  while (i + 4 <= end) {
    const h = parseFrameHeader(b, i);
    if (h && h.length >= 4) {
      seconds += h.samples / h.sampleRate;
      i += h.length;
      continue;
    }
    const next = findFrame(b, i + 1, end); // damaged data or a tag in the middle: resync
    if (!next) break;
    i = next.offset;
  }
  return seconds;
}

/**
 * Duration of an MP3 in seconds, or null if no MPEG audio was found.
 * @param {Uint8Array} bytes the whole file
 */
function mp3Duration(bytes) {
  const end = audioEnd(bytes);
  const first = findFrame(bytes, audioStart(bytes), end);
  if (!first) return null;
  const frames = headerFrameCount(bytes, first.offset, first.header);
  if (frames) return (frames * first.header.samples) / first.header.sampleRate;
  return scanDuration(bytes, first.offset, end);
}

/* =========================================================
   MERGE (pure: no file system access)
   ========================================================= */

/** display_name / title given to new entries; search for it in db/dataset.js. */
const PLACEHOLDER = '=======12345678910=======';

const baseName = (filename) => filename.replace(/\.[^.]+$/, '');
const isSorted = (list) => list.every((x, i) => i === 0 || list[i - 1] <= x);
const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

/** Catalog fields filled from the files next to the MP3 (see scanMedia). */
const COMPANION_KEYS = ['transcript', 'subtitles'];

/**
 * Merges what is on disk into the existing catalog.
 * @param {{folders: Array}} data       current catalog (not modified)
 * @param {Map<string, Map<string, {mp3: *, transcript?: string, subtitles?: string}>>} media
 *        folder name → (filename → disk entry; `mp3` is what `measure` receives)
 * @param {(mp3: *, entry: object) => {length: (number|null), size_kb: (number|null)}} measure
 *        `entry` is the catalog entry as it is now (length/size_kb may already be known)
 * @param {{prune?: boolean, placeholder?: string}} [options]
 *        placeholder: display_name / title of new entries (default: PLACEHOLDER)
 * @returns {{data: object, report: object}}
 */
function mergeDataset(data, media, measure, options = {}) {
  const prune = !!options.prune;
  const placeholder = options.placeholder == null ? PLACEHOLDER : options.placeholder;
  const report = {
    folders: 0, files: 0, newFolders: [], newFiles: [], updated: [], missing: [], pruned: [], unreadable: [],
  };

  const oldFolders = (Array.isArray(data.folders) ? data.folders : [])
    .filter((f) => f && typeof f.folder_name === 'string' && f.folder_name);
  const keepFolderOrder = !isSorted(oldFolders.map((f) => f.folder_name));
  const knownFolders = new Set(oldFolders.map((f) => f.folder_name));

  const snapshot = (file) => JSON.stringify([file.length, file.size_kb, ...COMPANION_KEYS.map((k) => file[k])]);
  const measureInto = (file, handle, id) => {
    const before = snapshot(file);
    const m = measure(handle.mp3, file);
    if (m.size_kb != null) file.size_kb = m.size_kb;
    if (m.length != null) file.length = m.length;
    else report.unreadable.push(id);
    COMPANION_KEYS.forEach((key) => {
      if (handle[key]) file[key] = handle[key];
      else delete file[key];
    });
    return before !== snapshot(file);
  };

  const mergeFolder = (folder, disk) => {
    const oldFiles = (Array.isArray(folder.files) ? folder.files : [])
      .filter((f) => f && typeof f.filename === 'string' && f.filename);
    const keepFileOrder = !isSorted(oldFiles.map((f) => f.filename));
    const seen = new Set();
    const files = [];

    oldFiles.forEach((original) => {
      const id = `${folder.folder_name}/${original.filename}`;
      seen.add(original.filename);
      const file = { ...original };
      if (!disk.has(original.filename)) {
        if (prune) report.pruned.push(id);
        else {
          report.missing.push(id);
          files.push(file);
        }
        return;
      }
      if (measureInto(file, disk.get(original.filename), id)) report.updated.push(id);
      files.push(file);
    });

    disk.forEach((handle, filename) => {
      if (seen.has(filename)) return;
      const id = `${folder.folder_name}/${filename}`;
      const file = { title: placeholder, filename, length: null, size_kb: null };
      measureInto(file, handle, id);
      report.newFiles.push(id);
      files.push(file);
    });

    if (!keepFileOrder) files.sort(byKey('filename'));
    return { ...folder, files };
  };

  const folders = [];
  oldFolders.forEach((folder) => {
    const merged = mergeFolder(folder, media.get(folder.folder_name) || new Map());
    if (prune && !merged.files.length && !media.has(folder.folder_name)) return;
    folders.push(merged);
  });
  media.forEach((disk, name) => {
    if (knownFolders.has(name)) return;
    report.newFolders.push(name);
    folders.push(mergeFolder({ folder_name: name, display_name: placeholder, files: [] }, disk));
  });
  if (!keepFolderOrder) folders.sort(byKey('folder_name'));

  report.folders = folders.length;
  report.files = folders.reduce((n, f) => n + f.files.length, 0);
  return { data: { ...data, folders }, report };
}

/** The file content of db/dataset.js for `data`. */
function serializeDataset(data) {
  return `const playlistData = ${JSON.stringify(data, null, 2)};\n`;
}

/* =========================================================
   FILE SYSTEM + COMMAND LINE
   ========================================================= */

function readDataset(fs, vm, file) {
  if (!fs.existsSync(file)) return { folders: [] };
  const text = fs.readFileSync(file, 'utf8');
  let data;
  try {
    // Evaluated as JavaScript, so hand edits with trailing commas or comments still load.
    data = vm.runInNewContext(`${text}\n;typeof playlistData === 'undefined' ? undefined : playlistData`, {}, { timeout: 5000 });
  } catch (err) {
    throw new Error(`db/dataset.js has a syntax error, nothing was changed.\n  ${err.message}`);
  }
  if (!data || !Array.isArray(data.folders)) {
    throw new Error('db/dataset.js must define `const playlistData = { folders: [...] }`, nothing was changed.');
  }
  return JSON.parse(JSON.stringify(data));
}

/**
 * The file in `names` with the first of `exts` that belongs to recording `name`:
 * "<name>.ext" if present, else the last "<name>….ext" in alphabetical order.
 */
function companion(names, name, exts) {
  for (const ext of exts) {
    const own = names.filter((n) => n.toLowerCase().endsWith(ext) && n.startsWith(name));
    const exact = own.find((n) => baseName(n) === name);
    if (exact || own.length) return exact || own[own.length - 1];
  }
  return undefined;
}

/**
 * media/<folder>/<name>/<name>.mp3 →
 * Map(folder → Map(filename → {mp3: absolute path, transcript?: file name, subtitles?: file name})).
 */
function scanMedia(fs, path, mediaDir, warn) {
  if (!fs.existsSync(mediaDir)) throw new Error(`Folder not found: ${mediaDir}`);
  const dirs = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();

  const media = new Map();
  dirs(mediaDir).forEach((folder) => {
    const folderPath = path.join(mediaDir, folder);
    const files = new Map();

    fs.readdirSync(folderPath, { withFileTypes: true }).forEach((e) => {
      if (e.isFile() && /\.mp3$/i.test(e.name)) {
        warn(`media/${folder}/${e.name}: must be in its own folder (media/${folder}/${baseName(e.name)}/${e.name}) — skipped`);
      }
    });

    dirs(folderPath).forEach((name) => {
      const dir = path.join(folderPath, name);
      const names = fs.readdirSync(dir).sort();
      const mp3s = names.filter((n) => /\.mp3$/i.test(n));
      const match = mp3s.find((n) => baseName(n) === name);
      mp3s.filter((n) => n !== match).forEach((n) => {
        warn(`media/${folder}/${name}/${n}: file name must match its folder ("${name}.mp3") — skipped`);
      });
      if (match) {
        files.set(match, {
          mp3: path.join(dir, match),
          transcript: companion(names, name, ['.txt']),
          subtitles: companion(names, name, ['.vtt', '.srt']),
        });
      } else if (!mp3s.length) warn(`media/${folder}/${name}/: no MP3 inside — skipped`);
    });

    if (files.size) media.set(folder, files);
  });
  return media;
}

/** "dataset.js" → "dataset_2026-10-20_20-45-07.js" next to it (a free name, never overwritten). */
function backupPath(fs, path, file, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const ext = path.extname(file);
  const base = file.slice(0, file.length - ext.length);
  let candidate = `${base}_${stamp}${ext}`;
  for (let i = 2; fs.existsSync(candidate); i++) candidate = `${base}_${stamp}_${i}${ext}`;
  return candidate;
}

/**
 * Copies `file` to a dated backup, then replaces it with `text`.
 * @returns {string|null} the backup path, or null if `file` did not exist yet
 */
function writeDataset(fs, path, file, text) {
  let backup = null;
  if (fs.existsSync(file)) {
    backup = backupPath(fs, path, file);
    fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return backup;
}

function main() {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');

  const args = process.argv.slice(2);
  const known = ['--dry-run', '--prune', '--help', '-h'];
  const unknown = args.filter((a) => !known.includes(a));
  if (args.includes('--help') || args.includes('-h') || unknown.length) {
    if (unknown.length) console.error(`Unknown option: ${unknown.join(' ')}\n`);
    console.log('Usage: node tools/generate-dataset.js [--dry-run] [--prune]\n\n'
      + '  --dry-run  show what would change, write nothing\n'
      + '  --prune    remove entries whose MP3 file no longer exists');
    return unknown.length ? 1 : 0;
  }
  const dryRun = args.includes('--dry-run');
  const prune = args.includes('--prune');

  const root = path.resolve(__dirname, '..');
  const datasetFile = path.join(root, 'db', 'dataset.js');
  const mediaDir = path.join(root, 'media');

  const warnings = [];
  const data = readDataset(fs, vm, datasetFile);
  const media = scanMedia(fs, path, mediaDir, (w) => warnings.push(w));

  const total = [...media.values()].reduce((n, m) => n + m.size, 0);
  let done = 0;
  const showProgress = process.stdout.isTTY;
  const measure = (file) => {
    done++;
    if (showProgress) process.stdout.write(`\rMeasuring ${done}/${total}…`);
    const result = { length: null, size_kb: null };
    try {
      result.size_kb = Math.round(fs.statSync(file).size / 1024);
      const seconds = mp3Duration(fs.readFileSync(file));
      if (seconds && seconds > 0) result.length = Math.round(seconds);
    } catch (err) {
      warnings.push(`${path.relative(root, file)}: ${err.message}`);
    }
    return result;
  };

  const { data: next, report } = mergeDataset(data, media, measure, { prune });
  if (showProgress && total) process.stdout.write('\r\x1b[K');

  printReport(report, warnings);

  const text = serializeDataset(next);
  const current = fs.existsSync(datasetFile) ? fs.readFileSync(datasetFile, 'utf8') : null;
  if (current === text) {
    console.log('\ndb/dataset.js is already up to date.');
    return 0;
  }
  if (dryRun) {
    console.log('\nDry run: nothing was written.');
    return 0;
  }

  const backup = writeDataset(fs, path, datasetFile, text);
  console.log(`\nWritten db/dataset.js${backup ? ` (previous version: ${path.relative(root, backup)})` : ''}.`);
  return 0;
}

function printReport(r, warnings, pruneHint = 'use --prune to remove') {
  const list = (title, items, limit = 30) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length}):`);
    items.slice(0, limit).forEach((x) => console.log(`  ${x}`));
    if (items.length > limit) console.log(`  … and ${items.length - limit} more`);
  };

  console.log(`Folders: ${r.folders} (${r.newFolders.length} new)   Recordings: ${r.files} (${r.newFiles.length} new)`);
  console.log(`Length/size updated: ${r.updated.length}`);
  list(`New folders — replace "display_name": "${PLACEHOLDER}"`, r.newFolders);
  list(`New recordings — replace "title": "${PLACEHOLDER}"`, r.newFiles);
  list(`MP3 missing, entry kept (${pruneHint})`, r.missing, 10);
  list('Removed (MP3 missing)', r.pruned);
  list('Could not read the duration', r.unreadable);
  list('Warnings', warnings);
}

/** How many display_name / title fields still hold the placeholder. */
function countPlaceholders(data, placeholder = PLACEHOLDER) {
  return data.folders.reduce((n, f) => n + (f.display_name === placeholder)
    + (f.files || []).filter((x) => x.title === placeholder).length, 0);
}

module.exports = {
  PLACEHOLDER, mp3Duration, mergeDataset, serializeDataset, countPlaceholders,
  readDataset, scanMedia, writeDataset, printReport,
};

if (typeof require !== 'undefined' && require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}
