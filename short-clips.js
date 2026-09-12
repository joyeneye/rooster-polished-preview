import {clipList, clipCard, releaseVideo} from './clip-client-utils.js';
import {createClipCommunityController} from './clip-community.js';
import {createClipsViewer} from './roster-clips-viewer.js';

export function createShortClips() {
  const feed = document.getElementById('clips-feed');
  const status = document.getElementById('clips-status');
  const refreshButton = document.getElementById('clips-refresh');
  if (!feed || !status || !refreshButton) return null;
  const section = feed.closest?.('.short-clips') ?? null;
  // An empty feed gets one short line, not a wide blank panel. The moment a video is
  // uploaded the marker clears and the full section renders again.
  const markEmpty = empty => {
    if (!section) return;
    if (empty) section.setAttribute('data-clips-empty', 'true');
    else section.removeAttribute('data-clips-empty');
  };
  const validMemberId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const member = feed.dataset.clipMember === 'profile'
    ? (new URLSearchParams(window.location.search).get('id') || '').toLowerCase()
    : 'owner';
  if (member !== 'owner' && !validMemberId(member)) {
    feed.replaceChildren();
    status.textContent = 'Open a valid page on the roster to see their videos.';
    refreshButton.disabled = true;
    return null;
  }
  let request = null;
  let generation = 0;
  let videos = [];
  const community = createClipCommunityController();
  // The full screen one-at-a-time viewer. It reuses this section's clips, the
  // same reactions and comments and the same delete menu; the grid below stays
  // exactly as it was for anybody who would rather browse it.
  const viewer = createClipsViewer(section);

  async function refresh() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const epoch = ++generation;
    const timeout = setTimeout(() => controller.abort(), 20000);
    refreshButton.disabled = true;
    feed.setAttribute('aria-busy', 'true');
    markEmpty(false);
    status.textContent = 'Loading the latest videos…';
    try {
      const response = await fetch(`/api/clips?member=${encodeURIComponent(member)}`, {
        credentials:'same-origin', cache:'no-store', signal:controller.signal,
        headers:{Accept:'application/json'},
      });
      if (!response.ok) throw new Error('Video feed unavailable');
      const data = await response.json();
      const clips = clipList(data);
      const resolved = data.member_id;
      if (resolved === null && member === 'owner' && clips.length === 0) {
        // No owner binding exists yet. Show an empty owner page, not everybody.
      } else if (!validMemberId(resolved) || (member !== 'owner' && resolved.toLowerCase() !== member) ||
          clips.some(clip => clip.member_id.toLowerCase() !== resolved.toLowerCase())) {
        throw new Error('Videos do not belong to this profile');
      }
      if (epoch !== generation) return;
      videos.forEach(releaseVideo);
      videos = [];
      community.clear();
      const cards = clips.map(clip => {
        const {card, video} = clipCard(clip);
        video.src = clip.video_url;
        video.addEventListener('play', () => {
          videos.forEach(other => { if (other !== video) other.pause(); });
        });
        video.addEventListener('error', () => {
          status.textContent = 'A video could not load. Tap Refresh to try again.';
        });
        videos.push(video);
        community.attach(clip, card);
        // A clear Delete button is shown to the uploader and the site owner.
        window.RosterMedia?.attach(card, {kind: 'video', id: clip.id, member_id: clip.member_id}, {
          onStatus(text) { if (epoch === generation) status.textContent = text; },
          onChanged() { if (epoch === generation) void refresh(); },
        });
        return card;
      });
      feed.replaceChildren(...cards);
      viewer?.setClips(clips);
      markEmpty(clips.length === 0);
      status.textContent = clips.length
        ? 'Tap a video to watch. These videos belong to this profile.'
        : member === 'owner'
          ? 'J.White hasn\u2019t added videos yet. Check back soon.'
          : 'This page hasn\u2019t added videos yet. Check back soon.';
    } catch {
      if (epoch === generation) {
        videos.forEach(releaseVideo);
        videos = [];
        community.clear();
        feed.replaceChildren();
        viewer?.setClips([]);
        status.textContent = 'Videos could not load just now. Tap Refresh to try again.';
      }
    } finally {
      clearTimeout(timeout);
      if (epoch === generation) {
        refreshButton.disabled = false;
        feed.setAttribute('aria-busy', 'false');
        request = null;
      }
    }
  }

  refreshButton.addEventListener('click', () => void refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') videos.forEach(video => video.pause());
  });
  window.addEventListener('pagehide', () => {
    generation += 1;
    request?.abort();
    request = null;
    videos.forEach(video => video.pause());
    viewer?.close();
    refreshButton.disabled = false;
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
  void refresh();
  return {refresh};
}

createShortClips();
