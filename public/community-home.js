import { nextPromoOrder } from './slots-promos.mjs?v=20260911-casting-v1';
import {mixSlots} from './slots-mix.mjs?v=20260911-casting-v1';
import {openRosterCamera} from './roster-camera.js?v=20260912-centered-camera-v5';

const legacySections = new Set(['home', 'music', 'comments', 'jwhite-friend-space', 'booking']);
if (legacySections.has(location.hash.slice(1))) location.replace(`/jwhite.html${location.hash}`);
/* Three views share one feed API. For You and Following are the vertical
   stage — one thing at a time, the way a phone reads it. Board is the
   conversation list. `filter` is what the API is asked for and it is derived
   from the view, except on Board where the member's own sort choice owns it. */
const params = new URLSearchParams(location.search);
const VIEWS = new Set(['for_you', 'following', 'board']);
const startView = VIEWS.has(params.get('view')) ? params.get('view')
  : location.hash === '#board' ? 'board'
  : 'for_you';
const state = {
  view: startView,
  filter: params.get('filter') || (startView === 'board' ? 'latest' : startView),
  boardFilter: params.get('filter') || 'latest',
  connection: 'everyone',
  cursor: null,
  loading: false,
  posts: new Map(),
  commentPost: null,
  sound: false,
  generation: 0,
};
const stageSection = document.querySelector('#fyp');
const stageColumn = document.querySelector('#fyp-column');
const stageStatus = document.querySelector('#fyp-status');
const stageRetry = document.querySelector('#fyp-retry');
const stageSound = document.querySelector('#fyp-sound');
const boardSection = document.querySelector('#board');
const feedList = document.querySelector('#feed-list');
const feedStatus = document.querySelector('#feed-status');
const feedMore = document.querySelector('#feed-more');
const roomList = document.querySelector('#live-room-list');
const businessList = document.querySelector('#business-list');
const composerDialog = document.querySelector('#composer-dialog');
const commentDialog = document.querySelector('#comment-dialog');
const feedRetry = document.querySelector('#feed-retry');
const moreSheet = document.querySelector('#mobile-more-sheet');
const contextChart = document.querySelector('#context-top-roster');
const contextChartStatus = document.querySelector('#context-top-roster-status');
const cameraStatus = document.querySelector('#slots-camera-status');
const pulse = document.querySelector('#rooster-pulse');
const pulseCount = document.querySelector('#rooster-pulse-count');
const pulseFill = document.querySelector('#rooster-pulse-fill');
const pulseNext = document.querySelector('#rooster-pulse-next');
const icon = name => ({
  heart: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/></svg>',
  comment: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/></svg>',
  repost: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/></svg>',
  share: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v13m-5-8 5-5 5 5M5 14v6h14v-6"/></svg>',
  bookmark: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>',
  play: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>',
}[name] || '');

