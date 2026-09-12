/* roster-media-bus.js
   One thing plays at a time.

   The feed, the radio, profile music and Clips each already pause their own
   players, but nothing stopped the radio from playing underneath a clip. This
   listens at the document for any <audio> or <video> starting and pauses every
   other one on the page, then pauses everything when the tab is hidden or the
   page is left. It reuses the existing elements and does not take over
   playback, seeking, muting or the visible controls of any feature.

   One exception, and it matters: a ROOSTER LIVE room is not a recording. Its
   elements carry a live MediaStream from somebody else's camera or
   microphone, there is nothing to come back to once they are paused, and a
   room with several people on the mic needs every one of them audible at
   once. So a live stream is never paused by the bus, never paused when the
   tab is hidden, and never counted as the thing that is playing. It also
   never resumes anything on its own: what a member stopped stays stopped. */
(function () {
  'use strict';

  if (window.RosterMediaBus) return;

  var current = null;

  /* A live room's audio and video. Marked by ROOSTER LIVE when it mounts an
     element, and recognisable anyway by the live MediaStream on it. */
  function isLive(el) {
    if (!el) return false;
    if (el.dataset && el.dataset.rosterLive === 'stream') return true;
    var source = el.srcObject;
    return Boolean(source && typeof source.getTracks === 'function');
  }

  function others(active) {
    var all = document.querySelectorAll('audio, video');
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el === active) continue;
      // A live room is left alone: pausing it drops somebody's voice.
      if (isLive(el)) continue;
      // A muted, silent element is not competing for the member's ears.
      if (el.paused) continue;
      if (el.muted && el.tagName === 'VIDEO') continue;
      try { el.pause(); } catch (e) { /* element mid-teardown */ }
    }
  }

  function onPlay(event) {
    var el = event.target;
    if (!el || (el.tagName !== 'AUDIO' && el.tagName !== 'VIDEO')) return;
    if (isLive(el)) {
      // A room starting does stop a recording, so a member is not listening
      // to two things, but the room itself never becomes the bus's current
      // player: leaving it never resumes anything.
      others(el);
      return;
    }
    if (el.muted && el.tagName === 'VIDEO') {
      // Muted inline clip playback is allowed to run alongside audio; the
      // moment it is unmuted the volumechange handler below claims the bus.
      return;
    }
    current = el;
    others(el);
  }

  function onVolume(event) {
    var el = event.target;
    if (!el || el.tagName !== 'VIDEO' || el.muted || el.paused) return;
    if (isLive(el)) { others(el); return; }
    current = el;
    others(el);
  }

  // Capture, because play and volumechange do not bubble.
  document.addEventListener('play', onPlay, true);
  document.addEventListener('volumechange', onVolume, true);

  function pauseAll() {
    var all = document.querySelectorAll('audio, video');
    for (var i = 0; i < all.length; i += 1) {
      // Switching tabs during a live room is not leaving it.
      if (isLive(all[i])) continue;
      try { all[i].pause(); } catch (e) { /* element mid-teardown */ }
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') pauseAll();
  });
  window.addEventListener('pagehide', pauseAll);

  window.RosterMediaBus = {
    /* Let a feature hand the bus a player it is about to start. */
    claim: function (el) {
      if (!el) return;
      if (!isLive(el)) current = el;
      others(el);
    },
    current: function () { return current; },
    pauseAll: pauseAll,
    isLive: isLive,
  };
})();
