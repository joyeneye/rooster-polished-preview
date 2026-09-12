import {createClipCommunityController} from './clip-community.js';

/* The one-at-a-time Clips viewer.

   It is a layer over the existing clips section, not a second clips feature:
   the videos, the reactions, the comments and the delete menu are the ones the
   grid already uses. The viewport is a scroll-snap column that takes whatever
   height the dialog grid leaves below the bar, so the close and sound controls
   are never covered and nothing is guessed at a fixed pixel height.

   Playback rules: only the clip in view plays, the previous one pauses, and
   everything pauses when the viewer closes or the tab is hidden. Playback
   starts muted so the browser allows it inline, with one obvious sound toggle
   in the bar. */

const seconds = value => `${Math.max(1, Math.round(value))}s`;

export function createClipsViewer(section) {
  if (!section) return null;
  const actions = section.querySelector('.clips-actions');
  if (!actions) return null;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'clips-watch-open';
  openButton.textContent = 'Watch one at a time';
  openButton.hidden = true;
  actions.append(openButton);

  const dialog = document.createElement('dialog');
  dialog.className = 'roster-clips-dialog';
  dialog.setAttribute('aria-label', 'Clips');
  dialog.innerHTML = `
    <div class="roster-clips-shell">
      <header class="roster-clips-bar">
        <button class="roster-clips-close" type="button">Close</button>
        <p class="roster-clips-count" role="status"></p>
        <button class="roster-clips-sound" type="button" aria-pressed="false">Sound off</button>
      </header>
      <div class="roster-clips-viewport" tabindex="-1"></div>
    </div>`;
  section.append(dialog);

  const viewport = dialog.querySelector('.roster-clips-viewport');
  const closeButton = dialog.querySelector('.roster-clips-close');
  const soundButton = dialog.querySelector('.roster-clips-sound');
  const counter = dialog.querySelector('.roster-clips-count');

  const community = createClipCommunityController();
  let clips = [];
  let panels = [];
  let active = null;
  let sound = false;
  let observer = null;

  function stopAll() {
    panels.forEach(panel => panel.video.pause());
  }

  function makeActive(panel) {
    if (active === panel) return;
    if (active) active.video.pause();
    active = panel;
    if (!panel) return;
    panel.video.muted = !sound;
    // A refused play is not an error worth showing: the member still has the
    // native controls on the video itself.
    panel.video.play().catch(() => {});
    counter.textContent = `${panels.indexOf(panel) + 1} of ${panels.length}`;
  }

  /* The rail mirrors the real reaction buttons that live in this clip's own
     comments panel, so every number on it comes from the existing API. */
  function mirror(railButton, realButton) {
    if (!realButton) { railButton.hidden = true; return; }
    const sync = () => {
      const text = realButton.textContent || '';
      const count = text.match(/(\d[\d,]*)\s*$/);
      railButton.querySelector('b').textContent = count ? count[1] : '';
      railButton.setAttribute('aria-pressed', realButton.getAttribute('aria-pressed') || 'false');
      railButton.disabled = realButton.disabled;
    };
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(realButton, {childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'disabled']});
    railButton.addEventListener('click', () => realButton.click());
    return watch;
  }

  function railButton(label, glyph) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'roster-clip-rail-button';
    button.innerHTML = `<span aria-hidden="true">${glyph}</span><b></b>`;
    button.setAttribute('aria-label', label);
    return button;
  }

  function build() {
    observer?.disconnect();
    community.clear();
    panels.forEach(panel => panel.watchers.forEach(watcher => watcher?.disconnect()));
    panels = [];
    active = null;
    viewport.replaceChildren();
    if (!clips.length) return;

    clips.forEach(clip => {
      const panel = document.createElement('section');
      panel.className = 'roster-clip';
      panel.dataset.clipId = clip.id;

      const stage = document.createElement('div');
      stage.className = 'roster-clip-stage';
      const video = document.createElement('video');
      video.className = 'roster-clip-video';
      video.playsInline = true;
      video.loop = true;
      video.muted = true;
      video.controls = true;
      video.preload = 'none';
      video.setAttribute('aria-label', `Video by ${clip.name}`);
      video.src = clip.video_url;
      stage.append(video);

      const info = document.createElement('div');
      info.className = 'roster-clip-info';
      const who = document.createElement('b');
      who.textContent = clip.name;
      const caption = document.createElement('p');
      caption.textContent = clip.caption;
      caption.hidden = !clip.caption;
      const meta = document.createElement('small');
      meta.textContent = `${new Date(clip.created_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})} · ${seconds(clip.duration)}`;
      info.append(who, caption, meta);

      const rail = document.createElement('div');
      rail.className = 'roster-clip-rail';

      // The comments drawer stays in the layout while it is shut, collapsed to a
      // hairline and made inert, because the existing community panel loads its
      // real counts when it first comes into view. `hidden` would keep it out of
      // the layout for good and the numbers would never arrive.
      const sheet = document.createElement('div');
      sheet.className = 'roster-clip-sheet';
      sheet.dataset.open = 'false';
      sheet.inert = true;
      community.attach(clip, sheet);

      const apple = railButton('Green apples', '🍏');
      const tomato = railButton('Tomatoes', '🍅');
      const comments = railButton('Comments', '💬');
      const share = railButton('Share this video', '↗');
      comments.querySelector('b').remove();
      share.querySelector('b').remove();

      const watchers = [
        mirror(apple, sheet.querySelector('.clip-reaction-apple')),
        mirror(tomato, sheet.querySelector('.clip-reaction-tomato')),
      ];

      const details = sheet.querySelector('.clip-comments');
      comments.addEventListener('click', () => {
        const opening = sheet.dataset.open !== 'true';
        sheet.dataset.open = String(opening);
        sheet.inert = !opening;
        comments.setAttribute('aria-expanded', String(opening));
        if (opening && details) { details.open = true; details.querySelector('summary')?.focus(); }
      });
      comments.setAttribute('aria-expanded', 'false');

      share.addEventListener('click', async () => {
        const url = `${location.origin}${location.pathname}#clips`;
        try {
          if (navigator.share) await navigator.share({title: `${clip.name} on ROOSTER`, text: clip.caption || undefined, url});
          else { await navigator.clipboard.writeText(url); share.setAttribute('aria-label', 'Link copied'); }
        } catch { /* the member cancelled or sharing is unavailable */ }
      });

      rail.append(apple, tomato, comments, share);
      // The direct Delete button, shown only to the uploader and the owner.
      window.RosterMedia?.attach(rail, {kind: 'video', id: clip.id, member_id: clip.member_id});

      panel.append(stage, rail, info, sheet);
      viewport.append(panel);
      panels.push({panel, video, watchers});
    });

    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const panel = panels.find(item => item.panel === entry.target);
        if (!panel) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) makeActive(panel);
        else if (active === panel) panel.video.pause();
      });
    }, {root: viewport, threshold: [0, 0.6, 0.9]});
    panels.forEach(panel => observer.observe(panel.panel));
  }

  function open() {
    if (!clips.length) return;
    build();
    dialog.showModal();
    viewport.scrollTop = 0;
    viewport.focus({preventScroll: true});
    if (panels[0]) makeActive(panels[0]);
  }

  function close() {
    stopAll();
    if (dialog.open) dialog.close();
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  soundButton.addEventListener('click', () => {
    sound = !sound;
    soundButton.setAttribute('aria-pressed', String(sound));
    soundButton.textContent = sound ? 'Sound on' : 'Sound off';
    if (active) {
      active.video.muted = !sound;
      if (sound) active.video.play().catch(() => {});
    }
  });
  dialog.addEventListener('close', () => {
    stopAll();
    observer?.disconnect();
    active = null;
    openButton.focus({preventScroll: true});
  });
  dialog.addEventListener('cancel', () => stopAll());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAll();
  });

  return {
    setClips(list) {
      clips = Array.isArray(list) ? list : [];
      openButton.hidden = clips.length === 0;
      if (dialog.open) { if (clips.length) build(); else close(); }
    },
    open,
    close,
  };
}
