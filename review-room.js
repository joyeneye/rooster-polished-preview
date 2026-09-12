/* The ROOSTER Review Room.
   One player, one queue, one place to write the review.

   Everything on this page is real: the queue comes from the room's own
   submissions, the progress bar is the audio element's own clock, the status
   line counts rows, and the host tools are drawn only when the server says
   this member administers this room. Nothing is invented — no fake
   submissions, no fake waveform, no placeholder activity.

   Playback is personal. This player is the member's own audio element: it
   never reaches into anybody else's listening, and it never resumes anything
   on its own. Camera and microphone broadcasting is not here at all; that is
   ROOSTER LIVE, and the room links to it. */
import { getUser, handleAuthCallback, hydrateSession, logout } from '@netlify/identity';

const byId = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format((Number(cents)||0)/100);
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const label = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
const initial = value => (String(value || '?').trim().charAt(0) || '?').toUpperCase();
const day = value => { const when = new Date(value); return Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString(); };

/** mm:ss, and a dash while the browser still does not know. */
function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const VIEWS = ['room', 'submit', 'office'];
/* Older links used one view per page. They still land somewhere sensible. */
const OLD_VIEWS = {overview: 'room', queue: 'room', results: 'room', live: 'room', submit: 'submit', office: 'office'};
const TABS = ['review', 'track', 'results'];
const SCORES = ['songwriting', 'production', 'originality', 'replay'];

let state = null;
let playing = null;      // {source: 'queue'|'mine', id, title, artist, lane, audio_url, source_url}
let tab = 'review';
let view = 'room';
let queueMode = 'room';   // which list the queue card is showing
let scrubbing = false;
let upload = null;       // the in-flight XMLHttpRequest, so a retry replaces it

const player = () => byId('rr-audio-player');

