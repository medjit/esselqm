/**
 * util.js — shared helpers and the tiny event bus used by every module.
 * Creates the single global namespace `window.App`.
 */
(function () {
  'use strict';

  const App = (window.App = window.App || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Application-wide event bus. */
  App.bus = new EventTarget();
  App.emit = (name, detail) => App.bus.dispatchEvent(new CustomEvent(name, { detail }));
  App.on = (name, fn) => App.bus.addEventListener(name, (e) => fn(e.detail));

  const pad = (n) => String(n).padStart(2, '0');

  /**
   * Seconds → "M:SS" or "H:MM:SS".
   * @param {number} sec
   * @returns {string}
   */
  function formatTime(sec) {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  /**
   * Kilobytes → human readable size. Empty string when unknown.
   * @param {number} kb
   * @returns {string}
   */
  function formatSize(kb) {
    let size = Number(kb) || 0;
    if (size <= 0) return '';
    const units = ['KB', 'MB', 'GB'];
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${i === 0 ? Math.round(size) : size.toFixed(1)} ${units[i]}`;
  }

  /**
   * "1:02:03" / "12:30" → seconds, or null when not a timestamp.
   * @param {string} stamp
   * @returns {number|null}
   */
  function parseStamp(stamp) {
    const parts = stamp.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  /** Lower-case and strip diacritics for search matching. */
  function normalize(str) {
    return String(str).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /**
   * Leading-edge throttle.
   * @param {Function} fn
   * @param {number} ms
   */
  function throttle(fn, ms) {
    let last = 0;
    return function (...args) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(this, args);
      }
    };
  }

  /** Trailing debounce. */
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /**
   * Safe element factory. Data is only ever inserted as text.
   * Props: `class`, `text`, `on<event>` handlers, anything else → attribute.
   */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  }

  /** Inline SVG icon referencing a symbol from the sprite in index.html. */
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  let toastTimer;
  /** Shows a short non-blocking message. */
  function toast(message) {
    const node = document.getElementById('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
  }

  App.util = { formatTime, formatSize, parseStamp, normalize, throttle, debounce, el, icon, toast };
})();