function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function compact(value = 0) { return Intl.NumberFormat('en', { notation: value > 999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value); }
function ago(value) { const seconds = Math.max(1, Math.floor((Date.now() - Date.parse(value)) / 1000)); if (seconds < 60) return 'now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`; if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`; return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)); }
function profileUrl(id) { return id === 'roster' ? '/people.html' : `/profile.html?id=${encodeURIComponent(id)}`; }
function linkify(value = '') { return escapeHtml(value).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/(^|\s)(#[\w-]+)/g, '$1<a href="/people.html?tab=search&q=$2">$2</a>').replace(/(^|\s)(@[\w.-]+)/g, '$1<a href="/people.html?tab=search&q=$2">$2</a>'); }

/* Verification is not carried on feed posts, so it is resolved from the same
   trusted profile record the profile page uses: /api/profile returns the stored
   verified and verified_owner state for that account. Nothing is inferred from a
   display name, no badge is drawn until the account's own record answers, and a
   member the viewer cannot see simply gets no badge. Answers are cached per
   author for the life of the page so one request covers all their posts. */
const verification = new Map();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badgeMarkup(status) {
  if (!status) return '';
  if (status.verified_owner === true) return '<span class="official-gold-badge roster-verification" data-tier="founder" role="img" aria-label="Official founder account">\u2713</span>';
  if (status.verified === true) return '<span class="member-verified-badge roster-verification" data-tier="verified" role="img" aria-label="Verified on the ROOSTER">\u2713</span>';
  return '';
}

async function resolveVerification(id) {
  if (!UUID.test(id)) return null;
  if (verification.has(id)) return verification.get(id);
  const pending = (async () => {
    try {
      const body = await request(`/api/profile?id=${encodeURIComponent(id)}`);
      const record = body && body.profile;
      if (!record) return null;
      return { verified: record.verified === true, verified_owner: record.verified_owner === true };
    } catch { return null; }
  })();
  verification.set(id, pending);
  const status = await pending;
  verification.set(id, status);
  return status;
}

async function paintVerification(root = document) {
  const slots = [...root.querySelectorAll('[data-verify-author]')];
  const ids = [...new Set(slots.map(slot => slot.dataset.verifyAuthor))];
  await Promise.all(ids.map(async id => {
    const status = await resolveVerification(id);
    const markup = badgeMarkup(status);
    if (!markup) return;
    document.querySelectorAll(`[data-verify-author="${id}"]`).forEach(slot => {
      if (!slot.childElementCount) slot.innerHTML = markup;
    });
  }));
}

function mediaMarkup(post) {
  const media = post.media?.[0];
  if (post.content_type === 'voice_post') return `<div class="post-media roster-media roster-media--voice"><button class="voice-play" type="button" aria-label="Play voice note">${icon('play')}</button><div class="waveform" aria-hidden="true"></div><small>${media?.duration_ms ? Math.ceil(media.duration_ms / 1000) + ' sec' : 'Voice note'}</small></div>`;
  if (!media) return '';
  if (media.type === 'video') return `<div class="post-media roster-media"><video controls muted preload="metadata" playsinline data-slots-autoplay poster="${escapeHtml(media.thumbnail_url || '')}"><source src="${escapeHtml(media.url)}"></video></div>`;
  if (media.type === 'audio') return songMarkup(post, media);
  const images = post.media.filter(item => item.type === 'image');
  if (images.length > 1) return `<div class="post-media roster-media slots-carousel" aria-label="${images.length} photos">${images.map((item,index) => `<img loading="lazy" src="${escapeHtml(item.url)}" alt="${escapeHtml(item.alt || `Photo ${index + 1}`)}" width="${item.width || 1200}" height="${item.height || 900}">`).join('')}</div>`;
  return `<div class="post-media roster-media"><img loading="lazy" src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt || '')}" width="${media.width || 1200}" height="${media.height || 900}"></div>`;
}

function songMarkup(post, media) {
  const metadata = post.metadata || {};
  const title = metadata.title || post.body || 'Shared song';
  const artist = metadata.artist || post.author.name;
  const art = media.thumbnail_url || metadata.artwork_url || post.author.photo_url || '/roster-icon-192.png';
  const count = Number.isFinite(metadata.play_count) ? metadata.play_count : post.counts.views;
  const profile = profileUrl(post.author.id);
  const musicHref = `${profile}${profile.includes('?') ? '&' : '?'}view=songs`;
  return `<div class="slots-song-card"><img class="slots-song-art" loading="lazy" src="${escapeHtml(art)}" alt=""><div class="slots-song-copy"><b>${escapeHtml(title)}</b><span>${escapeHtml(artist)}</span><div class="slots-song-wave" aria-hidden="true"></div><small class="slots-song-count">${icon('play')} ${compact(count)} listens</small></div><a class="slots-song-play" href="${escapeHtml(musicHref)}" aria-label="Open ${escapeHtml(title)} in Profile Music">${icon('play')}</a></div>`;
}

function roomMarkup(post) {
  if (post.content_type !== 'room_post' || !post.room_id) return '';
  const metadata = post.metadata || {};
  return `<div class="slots-room-post"><div><small>● LIVE ${metadata.medium === 'video' ? 'VIDEO' : 'ROOM'}</small><b>${escapeHtml(metadata.title || post.body || 'Live on ROOSTER')}</b><span>${escapeHtml(metadata.host_name || post.author.name)} · ${compact(metadata.speakers || 1)} speakers · ${compact(metadata.listeners || 0)} listening</span></div><a href="/live.html?room=${encodeURIComponent(post.room_id)}">Join</a></div>`;
}

function bookingMarkup(post) {
  if (!post.booking) return '';
  return `<div class="post-booking"><div><b>Available through ROOSTER Booking</b><span>Open the provider page to see live availability.</span></div><a href="/booking?business=${post.booking.business_id}">${escapeHtml(post.booking.label || 'Book now')}</a></div>`;
}

function isProfileClip(post) {
  return post.metadata?.origin === 'profile_clip' && /^[a-f0-9]{64}$/.test(post.metadata?.clip_source?.id || '');
}

function clipOriginMarkup(post) {
  if (!isProfileClip(post)) return '';
  return `<a class="roster-clip-origin" href="${profileUrl(post.author.id)}&view=posts#clips" aria-label="More clips from ${escapeHtml(post.author.name)}">${icon('play')}<b>New clip</b><span>More from ${escapeHtml(post.author.name)} ↗</span></a>`;
}

function postMarkup(post) {
  const kind = isProfileClip(post) ? 'New clip' : post.content_type.replace(/_/g, ' ').replace(' post', '');
  const href = profileUrl(post.author.id);
  const connect = post.author.id === 'roster' ? '' : `<a class="slots-connect-link" href="${href}#friend-space">Connect</a>`;
  return `<article class="roster-post${post.featured ? ' is-featured' : ''}" data-post-id="${post.id}">
    <a href="${href}" tabindex="-1" aria-hidden="true"><img class="roster-avatar" loading="lazy" src="${escapeHtml(post.author.photo_url || '/roster-icon-192.png')}" alt=""></a>
    <div class="roster-post-body">
      <header class="roster-post-header"><a href="${href}">${escapeHtml(post.author.name)}</a><span data-verify-author="${escapeHtml(post.author.id)}"></span><span class="roster-post-meta">${escapeHtml(post.author.kind)} · ${ago(post.published_at)}</span>${post.metadata?.location?`<span class="roster-post-location">${escapeHtml(post.metadata.location)}</span>`:''}${connect}<span class="roster-post-kind">${escapeHtml(kind)}</span></header>
      ${post.content_type !== 'room_post' && post.body ? `<div class="roster-post-text">${linkify(post.body)}</div>` : ''}${roomMarkup(post) || mediaMarkup(post)}${clipOriginMarkup(post)}${bookingMarkup(post)}
      <footer class="roster-actions">
        <button class="roster-action${post.viewer.liked ? ' is-active' : ''}" type="button" data-post-action="like" aria-pressed="${post.viewer.liked}">${icon('heart')}<span class="roster-action-label">YEP</span><b>${compact(post.counts.likes)}</b></button>
        <button class="roster-action" type="button" data-post-action="comment">${icon('comment')}<span class="roster-action-label">Reply</span><b>${compact(post.counts.comments)}</b></button>
        <button class="roster-action${post.viewer.reposted ? ' is-active' : ''}" type="button" data-post-action="repost" aria-pressed="${post.viewer.reposted}">${icon('repost')}<span class="roster-action-label">Repost</span><b>${compact(post.counts.reposts)}</b></button>
        <button class="roster-action" type="button" data-post-action="share">${icon('share')}<span class="roster-action-label">Share</span></button>
        <button class="roster-action${post.viewer.bookmarked ? ' is-active' : ''}" type="button" data-post-action="bookmark" aria-pressed="${post.viewer.bookmarked}">${icon('bookmark')}<span class="roster-action-label">Save</span></button>
        ${post.viewer.can_delete ? '<button class="roster-action roster-action-delete" type="button" data-post-action="delete"><span class="roster-action-label">Delete</span></button>' : ''}
      </footer>
    </div></article>`;
}

function renderRooms(rooms = []) {
  stage.liveRooms = rooms.length;
  if (typeof paintPulse === 'function') paintPulse();
  if (!rooms.length) { roomList.innerHTML = `<a class="room-card is-idle" href="/live.html"><span class="room-avatar-stack"><img src="/roster-icon-192.png" alt=""></span><span><small>ROOMS</small><b>Start a room</b><span>No live room right now</span></span><strong>Start</strong></a>`; return; }
  roomList.innerHTML = rooms.map(room => `<a class="room-card" href="/live.html?room=${encodeURIComponent(room.key)}"><span class="room-avatar-stack"><img src="/roster-icon-192.png" alt=""></span><span><small>● LIVE ROOM</small><b>${escapeHtml(room.title)}</b><span>Hosted by ${escapeHtml(room.host_name)} · ${compact(room.listeners)} listening</span></span><strong>Join</strong></a>`).join('');
}

let inlineVideoObserver;
function watchInlineVideos(root = document) {
  inlineVideoObserver?.disconnect();
  inlineVideoObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting && entry.intersectionRatio >= .7) {
      root.querySelectorAll('video[data-slots-autoplay]').forEach(other => { if (other !== video) other.pause(); });
      video.muted = true;
      window.RosterMediaBus?.claim?.(video);
      video.play().catch(() => {});
    }
    else video.pause();
  }), { threshold: [0, .7, 1] });
  root.querySelectorAll('video[data-slots-autoplay]').forEach(video => inlineVideoObserver.observe(video));
}
function renderBusinesses(businesses = []) {
  if (!businesses.length) { businessList.innerHTML = '<p class="context-loading">Providers appear here when their booking pages go live.</p>'; return; }
  businessList.innerHTML = businesses.map(item => `<div class="business-card"><img loading="lazy" src="${escapeHtml(item.logo_url || '/roster-icon-192.png')}" alt=""><div><b>${escapeHtml(item.name)}</b><span>${escapeHtml([item.city, item.region].filter(Boolean).join(', ') || 'Book online')}</span></div><a href="/book/${encodeURIComponent(item.slug)}">Book</a></div>`).join('');
}

/* ============================================================
   THE VERTICAL STAGE — For You and Following

   One panel at a time in a scroll-snapping column, filling the space between
   the compact header and the navigation. It renders the posts the existing
   feed API already ranks: a video post plays on the stage, a photo post fills
   it, and a text or song post reads as a quiet panel in the same column.
   Nothing is invented — every panel is a real post, every count on the rail
   comes from that post's own record, and the actions are the same ones the
   Board uses, so a like here is the same like there.

   Playback: only the panel in view plays, it starts muted so the browser
   allows it inline, one sound control covers the column, a panel the member
   paused stays paused, and a browser that refuses to autoplay gets a plain
   play button instead of a silent failure. */
const stage = { panels: [], active: null, observer: null, paused: new Set(), autoPauses: new WeakSet(), resumeId: null, motion: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, spokenId: null, learnTimer: null, learned: new Set(), caught: new Set(), liveRooms: 0 };
const stageTap = { postId: null, at: 0 };

/* A familiar two-tap gesture, wired to the real Like button so its optimistic
   state, saved count and error rollback stay in one place. The burst is only
   feedback; it never pretends a like happened if the post was already liked. */
function burstStageHeart(panel) {
  panel.querySelector('.fyp-heart-burst')?.remove();
  const burst = document.createElement('span');
  burst.className = 'fyp-heart-burst';
  burst.setAttribute('aria-hidden', 'true');
  burst.innerHTML = icon('heart');
  panel.querySelector('.roster-media-stage, .roster-quiet-stage')?.append(burst);
  burst.addEventListener('animationend', () => burst.remove(), { once: true });
  setTimeout(() => burst.remove(), 900);
}