function toast(message) {
  const element = byId('rr-toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

async function api(path, options) {
  const response = await fetch(path, {credentials:'same-origin', ...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The Review Room could not be reached.');
  return data;
}

/* ------------------------------------------------------------- what is open */

function showView(name) {
  view = VIEWS.includes(name) ? name : 'room';
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== view; });
  byId('rr-head-menu').open = false;
  window.scrollTo({top: 0, behavior: 'smooth'});
}

function showTab(name) {
  tab = TABS.includes(name) ? name : 'review';
  for (const entry of TABS) {
    const button = byId(`rr-tab-${entry}`);
    const panel = byId(`rr-panel-${entry}`);
    if (!button || !panel) continue;
    button.setAttribute('aria-selected', String(entry === tab));
    panel.hidden = entry !== tab;
  }
  byId('rr-head-menu').open = false;
}

/* --------------------------------------------------------------- the player */

/** Put a track on the member's own player. Nothing starts until they press
 * Play, so opening a track never takes over the page's sound. */
function select(track) {
  playing = track;
  const audio = player();
  const source = track?.audio_url || '';
  if (audio.dataset.src !== source) {
    audio.pause();
    audio.dataset.src = source;
    if (source) audio.src = source;
    else audio.removeAttribute('src');
    audio.load?.();
  }
  paintPlayer();
  paintQueue();
  paintTabs();
}

function paintPlayer() {
  const audio = player();
  const art = byId('rr-art');
  const lane = byId('rr-now-lane');
  const title = byId('rr-now-title');
  const artist = byId('rr-now-artist');
  const link = byId('rr-open-source');
  const has = Boolean(playing);
  const streamable = Boolean(playing?.audio_url);

  art.dataset.lane = has ? String(playing.lane || '') : '';
  art.textContent = has ? initial(playing.artist || playing.title) : '♪';
  lane.textContent = has ? `${label(playing.lane || 'standard')} lane` : 'Now playing';
  title.textContent = has ? playing.title : 'Nothing is playing';
  artist.textContent = has
    ? playing.artist
    : (state?.permissions?.admin && countWaiting() ? 'Open a track from the queue to listen.' : 'Nothing is playing yet.');

  link.hidden = !(has && !streamable && playing.source_url);
  if (!link.hidden) link.href = playing.source_url;

  const ready = streamable && !audio.error;
  byId('rr-play').disabled = !ready;
  byId('rr-back15').disabled = !ready;
  byId('rr-fwd15').disabled = !ready;
  byId('rr-seek').disabled = !ready;
  byId('rr-play').textContent = audio.paused ? 'Play' : 'Pause';

  const note = byId('rr-player-note');
  if (has && !streamable && playing.source_url) note.textContent = 'This one was submitted as a streaming link. Open it in a new tab to listen.';
  else if (audio.error) note.textContent = 'That audio could not be loaded. Choose the track again to retry.';
  else note.textContent = 'Playback here is yours alone. Nothing you press changes what anybody else hears.';

  paintTime();
}

function paintTime() {
  const audio = player();
  const seek = byId('rr-seek');
  const length = Number.isFinite(audio.duration) ? audio.duration : 0;
  byId('rr-time').textContent = clock(audio.currentTime);
  byId('rr-duration').textContent = clock(length);
  if (!scrubbing) seek.value = String(length ? Math.round((audio.currentTime / length) * 1000) : 0);
}

async function togglePlay() {
  const audio = player();
  if (!audio.dataset.src) return;
  if (audio.paused) {
    // One thing plays at a time: the shared bus stops the radio and Clips.
    window.RosterMediaBus?.claim?.(audio);
    try { await audio.play(); }
    catch { byId('rr-player-note').textContent = 'Your browser would not start the audio. Press Play once more.'; }
  } else audio.pause();
  paintPlayer();
}

function nudge(seconds) {
  const audio = player();
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration);
  paintTime();
}

/* ---------------------------------------------------------------- the queue */

const countWaiting = () => (state?.queue || []).filter(row => row.queue_status === 'waiting').length;

function laneOf(row) {
  return row.tier_code === 'premium' ? 'premium' : row.tier_code === 'priority' ? 'priority' : row.tier_code === 'custom' ? 'custom' : 'standard';
}

function queueStatus(row, index) {
  if (row.queue_status === 'completed') return {text: 'Reviewed', tone: 'done'};
  if (row.queue_status === 'skipped') return {text: 'Skipped', tone: ''};
  if (new Date(row.available_at).getTime() > Date.now()) return {text: 'Back in 30 min', tone: ''};
  return {text: index === 0 ? 'Up next' : `#${index + 1} in queue`, tone: index === 0 ? 'live' : ''};
}

function trackOf(row) {
  return {source: 'queue', id: row.id, title: row.title, artist: row.artist_name, lane: laneOf(row), audio_url: row.audio_url, source_url: row.source_url};
}

function mineTrack(row) {
  return {source: 'mine', id: row.id, title: row.title, artist: row.artist_name, lane: row.tier_code, audio_url: row.audio_url || '', source_url: row.source_url || ''};
}

function paintQueue() {
  const admin = Boolean(state?.permissions?.admin);
  const incoming = admin ? (state.queue || []).filter(row => row.queue_status !== 'completed') : [];
  const mine = state.submissions || [];
  /* Every member runs their own room, so both lists can be real at once: the
     tracks other artists sent here, and the tracks this member sent out. The
     switch only appears when there is a second list to switch to. */
  if (queueMode === 'mine' && !mine.length) queueMode = 'room';
  if (queueMode === 'room' && !admin) queueMode = 'mine';
  const showing = queueMode === 'mine' ? mine : incoming;

  const switcher = byId('rr-queue-switch');
  switcher.hidden = !(admin && mine.length);
  for (const button of switcher.querySelectorAll('[data-queue-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.queueMode === queueMode));
    button.textContent = button.dataset.queueMode === 'room' ? `Queue ${countWaiting()}` : `Yours ${mine.length}`;
  }

  const title = byId('rr-queue-title');
  const list = byId('rr-queue-list');
  const empty = byId('rr-queue-empty');
  title.textContent = queueMode === 'mine' ? 'Your submissions' : 'Queue';
  byId('rr-queue-count').textContent = String(queueMode === 'mine' ? mine.length : countWaiting());
  empty.textContent = queueMode === 'mine' ? 'You have not put a song in a room yet.' : 'No tracks in the queue yet.';
  empty.hidden = showing.length > 0;

  list.innerHTML = showing.map((row, index) => {
    if (queueMode === 'mine') {
      const status = row.review ? (row.review.visibility === 'private' ? 'Private result' : 'Review ready')
        : row.queue_position ? `#${row.queue_position} in queue` : label(row.status);
      const current = playing?.source === 'mine' && playing.id === row.id;
      return `<li class="rr-row" data-current="${current}">
        <button type="button" class="rr-thumb" data-open-mine="${row.id}" aria-label="Listen to ${escapeHTML(row.title)}">${escapeHTML(initial(row.artist_name || row.title))}</button>
        <button type="button" class="rr-row-who" data-open-mine="${row.id}">
         <strong>${escapeHTML(row.title)}</strong>
         <small>${escapeHTML(row.room_name || 'Review Room')} · ${escapeHTML(day(row.created_at))}</small>
         <span class="rr-pill">${escapeHTML(status)}</span>
        </button>
        <span></span>
       </li>`;
    }
    const status = queueStatus(row, index);
    const current = playing?.source === 'queue' && playing.id === row.id;
    return `<li class="rr-row" data-current="${current}">
      <button type="button" class="rr-thumb" data-open-review="${row.id}" aria-label="Open ${escapeHTML(row.title)}">${escapeHTML(initial(row.artist_name))}</button>
      <button type="button" class="rr-row-who" data-open-review="${row.id}">
       <strong>${escapeHTML(row.title)}</strong>
       <small>${escapeHTML(row.artist_name)} · ${escapeHTML(row.genre)}</small>
       <span class="rr-pill" data-tone="${status.tone}">${escapeHTML(status.text)}</span>${row.featured ? '<span class="rr-pill" data-tone="gold">Featured</span>' : ''}
      </button>
      <details class="rr-row-menu">
       <summary aria-label="Actions for ${escapeHTML(row.title)}">⋯</summary>
       <div class="rr-menu-body">
        <button type="button" data-open-review="${row.id}">Open and review</button>
        <button type="button" data-queue-action="skip" data-id="${row.id}">Skip 30 minutes</button>
        <button type="button" data-queue-action="feature" data-id="${row.id}">${row.featured ? 'Remove feature' : 'Feature this track'}</button>
        ${row.tier_code !== 'free' ? `<button type="button" data-queue-action="refund" data-id="${row.id}">Request refund</button>` : ''}
       </div>
      </details>
     </li>`;
  }).join('');
}

/* ---------------------------------------------------- review, notes, results */

function paintTabs() {
  const admin = Boolean(state?.permissions?.admin);
  const track = playing?.source === 'queue' ? (state.queue || []).find(row => row.id === playing.id) : null;
  const review = byId('rr-panel-review');
  const notes = byId('rr-panel-track');

  if (!admin) {
    review.innerHTML = '<p class="rr-empty">Scoring belongs to the room’s reviewer. Waiting for the host.</p>';
  } else if (!track) {
    review.innerHTML = '<p class="rr-empty">Open a track from the queue and its review form opens here.</p>';
  } else {
    review.innerHTML = `<form id="rr-review-form" autocomplete="off">
      <p class="rr-eyebrow">Reviewing</p>
      <h3>${escapeHTML(track.title)} <span class="rr-pill">${escapeHTML(label(laneOf(track)))}</span></h3>
      <div class="rr-scores">${SCORES.map(name => `<label class="rr-label" for="rr-score-${name}">${label(name)}<input id="rr-score-${name}" name="${name}" type="number" min="1" max="10" inputmode="numeric" required></label>`).join('')}</div>
      <label class="rr-label" for="rr-feedback">Written feedback</label>
      <textarea id="rr-feedback" name="feedback" rows="5" maxlength="4000" required placeholder="Be specific. Tell the artist what moves the record forward."></textarea>
      <div class="rr-decide">
       <label class="rr-label" for="rr-decision">Decision<select id="rr-decision" name="decision"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
       <label class="rr-label" for="rr-visibility">Who sees it<select id="rr-visibility" name="visibility"><option value="public">Public review</option><option value="private">Private to the artist</option></select></label>
      </div>
      <div class="rr-review-row">
       <button type="submit" class="rr-button rr-primary">Publish review</button>
       <button type="button" class="rr-button rr-ghost" data-queue-action="skip" data-id="${track.id}">Skip 30 minutes</button>
      </div>
      <p id="rr-review-status" role="status"></p>
     </form>`;
    byId('rr-review-form').addEventListener('submit', submitReview);
  }

  const shown = track || (playing?.source === 'mine' ? (state.submissions || []).find(row => row.id === playing.id) : null);
  if (!shown) {
    notes.innerHTML = '<p class="rr-empty">Track details open here once a track is on the player.</p>';
  } else {
    const meta = [shown.genre, shown.mood, ...(shown.tags || [])].filter(Boolean);
    const links = Object.entries(shown.social_links || {}).filter(([, url]) => url);
    notes.innerHTML = `<h3>${escapeHTML(shown.title)}</h3>
      <p class="rr-note">${escapeHTML(shown.artist_name || '')}${shown.created_at ? ` · submitted ${escapeHTML(day(shown.created_at))}` : ''}</p>
      ${meta.length ? `<ul class="rr-meta">${meta.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : ''}
      ${shown.song_info ? `<p class="rr-feedback">${escapeHTML(shown.song_info)}</p>` : '<p class="rr-empty">The artist did not leave a note with this one.</p>'}
      ${links.length ? `<ul class="rr-meta">${links.map(([name, url]) => `<li><a href="${escapeHTML(url)}" target="_blank" rel="noopener nofollow">${escapeHTML(label(name))}</a></li>`).join('')}</ul>` : ''}`;
  }

  paintResults();
}

function paintResults() {
  const root = byId('rr-panel-results');
  const rows = state.submissions || [];
  if (!rows.length) {
    root.innerHTML = '<p class="rr-empty">Your scores and written feedback appear here after your first submission.</p>';
    return;
  }
  root.innerHTML = rows.map(row => {
    const review = row.review;
    const scores = review?.scores || {};
    const status = review ? (review.visibility === 'private' ? 'Private result' : 'Review ready')
      : row.queue_position ? `#${row.queue_position} in queue` : label(row.status);
    return `<article class="rr-result">
      <div class="rr-result-head"><strong>${escapeHTML(row.title)}</strong><span class="rr-pill"${review ? ' data-tone="done"' : ''}>${escapeHTML(status)}</span></div>
      <p class="rr-note">${escapeHTML(row.room_name || 'Review Room')} · ${escapeHTML(label(row.tier_code))} lane · ${escapeHTML(label(row.payment_status))}</p>
      ${review ? `<ul class="rr-score-line"><li>Overall ${review.overall_score}/10</li>${SCORES.map(name => `<li>${label(name)} ${Number(scores[name]) || 0}/10</li>`).join('')}</ul>
       <p class="rr-feedback">${escapeHTML(review.feedback)}</p>
       <p class="rr-note">${review.visibility === 'public' ? 'Published on the room’s public reviews page.' : 'Visible only to you and the reviewer.'}</p>`
      : '<p class="rr-empty">Waiting for the host. Lane weight and waiting time set the order, so the position moves on its own.</p>'}
     </article>`;
  }).join('');
}

/* ----------------------------------------------------------------- the head */

function paintHead() {
  const admin = Boolean(state.permissions?.admin);
  const waiting = countWaiting();
  const mineWaiting = (state.submissions || []).filter(row => !row.review).length;

  byId('rr-member-name').textContent = state.member.name;
  byId('rr-room-name').textContent = state.workspace.name;
  byId('rr-room-code').textContent = state.workspace.slug;
  byId('rr-room-face').textContent = initial(state.member.name);

  const status = byId('rr-session-status');
  if (admin && playing?.source === 'queue') { status.textContent = 'Reviewing now'; status.dataset.tone = 'reviewing'; }
  else if (admin && waiting) { status.textContent = `${waiting} ${waiting === 1 ? 'track' : 'tracks'} waiting to be reviewed`; status.dataset.tone = 'open'; }
  else if (admin) { status.textContent = 'Queue clear · open for submissions'; status.dataset.tone = 'clear'; }
  else if (mineWaiting) { status.textContent = `${mineWaiting} of yours waiting for a review`; status.dataset.tone = 'open'; }
  else { status.textContent = 'Open for submissions'; status.dataset.tone = 'clear'; }

  const primary = byId('rr-primary');
  if (admin && waiting) { primary.textContent = 'Start reviewing'; primary.dataset.act = 'review'; }
  else { primary.textContent = 'Submit a track'; primary.dataset.act = 'submit'; }
}

function paintOffice() {
  byId('rr-setting-name').value = state.workspace.name;
  byId('rr-setting-bio').value = state.workspace.bio || '';
  byId('rr-office-revenue').textContent = money(state.stats.revenue_cents);
  byId('rr-office-pending').textContent = money(state.stats.pending_cents);
  byId('rr-office-volume').textContent = String((state.queue || []).length);
  byId('rr-submission-link').value = `${location.origin}/review-room.html?room=${encodeURIComponent(state.workspace.slug)}&view=submit`;
  byId('rr-public-link').value = `${location.origin}/reviews.html?room=${encodeURIComponent(state.workspace.slug)}`;
  byId('rr-tier-settings').innerHTML = (state.tiers || []).map(tier => `
    <div class="rr-tier-setting" data-tier-setting="${escapeHTML(tier.code)}">
     <strong>${escapeHTML(tier.name)}</strong>
     <label class="rr-label">Price<input data-price type="number" min="0" step="1" value="${tier.price_cents / 100}"></label>
     <label class="rr-label">Weight<input data-weight type="number" min="1" max="10000" value="${tier.priority_weight}"></label>
     <button type="button" data-save-tier="${escapeHTML(tier.code)}">Save</button>
    </div>`).join('');
}

function paintTiers() {
  byId('rr-tier-options').innerHTML = (state.tiers || []).filter(tier => tier.active).map((tier, index) => `
    <label class="rr-tier">
     <input type="radio" name="tier" value="${escapeHTML(tier.code)}"${index === 0 ? ' checked' : ''}>
     <span><strong>${escapeHTML(tier.name)}</strong><b>${tier.price_cents ? money(tier.price_cents) : 'Free'}</b><small>${escapeHTML(tier.description)}</small></span>
    </label>`).join('');
}

function paint() {
  paintHead();
  paintQueue();
  paintPlayer();
  paintTabs();
  paintTiers();
  paintOffice();
  byId('rr-target-room').value = byId('rr-target-room').value || new URLSearchParams(location.search).get('room') || state.workspace.slug;
}

/* --------------------------------------------------------- host queue tools */

async function queueAction(action, id) {
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId)) return;
  try {
    await api('/api/review-room/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({submission_id: submissionId, action})});
    toast(action === 'skip' ? 'Moved back 30 minutes.' : action === 'refund' ? 'Refund request recorded.' : 'Featured status updated.');
    if (action === 'skip' && playing?.source === 'queue' && playing.id === submissionId) { player().pause(); select(null); }
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

async function submitReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('[type=submit]');
  const status = byId('rr-review-status');
  button.disabled = true;
  status.textContent = 'Saving the review…';
  try {
    await api('/api/review-room/action', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      submission_id: playing.id,
      action: 'review',
      scores: Object.fromEntries(SCORES.map(name => [name, Number(data.get(name))])),
      feedback: data.get('feedback'),
      decision: data.get('decision'),
      visibility: data.get('visibility'),
    })});
    toast('Review saved. The artist can see the result.');
    player().pause();
    select(null);
    await loadDashboard();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

