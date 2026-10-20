#!/usr/bin/env node
/**
 * server.js — local server for testing the site before it goes to a static host.
 *
 * Usage (from the project folder):
 *   node server.js                    http://localhost:8000/
 *   node server.js 3000               another port
 *   node server.js --host 0.0.0.0     also reachable from other devices on the network
 *
 * At start it asks what to do (no answer within 60 seconds = 1):
 *   1. Only start the server; db/dataset.js is not touched.
 *   2. Scan media/ and add the new MP3s to db/dataset.js, then start the server.
 *      filename, length and size_kb are filled in; display_name / title are set to
 *      "=======12345678910=======" for you to replace by hand. Everything already in
 *      db/dataset.js stays as you wrote it (see tools/generate-dataset.js).
 *   3. Like 2, and also remove the entries whose MP3 is missing.
 * Before db/dataset.js is changed, it is copied to db/dataset_<date>_<time>.js.
 *
 * The server serves the project folder as static files, with HTTP Range support so
 * the player can seek inside MP3s (the same as a real web host).
 *
 * Not needed on the final static host. No dependencies. Needs Node.js 14 or newer.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const vm = require('vm');
const dataset = require('./tools/generate-dataset.js');

const ROOT = __dirname;
const DATASET_FILE = path.join(ROOT, 'db', 'dataset.js');
const MEDIA_DIR = path.join(ROOT, 'media');
const MENU_TIMEOUT_MS = 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/* =========================================================
   DATASET UPDATE
   ========================================================= */

/**
 * length / size_kb of one MP3. The whole file is read only when the catalog does not
 * already have a length for a file of this size.
 */
function measure(file, entry, warnings) {
  const result = { length: null, size_kb: null };
  try {
    result.size_kb = Math.round(fs.statSync(file).size / 1024);
    if (entry.length != null && entry.size_kb === result.size_kb) {
      result.length = entry.length;
      return result;
    }
    const seconds = dataset.mp3Duration(fs.readFileSync(file));
    if (seconds && seconds > 0) result.length = Math.round(seconds);
  } catch (err) {
    warnings.push(`${path.relative(ROOT, file)}: ${err.message}`);
  }
  return result;
}

/** Scans media/ and rewrites db/dataset.js (after a dated backup) if anything changed. */
function updateDataset(prune) {
  console.log('\nScanning media/…');
  const warnings = [];
  const data = dataset.readDataset(fs, vm, DATASET_FILE);
  const media = dataset.scanMedia(fs, path, MEDIA_DIR, (w) => warnings.push(w));
  const { data: next, report } = dataset.mergeDataset(
    data, media, (file, entry) => measure(file, entry, warnings), { prune },
  );
  dataset.printReport(report, warnings, 'menu option 3 removes them');

  const text = dataset.serializeDataset(next);
  const current = fs.existsSync(DATASET_FILE) ? fs.readFileSync(DATASET_FILE, 'utf8') : null;
  if (text === current) {
    console.log('\ndb/dataset.js is already up to date, not changed.');
  } else {
    const backup = dataset.writeDataset(fs, path, DATASET_FILE, text);
    console.log(`\nWritten db/dataset.js${backup ? ` (previous version: ${path.relative(ROOT, backup)})` : ''}.`);
  }
  const todo = dataset.countPlaceholders(next);
  if (todo) console.log(`${todo} display_name/title still "${dataset.PLACEHOLDER}" — replace them in db/dataset.js.`);
}

/* =========================================================
   STATIC FILES
   ========================================================= */

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(`${status} ${message}\n`);
}

/** Absolute path for a URL path, or null if it points outside the project. */
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch (err) {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const file = path.join(ROOT, decoded);
  return file === ROOT || file.startsWith(ROOT + path.sep) ? file : null;
}

/** "bytes=a-b" → {start, end}, null if absent/unsupported, false if unsatisfiable. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (!m[1] && !m[2])) return null;
  let start;
  let end;
  if (m[1]) {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  } else {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  }
  return start <= end && start < size ? { start, end } : false;
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendError(res, 405, 'Method Not Allowed');
  }

  const urlPath = new URL(req.url, 'http://localhost').pathname;

  let file = resolvePath(urlPath);
  if (!file) return sendError(res, 400, 'Bad Request');

  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, { Location: `${urlPath}/` });
        return res.end();
      }
      file = path.join(file, 'index.html');
      try {
        stat = fs.statSync(file);
      } catch (e) {
        err = e;
      }
    }
    if (err || !stat.isFile()) return sendError(res, 404, 'Not Found');

    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache', // always pick up edits to db/dataset.js and the rest
      'Last-Modified': stat.mtime.toUTCString(),
    };

    const range = parseRange(req.headers.range, stat.size);
    if (range === false) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    const { start, end } = range || { start: 0, end: stat.size - 1 };
    headers['Content-Length'] = stat.size ? end - start + 1 : 0;
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    res.writeHead(range ? 206 : 200, headers);

    if (req.method === 'HEAD' || !stat.size) return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });
}

/* =========================================================
   COMMAND LINE
   ========================================================= */

const MENU = `
Какво да направя?
  1) Само стартирай сървъра, без да пипам нищо
  2) Сканирай media/ и добави новите файлове в db/dataset.js, после стартирай сървъра
  3) Като 2, и премахни от db/dataset.js записите, на които липсва MP3 файлът
`;
const CHOICES = ['1', '2', '3'];

/** Shows the menu and resolves with '1'–'3'; '1' on Enter, after the timeout, or without a terminal. */
function askChoice() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve('1');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const done = (choice) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      resolve(choice);
    };
    const timer = setTimeout(() => {
      console.log(`\nНяма избор за ${MENU_TIMEOUT_MS / 1000} секунди, стартирам само сървъра.`);
      done('1');
    }, MENU_TIMEOUT_MS);
    rl.on('SIGINT', () => process.exit(130));
    rl.on('close', () => done('1')); // Ctrl+D
    console.log(MENU);
    const ask = () => rl.question(`Избор [1-3] (Enter = 1, след ${MENU_TIMEOUT_MS / 1000} с автоматично 1): `, (answer) => {
      const choice = answer.trim() || '1';
      if (CHOICES.includes(choice)) done(choice);
      else ask();
    });
    ask();
  });
}

async function main() {
  const args = process.argv.slice(2);
  let port = 8000;
  let host = 'localhost';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) host = args[++i];
    else if (/^\d+$/.test(args[i])) port = Number(args[i]);
    else {
      console.log('Usage: node server.js [port] [--host 0.0.0.0]');
      process.exitCode = args[i] === '--help' || args[i] === '-h' ? 0 : 1;
      return;
    }
  }

  const choice = await askChoice();
  if (choice !== '1') {
    try {
      updateDataset(choice === '3');
    } catch (err) {
      console.error(`\nError: ${err.message}\ndb/dataset.js was not changed.`);
    }
  }

  const server = http.createServer(handle);
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Try: node server.js ${port + 1}`
      : `Error: ${err.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
    console.log(`\nServing ${ROOT}\n  http://${shown}:${port}/\nCtrl+C to stop.`);
  });
}

main();
