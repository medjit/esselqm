/**
 * app.js — boot sequence.
 */
(function () {
  'use strict';

  const App = window.App;

  /**
   * Opens and plays the track named by a shared link (#/<folder>/<file>?t=…).
   * The link is removed from the address bar afterwards, so a later reload
   * continues from the listener's own progress instead of the shared spot.
   * @returns {boolean} true if a track was opened
   */
  function openFromHash() {
    const route = App.router.parse();
    if (!route) return false;

    const track = App.library.get(route.id);
    clearHash();
    if (!track) {
      App.util.toast('Записът от връзката не е намерен');
      return false;
    }
    App.player.open(track, { startAt: route.t, autoplay: true });
    return true;
  }

  function clearHash() {
    try {
      window.history.replaceState(null, '', window.location.href.split('#')[0]);
    } catch (err) {
      /* some browsers refuse this on file:// — harmless, the link just stays visible */
    }
  }

  function restoreLastTrack() {
    const track = App.library.get(App.storage.lastTrackId());
    if (track) App.player.open(track, { autoplay: false });
  }

  function boot() {
    if (typeof playlistData === 'undefined') {
      App.util.toast('Каталогът db/dataset.js не е зареден');
      return;
    }

    App.storage.load();
    App.history.load();
    App.theme.apply(App.theme.current());
    App.library.init(playlistData);
    App.player.init();
    App.ui.init();

    if (!openFromHash()) restoreLastTrack();

    window.addEventListener('hashchange', openFromHash);
    window.addEventListener('pagehide', App.player.saveProgress);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) App.player.saveProgress();
    });
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