/* -------------------------------------------------------------- submitting */

function submitStatus(message, tone = '') {
  const status = byId('rr-submit-status');
  status.textContent = message;
  status.dataset.tone = tone;
}

function uploadProgress(fraction) {
  const bar = byId('rr-upload-progress');
  bar.hidden = fraction === null;
  if (fraction !== null) byId('rr-upload-fill').style.width = `${Math.round(fraction * 100)}%`;
}

/** One submission at a time, with the real byte count of the upload and a
 * retry that keeps everything the member already typed. */
function submitTrack(event) {
  event?.preventDefault();
  const form = byId('rr-submit-form');
  if (upload) return;
  const button = byId('rr-submit-button');
  const retry = byId('rr-submit-retry');
  const body = new FormData(form);
  const file = byId('rr-audio').files[0];
  if (file && file.size > 12 * 1024 * 1024) {
    submitStatus('That file is larger than 12 MB. Export a smaller MP3 and try again.', 'error');
    retry.hidden = false;
    return;
  }
  button.disabled = true;
  retry.hidden = true;
  submitStatus(file ? 'Uploading your track…' : 'Placing your track in the queue…');
  uploadProgress(0);

  const request = new XMLHttpRequest();
  upload = request;
  request.open('POST', '/api/review-room/submit');
  request.withCredentials = true;
  request.upload.addEventListener('progress', progress => {
    if (progress.lengthComputable) uploadProgress(progress.loaded / progress.total);
  });
  request.addEventListener('load', async () => {
    upload = null;
    button.disabled = false;
    uploadProgress(null);
    let payload = {};
    try { payload = JSON.parse(request.responseText); } catch { payload = {}; }
    if (request.status >= 200 && request.status < 300) {
      form.reset();
      byId('rr-audio-name').textContent = 'Choose an MP3 or WAV';
      byId('rr-audio').closest('.rr-upload').dataset.hasFile = 'false';
      submitStatus('');
      toast('Track submitted. Your queue position is live.');
      await loadDashboard();
      showView('room');
      showTab('results');
    } else {
      submitStatus(payload.error || 'That submission did not go through. Nothing was uploaded.', 'error');
      retry.hidden = false;
    }
  });
  request.addEventListener('error', () => {
    upload = null;
    button.disabled = false;
    uploadProgress(null);
    submitStatus('The upload stopped before it finished. Check your connection and try again.', 'error');
    retry.hidden = false;
  });
  request.addEventListener('abort', () => {
    upload = null;
    button.disabled = false;
    uploadProgress(null);
    submitStatus('The upload was stopped. Nothing was submitted.', '');
    retry.hidden = false;
  });
  request.send(body);
}