stageColumn?.addEventListener('pointerup', event => {
  if (event.button !== 0 || event.target.closest('a, button, input, textarea, select, audio')) return;
  const panel = event.target.closest('.roster-clip-panel');
  if (!panel) return;
  const postId = Number(panel.dataset.postId);
  const now = performance.now();
  const isDoubleTap = stageTap.postId === postId && now - stageTap.at < 360;
  stageTap.postId = isDoubleTap ? null : postId;
  stageTap.at = isDoubleTap ? 0 : now;
  if (!isDoubleTap) return;
  const post = state.posts.get(postId);
  const likeButton = panel.querySelector('[data-post-action="like"]');
  if (!post || post.viewer.liked || !likeButton) return;
  burstStageHeart(panel);
  likeButton.click();
});

function stageMedia(post) {
  const media = post.media?.[0];
  if (media && media.type === 'video') return { kind: 'video', media };
  if (media && media.type === 'image') return { kind: 'photo', media };
  if (media) return { kind: 'audio', media };
  return { kind: 'text', media: null };
}

function railButton(action, label, glyph, count) {
  const pressed = action === 'like' ? 'liked' : action === 'repost' ? 'reposted' : action === 'bookmark' ? 'bookmarked' : null;
  return { action, label, glyph, count, pressed };
}

const starterPromos = nextPromoOrder();

let discoveryCache = { at: 0, stories: [], pending: null };
function loadDiscovery() {
  if (Date.now() - discoveryCache.at < 15 * 60_000) return Promise.resolve(discoveryCache.stories);
  if (discoveryCache.pending) return discoveryCache.pending;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12500);
  discoveryCache.pending = fetch('/api/slots/discover', {headers: {Accept: 'application/json'}, signal: controller.signal})
    .then(async response => { if (!response.ok) throw new Error('News unavailable'); const body = await response.json(); if (!Array.isArray(body.stories)) throw new Error('News unavailable'); discoveryCache = {at: Date.now(), stories: body.stories, pending: null}; return body.stories; })
    .catch(() => discoveryCache.stories)
    .finally(() => { clearTimeout(timer); discoveryCache.pending = null; });
  return discoveryCache.pending;
}

function starterPromoMarkup(promo) {
  const visual = promo.video
    ? `<video class="roster-clip-video" playsinline loop muted preload="auto" poster="${escapeHtml(promo.poster || '')}" aria-label="${escapeHtml(promo.title)} ROOSTER sponsored preview"><source src="${escapeHtml(promo.video)}" type="video/mp4"></video>`
    : `<img loading="lazy" src="${escapeHtml(promo.poster)}" alt="${escapeHtml(promo.copy)} Apply on ROOSTER.">`;
  const disclosure = promo.campaign ? `${promo.sponsor} · ${promo.category}` : `SPONSORED · ${promo.category || 'ROOSTER'}`;
  return `<article class="roster-clip-panel roster-starter-promo${promo.footage ? ' roster-video-ad' : ''}${promo.campaign ? ' roster-casting-ad' : ''}" data-post-id="promo-${escapeHtml(promo.id)}" data-kind="promo" data-silent-promo data-narration="${escapeHtml(promo.narration || '')}">
    <div class="roster-media-stage">${visual}
      <span class="slots-promo-mark slots-ad-category">${escapeHtml(disclosure)}</span>
      <div class="roster-starter-promo-copy">${promo.campaign ? '' : '<small>ROOSTER PREVIEW</small>'}<h2>${escapeHtml(promo.title)}</h2><p>${escapeHtml(promo.copy)}</p><a href="${escapeHtml(promo.href)}">${escapeHtml(promo.action)}</a><button class="roster-promo-sound" type="button" aria-label="Hear Mona narrate this promo">Hear Mona</button>${promo.video ? '<button class="roster-clip-play" type="button" hidden>Play promo</button>' : ''}</div>
    </div></article>`;
}

function newsPanelMarkup(story) {
  const category = story.category === 'sports' ? 'sports' : 'music';
  const date = new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric', year: 'numeric'}).format(new Date(story.published_at));
  const art = category === 'music'
    ? '<div class="slots-record"><i></i><b>R</b></div><div class="slots-equalizer">'+ '<i></i>'.repeat(12) + '</div>'
    : '<div class="slots-court"><i></i><b></b></div><div class="slots-ball"></div>';
  return `<article class="roster-clip-panel slots-news-panel slots-news-${category}" data-post-id="news-${escapeHtml(story.id)}" data-kind="news">
    <div class="slots-news-surface"><div class="slots-news-art" aria-hidden="true">${art}</div>
      <header class="slots-news-heading"><span>${category === 'music' ? 'MUSIC' : 'SPORTS'} NEWS</span><img src="/roster-mark-light.svg" width="38" height="38" alt="ROOSTER"></header>
      <div class="slots-news-copy"><p class="slots-news-source">${escapeHtml(story.source)} <span>·</span> <time datetime="${escapeHtml(story.published_at)}">${escapeHtml(date)}</time></p><h2>${escapeHtml(story.title)}</h2>
      <a class="slots-read-story" href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer">Read on ${escapeHtml(story.source)} <span aria-hidden="true">↗</span></a><small class="slots-news-note">Headline from ${escapeHtml(story.source)}. Opens the original story.</small></div>
    </div></article>`;
}

function mixedMarkup(posts, stories, {append = false, view = state.view} = {}) {
  return mixSlots(posts, stories, starterPromos, {view, append}).map(item => item.type === 'post' ? stagePanelMarkup(item.value) : item.type === 'news' ? newsPanelMarkup(item.value) : starterPromoMarkup(item.value)).join('');
}

function moveStage(direction) {
  if (!stage.panels.length) return;
  document.getElementById('slots-stage-controls').scrollIntoView({block: 'start', behavior: 'instant'});
  const current = Math.max(0, stage.panels.findIndex(panel => panel === stage.active));
  const next = stage.panels[Math.max(0, Math.min(stage.panels.length - 1, current + direction))];
  const top = stageColumn.scrollTop + next.node.getBoundingClientRect().top - stageColumn.getBoundingClientRect().top;
  stageColumn.scrollTo({top, behavior: stage.motion ? 'smooth' : 'instant'});
}

function paintPulse() {
  if (!pulse) return;
  const goal = Math.min(8, stage.panels.length);
  pulse.hidden = goal === 0;
  if (!goal) return;
  const caught = Math.min(goal, [...stage.caught].filter(id => stage.panels.some(panel => panel.id === id)).length);
  pulseCount.textContent = caught >= goal ? `Caught up on ${goal} fresh drops` : `${caught} of ${goal} fresh drops caught`;
  pulseFill.style.width = `${Math.round(caught / goal * 100)}%`;
  const meter = pulseFill.parentElement;
  meter.setAttribute('aria-valuemax', String(goal)); meter.setAttribute('aria-valuenow', String(caught));
  const activeIndex = Math.max(-1, stage.panels.findIndex(panel => panel === stage.active));
  const next = stage.panels[activeIndex + 1] || stage.panels.find(panel => !stage.caught.has(panel.id));
  const labels = {video: 'a new video', photo: 'a photo drop', audio: 'new music', text: 'a conversation', news: 'a fresh headline', promo: 'a ROOSTER spotlight'};
  pulseNext.textContent = next ? `Up next: ${labels[next.node.dataset.kind] || 'something fresh'}` : stage.liveRooms ? `${stage.liveRooms} live room${stage.liveRooms === 1 ? '' : 's'} moving now` : 'You’re caught up — check back for the next drop';
}

