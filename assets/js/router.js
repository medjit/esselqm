/**
 * router.js — deep links of the form  #/<folder_name>/<filename>?t=<seconds>
 */
(function () {
  'use strict';

  const App = window.App;
  const enc = encodeURIComponent;

  /**
   * @returns {{id: string, t: (number|undefined)}|null}
   */
  function parse(hash = window.location.hash) {
    const m = /^#\/([^/?]+)\/([^?]+)(?:\?(.*))?$/.exec(hash);
    if (!m) return null;
    try {
      const id = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
      const t = Number(new URLSearchParams(m[3] || '').get('t'));
      return { id, t: Number.isFinite(t) && t > 0 ? t : undefined };
    } catch (err) {
      return null;
    }
  }

  /** Absolute share URL for a track, optionally at a time offset. */
  function build(track, t) {
    const base = window.location.href.split('#')[0];
    const query = t >= 1 ? `?t=${Math.floor(t)}` : '';
    return `${base}#/${enc(track.folder.name)}/${enc(track.filename)}${query}`;
  }

  App.router = { parse, build };
})();