/* ------------------------------------------------------------ the back office */

async function saveRoom(event) {
  event.preventDefault();
  try {
    await api('/api/review-room/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'workspace', name:byId('rr-setting-name').value, bio:byId('rr-setting-bio').value})});
    toast('Room saved.');
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

async function saveTier(code) {
  const row = document.querySelector(`[data-tier-setting="${CSS.escape(code)}"]`);
  try {
    await api('/api/review-room/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      type: 'tier', code,
      price_cents: Math.round(Number(row.querySelector('[data-price]').value) * 100),
      priority_weight: Number(row.querySelector('[data-weight]').value),
    })});
    toast(`${label(code)} lane saved.`);
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

/* --------------------------------------------------------------- the loading */

async function loadDashboard() {
  state = await api('/api/review-room/dashboard');
  // Keep listening to whatever is on the player if it is still in the room.
  if (playing?.source === 'queue') {
    const still = (state.queue || []).find(row => row.id === playing.id && row.queue_status !== 'completed');
    playing = still ? trackOf(still) : null;
  } else if (playing?.source === 'mine') {
    const still = (state.submissions || []).find(row => row.id === playing.id);
    playing = still ? mineTrack(still) : null;
  }
  paint();
}

function startReviewing() {
  const next = (state.queue || []).filter(row => row.queue_status === 'waiting')[0];
  if (!next) { showView('submit'); return; }
  showView('room');
  select(trackOf(next));
  showTab('review');
}

/* ------------------------------------------------------------------ the wiring */

document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (go) showView(go.dataset.go);

  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) { showView('room'); showTab(tabButton.dataset.tab); }

  const primary = event.target.closest('#rr-primary');
  if (primary) { if (primary.dataset.act === 'review') startReviewing(); else showView('submit'); }

  const openReview = event.target.closest('[data-open-review]');
  if (openReview) {
    const row = (state?.queue || []).find(entry => entry.id === Number(openReview.dataset.openReview));
    if (row) { select(trackOf(row)); showTab('review'); paintHead(); }
    openReview.closest('.rr-row-menu')?.removeAttribute('open');
  }

  const openMine = event.target.closest('[data-open-mine]');
  if (openMine) {
    const row = (state?.submissions || []).find(entry => entry.id === Number(openMine.dataset.openMine));
    if (row) { select(mineTrack(row)); showTab('results'); }
  }

  const action = event.target.closest('[data-queue-action]');
  if (action) { action.closest('.rr-row-menu')?.removeAttribute('open'); queueAction(action.dataset.queueAction, action.dataset.id); }

  const copy = event.target.closest('[data-copy]');
  if (copy) {
    const input = byId({submission:'rr-submission-link', public:'rr-public-link'}[copy.dataset.copy]);
    navigator.clipboard?.writeText(input.value)
      .then(() => toast('Link copied.'))
      .catch(() => toast('Copy is unavailable here. Select the link and copy it by hand.'));
    byId('rr-head-menu').open = false;
  }

  const mode = event.target.closest('[data-queue-mode]');
  if (mode) { queueMode = mode.dataset.queueMode; paintQueue(); }

  const tierSave = event.target.closest('[data-save-tier]');
  if (tierSave) saveTier(tierSave.dataset.saveTier);

  // A tap outside the head menu closes it, the way a menu should behave.
  if (!event.target.closest('#rr-head-menu')) byId('rr-head-menu').open = false;
});