function paintStageControls() {
  const hasPanels = stage.panels.length > 0;
  document.getElementById('slots-stage-controls').hidden = !hasPanels;
  const index = stage.panels.findIndex(panel => panel === stage.active);
  document.getElementById('slots-previous').disabled = index <= 0;
  document.getElementById('slots-next').disabled = !hasPanels || index === stage.panels.length - 1;
  const motion = document.getElementById('slots-motion');
  motion.textContent = stage.motion ? 'Pause motion' : 'Play motion';
  motion.setAttribute('aria-pressed', String(!stage.motion));
  stageColumn.classList.toggle('slots-motion-paused', !stage.motion);
}

function stagePanelMarkup(post, index) {
  const { kind, media } = stageMedia(post);
  const href = profileUrl(post.author.id);
  const face = escapeHtml(post.author.photo_url || '/roster-icon-192.png');
  const surface = kind === 'video'
    ? `<video class="roster-clip-video" playsinline loop muted preload="none" controls poster="${escapeHtml(media.thumbnail_url || '')}" aria-label="Video by ${escapeHtml(post.author.name)}"><source src="${escapeHtml(media.url)}"></video>`
    : kind === 'photo'
      ? `<img class="roster-clip-photo" loading="lazy" src="${escapeHtml(media.url)}" alt="${escapeHtml(media.alt || '')}">`
      : kind === 'audio'
        ? `<div class="roster-clip-quiet">${songMarkup(post, media)}</div>`
        : `<div class="roster-clip-quiet"><p class="roster-post-text">${post.body ? linkify(post.body) : ''}</p></div>`;
  const rail = [
    railButton('like', 'YEP', icon('heart'), compact(post.counts.likes)),
    railButton('comment', 'Comments', icon('comment'), compact(post.counts.comments)),
    railButton('repost', 'Repost', icon('repost'), compact(post.counts.reposts)),
    railButton('bookmark', 'Save', icon('bookmark'), ''),
    railButton('share', 'Share', icon('share'), ''),
  ].map(item => {
    const on = item.pressed && post.viewer[item.pressed];
    const state = item.pressed ? ` aria-pressed="${on ? 'true' : 'false'}"` : '';
    const body = `<span class="roster-clip-rail-note">${item.label}</span>${item.count ? `<b>${item.count}</b>` : ''}`;
    return `<button class="roster-clip-rail-button${on ? ' is-active' : ''}" type="button" data-post-action="${item.action}"${state} aria-label="${item.label}">${item.glyph}${body}</button>`;
  }).join('');
  const caption = kind === 'text' || kind === 'audio' ? '' : (post.body ? `<p class="roster-video-caption">${linkify(post.body)}</p>` : '');
  const connect = post.author.id === 'roster' ? '' : `<a class="roster-clip-connect" href="${href}#friend-space">Connect</a>`;
  return `<article class="roster-clip-panel" data-post-id="${post.id}" data-kind="${kind}">
    <div class="${kind === 'video' || kind === 'photo' ? 'roster-media-stage' : 'roster-quiet-stage'}">
      ${surface}
      ${kind === 'video' ? '<button class="roster-clip-play" type="button" hidden>Play this video</button>' : ''}
      ${post.viewer.can_delete ? '<button class="roster-clip-delete" type="button" data-post-action="delete">Delete my post</button>' : ''}
      <div class="roster-clip-rail">
        <a class="roster-clip-face" href="${href}" aria-label="${escapeHtml(post.author.name)}'s profile"><img loading="lazy" src="${face}" alt=""></a>
        ${rail}
      </div>
      <div class="roster-clip-info">
        ${clipOriginMarkup(post)}
        <p class="roster-clip-who"><a href="${href}">${escapeHtml(post.author.name)}</a><span data-verify-author="${escapeHtml(post.author.id)}"></span>${connect}</p>
        ${caption}
        <small class="roster-meta">${escapeHtml(post.author.kind)} · ${ago(post.published_at)}</small>${post.metadata?.location?`<small class="roster-post-location">${escapeHtml(post.metadata.location)}</small>`:''}
      </div>
    </div>
  </article>`;
}

function stagePause(video) {
  if (!video) return;
  if (!video.paused) stage.autoPauses.add(video);
  try { video.pause(); } catch { stage.autoPauses.delete(video); }
}

/* Browsers expose different installed voices. Prefer a natural feminine
   English voice, without changing its pitch to imitate a younger speaker.
   Keep the utterance alive and wait for Chrome's asynchronous voice list. */
const promoSpeech = { generation: 0, line: null, panel: null, cancelWait: null };

function selectPromoVoice(voices = []) {
  const score = voice => {
    if (!/^en(?:[-_]|$)/i.test(voice.lang || '')) return -1;
    const name = `${voice.name || ''} ${voice.voiceURI || ''}`;
    const feminine = /\b(?:ava|samantha|allison|susan|victoria|jenny|aria|emma|michelle|ana|zira|karen|tessa|moira|serena)\b|\bfemale\b|google us english/i.test(name);
    const natural = /premium|enhanced|natural|neural|online/i.test(name);
    return (feminine ? 1000 : 0) + (natural ? 150 : 0)
      + (/^en[-_]US$/i.test(voice.lang) ? 80 : 0)
      + (/\b(?:ava|jenny|aria|samantha)\b/i.test(name) ? 40 : 0)
      + (voice.default ? 1 : 0);
  };
  return [...voices].filter(voice => score(voice) >= 0).sort((a, b) => score(b) - score(a))[0] || null;
}

function promoVoiceButton(panel, label, busy = false) {
  const button = panel?.node?.querySelector('.roster-promo-sound');
  if (!button) return;
  button.textContent = label;
  button.setAttribute('aria-label', label === 'Hear Mona' ? 'Hear Mona narrate this promo' : label);
  button.setAttribute('aria-busy', String(busy));
}

function stopPromoNarration() {
  promoSpeech.generation++;
  promoSpeech.cancelWait?.();
  promoSpeech.cancelWait = null;
  promoSpeech.line = null;
  promoVoiceButton(promoSpeech.panel, 'Hear Mona');
  promoSpeech.panel = null;
  stage.spokenId = null;
  try { globalThis.speechSynthesis?.cancel(); } catch {}
}

function speakPromo(panel, { force = false } = {}) {
  const words = panel?.node?.dataset?.narration?.trim();
  if (!state.sound || !words || stage.active !== panel || document.visibilityState === 'hidden') return false;
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof globalThis.SpeechSynthesisUtterance !== 'function') {
    promoVoiceButton(panel, 'Mona voice unavailable on this browser');
    return false;
  }
  if (!force && stage.spokenId === panel.id) return true;
  stopPromoNarration();
  const generation = promoSpeech.generation;
  promoSpeech.panel = panel;
  stage.spokenId = panel.id;
  promoVoiceButton(panel, 'Loading Mona…', true);
  const current = () => generation === promoSpeech.generation && state.sound
    && stage.active === panel && document.visibilityState !== 'hidden';
  const voices = () => { try { return synth.getVoices(); } catch { return []; } };
  const start = () => {
    promoSpeech.cancelWait?.();
    promoSpeech.cancelWait = null;
    if (!current()) return;
    try {
      const line = new globalThis.SpeechSynthesisUtterance(words.replace(/\bROOSTER\b/g, 'Rooster').replace(/\bORBIT\b/g, 'Orbit'));
      const voice = selectPromoVoice(voices());
      if (voice) line.voice = voice;
      line.lang = voice?.lang || 'en-US';
      line.rate = 1.02;
      line.pitch = 1;
      line.volume = 1;
      promoSpeech.line = line;
      line.onstart = () => { if (current()) promoVoiceButton(panel, 'Stop Mona'); };
      line.onend = () => {
        if (!current() || promoSpeech.line !== line) return;
        promoSpeech.line = null;
        promoVoiceButton(panel, 'Replay Mona');
      };
      line.onerror = () => {
        if (!current() || promoSpeech.line !== line) return;
        promoSpeech.line = null;
        stage.spokenId = null;
        promoVoiceButton(panel, 'Tap to retry Mona');
      };
      synth.speak(line);
    } catch {
      if (current()) { stage.spokenId = null; promoSpeech.line = null; promoVoiceButton(panel, 'Tap to retry Mona'); }
    }
  };
  if (voices().length) start();
  else {
    const ready = () => { if (voices().length) start(); };
    const timeout = setTimeout(start, 900);
    synth.addEventListener?.('voiceschanged', ready);
    promoSpeech.cancelWait = () => { clearTimeout(timeout); synth.removeEventListener?.('voiceschanged', ready); };
  }
  return true;
}

