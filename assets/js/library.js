/**
 * library.js — turns the raw catalog (`playlistData`) into folders and a flat
 * track list with stable ids and resolved media paths.
 */
(function () {
  'use strict';

  const App = window.App;
  const enc = encodeURIComponent;

  let folders = [];
  let tracks = [];
  const byId = new Map();

  /**
   * @param {{folders: Array}} data the catalog from db/dataset.js
   */
  function init(data) {
    folders = [];
    tracks = [];
    byId.clear();

    (data.folders || []).forEach((raw) => {
      const folder = { name: raw.folder_name, title: raw.display_name || 'Unknown', tracks: [] };

      (raw.files || []).forEach((file, i) => {
        const base = file.filename.replace(/\.[^.]+$/, '');
        const dir = `media/${enc(raw.folder_name)}/${enc(base)}`;
        const track = {
          id: `${raw.folder_name}/${file.filename}`,
          folder,
          author: folder.title,
          title: file.title || base,
          filename: file.filename,
          number: i + 1,
          index: tracks.length,
          length: Number(file.length) || 0,
          sizeKb: Number(file.size_kb) || 0,
          src: `${dir}/${enc(file.filename)}`,
          // db/dataset.js names the transcript files (tools/generate-dataset.js finds them);
          // without a name, they are looked for as "<name>.txt" and "<name>.vtt" / "<name>.srt".
          txtSrc: `${dir}/${enc(file.transcript || `${base}.txt`)}`,
          nfoSrc: `${dir}/${enc(base)}.nfo`, // optional extra information, shown in Details
          subSrc: file.subtitles ? `${dir}/${enc(file.subtitles)}` : null,
          subGuess: file.subtitles ? [] : [`${dir}/${enc(base)}.vtt`, `${dir}/${enc(base)}.srt`],
        };
        folder.tracks.push(track);
        tracks.push(track);
        byId.set(track.id, track);
      });

      folders.push(folder);
    });
  }

  /** Duration in seconds: catalog value, else the one learned at runtime, else 0. */
  function duration(track) {
    if (track.length) return track.length;
    const saved = App.storage.getTrack(track.id);
    return (saved && saved.dur) || 0;
  }

  App.library = {
    init,
    duration,
    get folders() { return folders; },
    get tracks() { return tracks; },
    get: (id) => byId.get(id) || null,
    next: (id) => { const t = byId.get(id); return t ? tracks[t.index + 1] || null : null; },
    prev: (id) => { const t = byId.get(id); return t ? tracks[t.index - 1] || null : null; },
  };
})();