byId('rr-play').addEventListener('click', togglePlay);
byId('rr-back15').addEventListener('click', () => nudge(-15));
byId('rr-fwd15').addEventListener('click', () => nudge(15));
byId('rr-seek').addEventListener('input', () => { scrubbing = true; });
byId('rr-seek').addEventListener('change', event => {
  const audio = player();
  scrubbing = false;
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
  paintTime();
});

const audio = player();
audio.addEventListener('timeupdate', paintTime);
audio.addEventListener('loadedmetadata', paintPlayer);
audio.addEventListener('play', paintPlayer);
audio.addEventListener('pause', paintPlayer);
audio.addEventListener('ended', () => { paintPlayer(); paintTime(); });
audio.addEventListener('error', paintPlayer);

document.querySelectorAll('[data-tab]').forEach(button => {
  if (button.getAttribute('role') === 'tab') button.addEventListener('keydown', event => {
    const order = TABS.indexOf(button.dataset.tab);
    if (event.key === 'ArrowRight') { showTab(TABS[(order + 1) % TABS.length]); byId(`rr-tab-${tab}`).focus(); }
    if (event.key === 'ArrowLeft') { showTab(TABS[(order + TABS.length - 1) % TABS.length]); byId(`rr-tab-${tab}`).focus(); }
  });
});