function stagePauseAll() {
  if (stage.learnTimer) clearTimeout(stage.learnTimer); stage.learnTimer = null;
  stage.resumeId = stage.active?.id || stage.resumeId;
  stage.panels.forEach(panel => { stagePause(panel.video); panel.node.classList.remove('is-stage-active'); });
  stopPromoNarration();
  stage.active = null;
}

function stageActivate(panel) {
  if (document.visibilityState === 'hidden' || state.view === 'board') return;
  if (stage.active === panel) return;
  if (stage.active) { stagePause(stage.active.video); stage.active.node.classList.remove('is-stage-active'); stopPromoNarration(); }
  stage.active = panel;
  panel?.node.classList.add('is-stage-active');
  if (panel?.id) stage.caught?.add(panel.id);
  if (typeof paintPulse === 'function') paintPulse();
  paintStageControls();
  if (stage.learnTimer) clearTimeout(stage.learnTimer); stage.learnTimer = null;
  const learnedPostId = Number(panel?.id);
  if (Number.isSafeInteger(learnedPostId) && learnedPostId > 0 && !stage.learned.has(learnedPostId)) {
    stage.learnTimer = setTimeout(() => {
      if (stage.active !== panel || document.visibilityState === 'hidden') return;
      stage.learned.add(learnedPostId);
      void request('/api/community/feed', {method: 'PATCH', body: JSON.stringify({post_id: learnedPostId, action: 'view', watch_ms: 2500})}).catch(() => { stage.learned.delete(learnedPostId); });
    }, 2500);
  }
  if (!panel?.video) {
    if (stage.motion && panel?.node.hasAttribute('data-silent-promo')) speakPromo(panel);
    return;
  }
  if (!stage.motion || stage.paused.has(panel.id)) { if (panel.play) panel.play.hidden = false; return; }
  const silentPromo = panel.node.hasAttribute('data-silent-promo');
  panel.video.muted = silentPromo || !state.sound;
  if (state.sound && !silentPromo) window.RosterMediaBus?.claim?.(panel.video);
  panel.video.play().then(() => { if (panel.play) panel.play.hidden = true; }).catch(() => { if (panel.play) panel.play.hidden = false; });
  if (silentPromo) speakPromo(panel);
}

function stageWatch() {
  const activeId = stage.active?.id;
  stage.observer?.disconnect();
  stage.panels = [...stageColumn.querySelectorAll('.roster-clip-panel')].map(node => {
    const video = node.querySelector('video');
    const play = node.querySelector('.roster-clip-play');
    const id = node.dataset.postId;
    if (video && !video.dataset.slotsBound) {
      video.dataset.slotsBound = 'true';
      video.addEventListener('pause', () => {
        if (stage.autoPauses.has(video)) { stage.autoPauses.delete(video); return; }
        if (document.visibilityState === 'visible') {
          stage.paused.add(id);
          if (node.hasAttribute('data-silent-promo') && stage.active?.id === id) stopPromoNarration();
        }
      });
      video.addEventListener('play', () => {
        stage.paused.delete(id); if (play) play.hidden = true;
        if (node.hasAttribute('data-silent-promo') && stage.active?.id === id) speakPromo(stage.active);
      });
      video.addEventListener('volumechange', () => {
        if (node.hasAttribute('data-silent-promo')) { if (!video.muted) video.muted = true; return; }
        if (!video.muted) { state.sound = true; paintSound(); }
      });
      if (play) play.addEventListener('click', () => {
        stage.paused.delete(id); video.muted = node.hasAttribute('data-silent-promo') || !state.sound;
        video.play().then(() => { play.hidden = true; }).catch(() => {});
      });
    }
    return { node, video, play, id };
  });
  stage.active = stage.panels.find(panel => panel.id === activeId) || null;
  if (typeof paintPulse === 'function') paintPulse();
  paintStageControls();
  stage.observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting && entry.intersectionRatio >= 0.45)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    const next = visible.length ? stage.panels.find(item => item.node === visible[0].target) : null;
    if (next) {
      stageActivate(next);
      const nextIndex = stage.panels.indexOf(next);
      if (nextIndex >= stage.panels.length - 3 && state.cursor && !state.loading) void loadStage({ append: true });
      return;
    }
    const activeEntry = entries.find(entry => stage.active?.node === entry.target);
    if (activeEntry && !activeEntry.isIntersecting) {
      stagePause(stage.active.video);
      stage.active.node.classList.remove('is-stage-active');
      stopPromoNarration();
      stage.active = null;
    }
  }, { root: stageColumn, rootMargin: '-8% 0px -8% 0px', threshold: [0, 0.45, 0.7, 0.9] });
  stage.panels.forEach(panel => stage.observer.observe(panel.node));
}

function paintSound() {
  if (!stageSound) return;
  stageSound.setAttribute('aria-pressed', String(state.sound));
  stageSound.textContent = state.sound ? 'Sound is on' : 'Turn sound on';
}

async function loadStage({ append = false } = {}) {
  if (!stageColumn || state.loading) return;
  state.loading = true;
  if (!append) state.generation++;
  const generation = state.generation;
  const view = state.view;
  const discovery = !append && view === 'for_you' ? loadDiscovery() : Promise.resolve([]);
  const quickDiscovery = () => Promise.race([discovery, new Promise(resolve => setTimeout(() => resolve([]), 400))]);
  const addLaterNews = (initialStories) => {
    if (append || view !== 'for_you' || initialStories.length) return;
    void discovery.then(stories => {
      if (generation !== state.generation || state.view !== 'for_you' || !stories.length) return;
      const existingIds = new Set([...stageColumn.querySelectorAll('[data-kind=news]')].map(node => node.dataset.postId));
      const later = mixSlots([], stories, []).filter(item => item.type === 'news' && !existingIds.has(item.key));
      if (later.length) { stageColumn.insertAdjacentHTML('beforeend', later.map(item => newsPanelMarkup(item.value)).join('')); stageWatch(); }
    });
  };
  if (stageRetry) stageRetry.hidden = true;
  if (!append) {
    stagePauseAll();
    state.cursor = null;
    state.posts.clear();
    stage.observer?.disconnect();
    stage.panels = [];
    stage.active = null;
    stageColumn.replaceChildren();
    if (stageSound) stageSound.hidden = true;
    stageStatus.hidden = false;
    stageStatus.textContent = state.view === 'following' ? 'Opening Following…' : 'Opening the feed…';
  }
  const query = new URLSearchParams({ filter: state.filter, connection: state.connection, limit: '10' });
  if (state.cursor) query.set('cursor', state.cursor);
  try {
    const data = await request(`/api/community/feed?${query}`);
    const stories = await quickDiscovery();
    if (generation !== state.generation) return;
    const freshPosts = data.posts.filter(post => !state.posts.has(post.id));
    data.posts.forEach(post => state.posts.set(post.id, post));
    stageColumn.insertAdjacentHTML('beforeend', mixedMarkup(freshPosts, stories, {append, view}));
    state.cursor = data.next_cursor;
    stageStatus.hidden = true;
    // Badges come from the stored trusted-account flags, the same resolver the
    // Board uses. Nobody is checked because of their name.
    void paintVerification(stageColumn);
    if (!append) { renderRooms(data.rooms); renderBusinesses(data.businesses); }
    stageWatch();
    addLaterNews(stories);
    if (stageSound) { stageSound.hidden = !stage.panels.some(panel => panel.video || panel.node.hasAttribute('data-silent-promo')); paintSound(); }
    if (!state.posts.size && state.view === 'following') {
      stageStatus.hidden = false;
      stageStatus.innerHTML = '<b>Nothing from the people you follow yet.</b><br>Add somebody to your roster and their clips and posts land here.';
    }
  } catch (error) {
    const stories = await quickDiscovery();
    if (generation !== state.generation) return;
    stageStatus.hidden = false;
    const locked = error.status === 401 || error.status === 403;
    stageStatus.innerHTML = locked
      ? '<div class="slots-locked"><span>WELCOME TO ROOSTER</span><b>Your people. Your work. Your moment.</b><p>Log in if you are already approved, or request an invite to join.</p><div><a href="/members.html">Log In</a><a href="/members.html#request-invite">Request Invite</a></div></div>'
      : escapeHtml(error.message);
    if (stageRetry) stageRetry.hidden = locked;
    renderRooms([]);
    if (!append && view === 'for_you') {
      stageColumn.insertAdjacentHTML('beforeend', mixedMarkup([], stories, {view}));
      stageWatch();
      if (stage.panels.length) stageStatus.hidden = true;
      if (stageSound) { stageSound.hidden = !stage.panels.some(panel => panel.video || panel.node.hasAttribute('data-silent-promo')); paintSound(); }
      addLaterNews(stories);
    }
  } finally { if (generation === state.generation) state.loading = false; }
}

function showView(view) {
  state.generation++; state.loading = false;
  state.view = view;
  const onBoard = view === 'board';
  state.filter = onBoard ? state.boardFilter : view;
  if (stageSection) stageSection.hidden = onBoard;
  if (boardSection) boardSection.hidden = !onBoard;
  if (stageSection) stageSection.setAttribute('aria-label', view === 'following' ? 'Following' : 'For You');
  document.querySelectorAll('[data-feed-view]').forEach(button => {
    const on = button.dataset.feedView === view;
    button.classList.toggle('is-active', on);
    if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(on));
  });
  if (onBoard) { stagePauseAll(); void loadFeed(); }
  else void loadStage();
}

async function request(url, options = {}) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (url.startsWith('/api/community/feed') && (response.ok || response.status === 401)) {
    const loggedIn = response.ok;
    const login = document.querySelector('.header-login');
    const profile = document.querySelector('.header-profile');
    if (login) login.hidden = loggedIn;
    if (profile) profile.hidden = !loggedIn;
  }
  if (!response.ok) { const error = new Error(body.error || 'ROOSTER could not connect.'); error.status = response.status; throw error; }
  return body;
}

async function loadFeed({ append = false } = {}) {
  if (state.loading) return; state.loading = true; feedMore.disabled = true;
  if (!append) state.generation++;
  const generation = state.generation;
  if (feedRetry) feedRetry.hidden = true;
  if (!append) { state.cursor = null; state.posts.clear(); feedList.innerHTML = ''; feedStatus.hidden = false; feedStatus.textContent = 'Opening the feed…'; }
  const params = new URLSearchParams({ filter: state.filter, connection: state.connection, limit: '10' }); if (state.cursor) params.set('cursor', state.cursor);
  try {
    const data = await request(`/api/community/feed?${params}`);
    if (generation !== state.generation) return;
    data.posts.forEach(post => state.posts.set(post.id, post));
    feedList.insertAdjacentHTML('beforeend', data.posts.map(postMarkup).join(''));
    state.cursor = data.next_cursor;
    feedMore.hidden = !state.cursor; feedStatus.hidden = true;
    if (!append) { renderRooms(data.rooms); renderBusinesses(data.businesses); applyPreference(data.preference); }
    if (!state.posts.size) { feedStatus.hidden = false; feedStatus.innerHTML = `<b>This lane is quiet right now.</b><br>Be the first person to post here.`; }
    void paintVerification();
    watchInlineVideos(feedList);
    if (!append) restoreFeedScroll();
  } catch (error) {
    if (generation !== state.generation) return;
    feedMore.hidden = true; feedStatus.hidden = false;
    const locked = error.status === 401 || error.status === 403;
    feedStatus.innerHTML = locked ? `<b>WYD is for approved ROOSTER members.</b><br><a href="/members.html">Log in or request an invite</a> to enter WYD.` : escapeHtml(error.message);
    // A failure the member can act on: one clear retry, no invented posts.
    if (feedRetry) feedRetry.hidden = locked;
    roomList.innerHTML = `<a class="room-card" href="/live.html"><span class="room-avatar-stack"><img src="/roster-icon-192.png" alt=""></span><span><b>ROOSTER LIVE</b><span>Log in to see active rooms</span></span></a>`;
  } finally { if (generation === state.generation) { state.loading = false; feedMore.disabled = false; } }
}

/* Coming back from a profile, a thread or a media viewer returns the member to
   the post they left, once, after the first page of the same lane has painted. */
const SCROLL_KEY = 'roster-feed-scroll';
function rememberFeedScroll() {
  if (!feedList) return;
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ filter: state.filter, connection: state.connection, y: Math.round(window.scrollY) })); } catch {}
}
function restoreFeedScroll() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null'); } catch {}
  try { sessionStorage.removeItem(SCROLL_KEY); } catch {}
  if (!saved || saved.filter !== state.filter || saved.connection !== state.connection || !(saved.y > 0)) return;
  requestAnimationFrame(() => window.scrollTo({ top: saved.y, behavior: 'auto' }));
}
window.addEventListener('pagehide', rememberFeedScroll);
document.addEventListener('click', event => { if (event.target.closest('#feed-list a[href], .roster-clip-info a[href]')) rememberFeedScroll(); }, true);

function activate(selector, attribute, value) {
  document.querySelectorAll(selector).forEach(button => {
    const on = button.dataset[attribute] === value;
    button.classList.toggle('is-active', on);
    // Tabs announce their own state; plain filter chips are left alone.
    if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(on));
  });
}
/* A saved preference owns the Board's sort and the connection filter. It does
   not choose the view: For You is the front door either way. */
function applyPreference(preference) { if (!preference || sessionStorage.getItem('roster-feed-touched')) return; state.boardFilter = preference.primary_filter || state.boardFilter; state.connection = preference.connection_filters?.[0] || state.connection; if (state.view === 'board') state.filter = state.boardFilter; activate('[data-feed-filter]', 'feedFilter', state.boardFilter); activate('[data-connection-filter]', 'connectionFilter', state.connection); }

function cameraMessage(message, link = null) {
  if (!cameraStatus) return;
  cameraStatus.replaceChildren(document.createTextNode(message));
  if (link) {
    cameraStatus.append(document.createTextNode(' '));
    const anchor = document.createElement('a');
    anchor.href = link.href;
    anchor.textContent = link.label;
    cameraStatus.append(anchor);
  }
}