byId('rr-audio').addEventListener('change', event => {
  const file = event.target.files[0];
  byId('rr-audio-name').textContent = file ? file.name : 'Choose an MP3 or WAV';
  event.target.closest('.rr-upload').dataset.hasFile = String(Boolean(file));
});
byId('rr-submit-form').addEventListener('submit', submitTrack);
byId('rr-submit-retry').addEventListener('click', () => submitTrack());
byId('rr-room-settings').addEventListener('submit', saveRoom);
byId('rr-logout').addEventListener('click', async () => { player().pause(); await logout(); location.reload(); });
window.addEventListener('pagehide', () => { upload?.abort(); player().pause(); });

async function start() {
  try { await hydrateSession(); await handleAuthCallback(); } catch { /* a signed-out visitor is normal */ }
  const user = await getUser();
  byId('rr-loading').hidden = true;
  if (!user) { byId('rr-auth-gate').hidden = false; return; }
  byId('rr-app').hidden = false;
  try {
    await loadDashboard();
    const asked = new URLSearchParams(location.search).get('view') || '';
    showView(OLD_VIEWS[asked] || 'room');
    queueMode = countWaiting() ? 'room' : (state.submissions || []).length ? 'mine' : 'room';
    paintQueue();
    showTab(countWaiting() ? 'review' : 'results');
  } catch (error) {
    byId('rr-app').hidden = true;
    byId('rr-auth-gate').hidden = false;
    toast(error.message);
  }
}

start();