async function takeSlotsPhoto(button) {
  button.disabled = true;
  cameraMessage('Checking your camera…');
  try {
    await request('/api/profile/me');
    if (composerDialog?.open) composerDialog.close();
    const requestId=crypto.randomUUID();
    const result = await openRosterCamera({title: 'New photo post', aspect: 4 / 5,postComposer:true,onShare:async draft=>{
      const form = new FormData();form.set('photo',draft.file);form.set('caption',draft.caption);
      const saved=await request('/api/member-album/upload',{method:'POST',body:form});
      const created=await request('/api/community/feed',{method:'POST',body:JSON.stringify({body:draft.caption,content_type:'photo_post',visibility:'public',metadata:{location:draft.location,album_photo:{id:saved.photo.id},photo_request_id:requestId}})});
      return {post:created.post,duplicate:created.duplicate===true};
    }});
    if (!result) { cameraMessage('No photo saved.'); return; }
    const post=result.post;state.posts.set(post.id,post);
    if(state.view==='board'){feedList.insertAdjacentHTML('afterbegin',postMarkup(post));feedStatus.hidden=true;}
    else{stageColumn.insertAdjacentHTML('afterbegin',stagePanelMarkup(post));stageWatch();stageColumn.scrollTo({top:0,behavior:stage.motion?'smooth':'instant'});}
    void paintVerification(state.view==='board'?feedList:stageColumn);
    cameraMessage(result.duplicate?'Your photo post was already shared.':'Your photo is live on WYD.');
  } catch (error) {
    const signedOut = error.status === 401 || error.status === 403;
    cameraMessage(signedOut ? 'Log in first to take and save a photo.' : error.message, signedOut ? {href: '/members.html', label: 'Log in'} : {href: '/members.html?editor=photo#member-photo-album', label: 'Open My Photos'});
  } finally { button.disabled = false; }
}

function deletionMessage(message, keepVisible = false) {
  const target = state.view === 'board' ? feedStatus : stageStatus;
  if (!target) return;
  target.hidden = false;
  target.textContent = message;
  if (!keepVisible && state.posts.size) setTimeout(() => { if (target.textContent === message) target.hidden = true; }, 2600);
}

async function deleteSlotsPost(post, card, button) {
  if (!post?.viewer?.can_delete) return;
  if (!window.confirm('Delete this WYD post? This cannot be undone.')) return;
  button.disabled = true;
  try {
    await request('/api/community/feed', {method: 'DELETE', body: JSON.stringify({post_id: post.id})});
    state.posts.delete(post.id);
    stage.paused.delete(String(post.id));
    stagePause(card.querySelector('video'));
    card.remove();
    if (state.view !== 'board') {
      stageWatch();
      if (stageSound) { stageSound.hidden = !stage.panels.some(panel => panel.video || panel.node.hasAttribute('data-silent-promo')); paintSound(); }
      if (stage.panels[0]) stageActivate(stage.panels[0]);
    }
    deletionMessage(state.posts.size ? 'WYD post deleted.' : 'Your WYD post was deleted. This lane is empty now.', !state.posts.size);
  } catch (error) {
    button.disabled = false;
    deletionMessage(error.message, true);
  }
}

document.addEventListener('click', async event => {
  const close = event.target.closest('[data-close-dialog]'); if (close) return close.closest('dialog').close();
  const promoSound = event.target.closest('.roster-promo-sound');
  if (promoSound) {
    const panel = stage.panels.find(item => item.node === promoSound.closest('.roster-clip-panel'));
    if (promoSpeech.panel === panel && (promoSpeech.line || promoSpeech.cancelWait)) { state.sound = false; paintSound(); stopPromoNarration(); return; }
    state.sound = true;
    paintSound();
    if (panel) { stageActivate(panel); speakPromo(panel, { force: true }); panel.video?.play().catch(() => {}); }
    return;
  }
  const camera = event.target.closest('[data-slots-camera]'); if (camera) { await takeSlotsPhoto(camera); return; }
  const pulseAdvance = event.target.closest('[data-pulse-next]'); if (pulseAdvance) { moveStage(1); return; }
  const open = event.target.closest('[data-open-composer]'); if (open) { composerDialog.showModal(); document.querySelector('#post-body').focus(); return; }
  const more = event.target.closest('[data-open-more]'); if (more && moreSheet) { more.setAttribute('aria-expanded', 'true'); moreSheet.showModal(); moreSheet.querySelector('a, button')?.focus(); return; }
  const composeType = event.target.closest('[data-compose-type]'); if (composeType) { const mapping = { poll: 'poll_post', event: 'event_post', photo: 'photo_post', video: 'video_post', voice: 'voice_post' }; composerDialog.showModal(); document.querySelector('#post-type').value = mapping[composeType.dataset.composeType] || 'text_post'; document.querySelector('#post-body').placeholder = composeType.dataset.composeType === 'voice' ? 'Add a note to introduce your recording…' : 'What’s happening in your world?'; document.querySelector('#post-message').textContent = ''; return; }
  const view = event.target.closest('[data-feed-view]');
  if (view) {
    // The rail's Board link is a real href for anybody without scripting; with
    // scripting it switches the view in place.
    if (view.tagName === 'A') event.preventDefault();
    if (view.dataset.feedFilter) {
      state.boardFilter = view.dataset.feedFilter;
      sessionStorage.setItem('roster-feed-touched', '1');
    }
    showView(view.dataset.feedView);
    return;
  }
  const filter = event.target.closest('[data-feed-filter]'); if (filter) { state.boardFilter = filter.dataset.feedFilter; state.filter = state.boardFilter; sessionStorage.setItem('roster-feed-touched', '1'); activate('[data-feed-filter]', 'feedFilter', state.boardFilter); await loadFeed(); return; }
  const connection = event.target.closest('[data-connection-filter]'); if (connection) { state.connection = connection.dataset.connectionFilter; sessionStorage.setItem('roster-feed-touched', '1'); activate('[data-connection-filter]', 'connectionFilter', state.connection); if (state.view === 'board') await loadFeed(); else await loadStage(); return; }
  const save = event.target.closest('[data-save-feed]'); if (save) { try { await request('/api/community/feed?settings=feed', { method: 'PATCH', body: JSON.stringify({ primary_filter: state.boardFilter, connection_filters: [state.connection] }) }); save.style.color = 'var(--green)'; save.title = 'WYD settings saved'; } catch (error) { save.title = error.message; } return; }
  const actionButton = event.target.closest('[data-post-action]'); if (!actionButton) return;
  const card = actionButton.closest('[data-post-id]'); const post = state.posts.get(Number(card?.dataset.postId)); const action = actionButton.dataset.postAction;
  if (!card || !post) return;
  if (action === 'delete') { await deleteSlotsPost(post, card, actionButton); return; }
  if (action === 'share') { const url = `${location.origin}/?post=${post.id}`; try { if (navigator.share) await navigator.share({ title: `${post.author.name} on ROOSTER`, text: post.body, url }); else { await navigator.clipboard.writeText(url); actionButton.querySelector('span').textContent = 'Copied'; } } catch {} return; }
  if (action === 'comment') { state.commentPost = post; document.querySelector('#comment-original').innerHTML = `<b>${escapeHtml(post.author.name)}</b><br>${linkify(post.body).slice(0, 600)}`; commentDialog.showModal(); document.querySelector('#comment-body').focus(); return; }
  const viewerKey = action === 'like' ? 'liked' : action === 'bookmark' ? 'bookmarked' : 'reposted'; const countKey = action === 'like' ? 'likes' : action === 'bookmark' ? 'bookmarks' : 'reposts';
  const oldActive = post.viewer[viewerKey]; const oldCount = post.counts[countKey]; post.viewer[viewerKey] = !oldActive; post.counts[countKey] = Math.max(0, oldCount + (oldActive ? -1 : 1)); actionButton.classList.toggle('is-active', !oldActive); actionButton.setAttribute('aria-pressed', String(!oldActive)); const count = actionButton.querySelector('b'); if (count) count.textContent = compact(post.counts[countKey]);
  try { const result = await request('/api/community/feed', { method: 'PATCH', body: JSON.stringify({ post_id: post.id, action }) }); post.viewer[viewerKey] = result.active; post.counts[countKey] = result.count; actionButton.classList.toggle('is-active', result.active); if (count) count.textContent = compact(result.count); } catch { post.viewer[viewerKey] = oldActive; post.counts[countKey] = oldCount; actionButton.classList.toggle('is-active', oldActive); if (count) count.textContent = compact(oldCount); }
});

document.querySelector('#post-booking-toggle').addEventListener('change', event => { document.querySelector('#booking-fields').hidden = !event.target.checked; });
document.querySelector('#post-body').addEventListener('input', event => { document.querySelector('#post-count').textContent = `${event.target.value.length.toLocaleString()} / 5,000`; });
document.querySelector('#post-form').addEventListener('submit', async event => {
  event.preventDefault();
  // A SubmitEvent's currentTarget becomes null after the first await. Keep the
  // form itself now so a successful server response can always reset it.
  const form = event.currentTarget;
  const message = document.querySelector('#post-message');
  const submit = form.querySelector('[type="submit"]');
  const originalLabel = submit.textContent;
  let posted = false;
  form.setAttribute('aria-busy', 'true');
  submit.disabled = true;
  submit.textContent = 'Posting…';
  message.textContent = 'Sending your post…';
  const hasBooking = document.querySelector('#post-booking-toggle').checked;
  const payload = { body: document.querySelector('#post-body').value, content_type: document.querySelector('#post-type').value, visibility: document.querySelector('#post-visibility').value, ...(hasBooking ? { booking_business_id: document.querySelector('#post-business').value, booking_label: document.querySelector('#post-booking-label').value || 'Book now' } : {}) };
  try {
    const data = await request('/api/community/feed', { method: 'POST', body: JSON.stringify(payload) });
    state.posts.set(data.post.id, data.post);
    if (state.view === 'board') {
      feedList.insertAdjacentHTML('afterbegin', postMarkup(data.post));
      feedStatus.hidden = true;
      watchInlineVideos(feedList);
    } else {
      stageColumn.insertAdjacentHTML('afterbegin', stagePanelMarkup(data.post));
      stageWatch();
      stageColumn.scrollTo({top: 0, behavior: stage.motion ? 'smooth' : 'instant'});
    }
    void paintVerification(state.view === 'board' ? feedList : stageColumn);
    form.reset();
    document.querySelector('#post-count').textContent = '0 / 5,000';
    document.querySelector('#booking-fields').hidden = true;
    posted = true;
    submit.classList.add('is-posted');
    submit.textContent = 'Posted ✓';
    message.textContent = 'Your post is live.';
    await new Promise(resolve => setTimeout(resolve, 260));
    composerDialog.close();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    submit.classList.remove('is-posted');
    submit.textContent = originalLabel;
    if (posted) message.textContent = '';
  }
});
document.querySelector('#comment-form').addEventListener('submit', async event => {
  event.preventDefault(); const message = document.querySelector('#comment-message'); const body = document.querySelector('#comment-body'); const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true; message.textContent = 'Replying…';
  try { const result = await request('/api/community/feed', { method: 'PATCH', body: JSON.stringify({ post_id: state.commentPost.id, action: 'comment', body: body.value }) }); state.commentPost.counts.comments = result.count; const card = document.querySelector(`[data-post-id="${state.commentPost.id}"]`); const count = card?.querySelector('[data-post-action="comment"] b'); if (count) count.textContent = compact(result.count); body.value = ''; commentDialog.close(); } catch (error) { message.textContent = error.message; } finally { submit.disabled = false; }
});
feedMore.addEventListener('click', () => loadFeed({ append: true }));
document.querySelector('#global-search').addEventListener('keydown', event => { if (event.key === 'Enter' && event.currentTarget.value.trim()) location.href = `/people.html?tab=search&q=${encodeURIComponent(event.currentTarget.value.trim())}`; });
if (feedRetry) feedRetry.addEventListener('click', () => loadFeed());
if (moreSheet) moreSheet.addEventListener('close', () => {
  document.querySelectorAll('[data-open-more]').forEach(button => button.setAttribute('aria-expanded', 'false'));
});

/* The side chart reads the real weekly visitor chart. Nobody is placed there
   by hand and no count is written in. */
async function loadTopRoster() {
  if (!contextChart) return;
  if (contextChartStatus) { contextChartStatus.hidden = false; contextChartStatus.textContent = 'Counting this week\u2019s visitors…'; }
  try {
    const chart = await request('/api/top25');
    const entries = (Array.isArray(chart.entries) ? chart.entries : []).filter(entry => Number.isSafeInteger(entry.position));
    if (contextChart) contextChart.innerHTML = entries.slice(0, 5).map(entry => `<li><a href="${escapeHtml(entry.profile_url || '/people.html')}"><span aria-hidden="true">${String(entry.position).padStart(2, '0')}</span><span><b>${escapeHtml(entry.name || 'Somebody on the ROOSTER')}</b><small>${compact(Number.isSafeInteger(entry.visitors) ? entry.visitors : 0)} visitors this week</small></span></a></li>`).join('');
    // An empty chart says so in one line rather than filling up with nobody.
    if (contextChartStatus) { contextChartStatus.textContent = entries.length ? '' : 'Nobody is ranked yet this week.'; contextChartStatus.hidden = entries.length > 0; }
  } catch {
    if (contextChart) contextChart.innerHTML = '';
    if (contextChartStatus) { contextChartStatus.hidden = false; contextChartStatus.textContent = 'The chart could not load just now.'; }
  }
}
if (['confirmation_token','recovery_token','invite_token','email_change_token','access_token'].some(key => new URLSearchParams(location.hash.slice(1)).has(key))) location.replace('/members.html' + location.hash);
/* The stage's own controls, and the rule that nothing on it plays once the
   member has left it. */
document.getElementById('slots-previous')?.addEventListener('click', () => moveStage(-1));
document.getElementById('slots-next')?.addEventListener('click', () => moveStage(1));
document.getElementById('slots-motion')?.addEventListener('click', () => {
  const current = stage.active; stage.motion = !stage.motion;
  if (!stage.motion) stagePauseAll();
  if (current) { stage.active = null; stageActivate(current); }
  paintStageControls();
});
if (stageRetry) stageRetry.addEventListener('click', () => void loadStage());
if (stageSound) stageSound.addEventListener('click', () => {
  state.sound = !state.sound;
  paintSound();
  if (!state.sound) stopPromoNarration();
  const video = stage.active?.video;
  if (stage.active?.node.hasAttribute('data-silent-promo')) {
    if (state.sound) speakPromo(stage.active, { force: true }); else stopPromoNarration();
    return;
  }
  if (!video) return;
  video.muted = !state.sound;
  if (state.sound) { window.RosterMediaBus?.claim?.(video); video.play().catch(() => {}); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stagePauseAll(); else { const panel = stage.panels.find(item => item.id === stage.resumeId); if (panel) stageActivate(panel); } });
window.addEventListener('pagehide', stagePauseAll);
window.addEventListener('hashchange', () => { if (location.hash === '#board' && state.view !== 'board') showView('board'); });

activate('[data-feed-filter]', 'feedFilter', state.boardFilter);
activate('[data-connection-filter]', 'connectionFilter', state.connection);
showView(state.view);
if (params.get('compose') === 'post') {
  composerDialog?.showModal();
  document.querySelector('#post-body')?.focus();
  history.replaceState(null, '', '/');
}
if (params.get('camera') === '1') {
  const cameraButton = document.querySelector('[data-slots-camera]');
  history.replaceState(null, '', '/');
  if (cameraButton) {cameraButton.focus({preventScroll:true});cameraMessage('Tap Take a Pic when you’re ready to open the camera.');}
}
void loadTopRoster();
