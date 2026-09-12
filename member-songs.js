const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_NAMES = {apple:'Apple Music',spotify:'Spotify',youtube:'YouTube'};

function youtubeEmbed(id) {
  const origin = typeof window !== 'undefined' && typeof window.location?.origin === 'string' && /^https?:\/\/[^/]+$/.test(window.location.origin)
    ? window.location.origin : 'https://jwhitedidit.net';
  return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
}

export function musicLink(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return null;
  let input;
  try { input = new URL(value.trim()); } catch { return null; }
  if (input.protocol !== 'https:' || input.username || input.password || input.port) return null;
  const host = input.hostname.toLowerCase();
  if (host === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?track\/([a-zA-Z0-9]{22})\/?$/i.exec(input.pathname);
    if (!match) return null;
    const url = `https://open.spotify.com/track/${match[1]}`;
    return {provider:'spotify',url,embed:`https://open.spotify.com/embed/track/${match[1]}?theme=0`};
  }
  if (host === 'spotify.link') {
    const match = /^\/([a-zA-Z0-9_-]{2,200})\/?$/.exec(input.pathname);
    return match ? {provider:'spotify',url:`https://spotify.link/${match[1]}`,embed:null} : null;
  }
  if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
    const match = /^\/([a-z]{2})\/(album|song)\/([a-zA-Z0-9._~%-]+)\/(\d+)\/?$/i.exec(input.pathname);
    const songId = input.searchParams.get('i');
    if (!match || (match[2].toLowerCase() === 'album' && (!songId || !/^\d+$/.test(songId)))) return null;
    const base = `https://music.apple.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}/${match[3]}/${match[4]}`;
    const url = songId && /^\d+$/.test(songId) ? `${base}?i=${songId}` : base;
    return {provider:'apple',url,embed:url.replace('https://music.apple.com/','https://embed.music.apple.com/')};
  }
  const youtubeHosts = new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com']);
  let videoId = null;
  if (host === 'youtu.be') videoId = input.pathname.slice(1).split('/')[0] || null;
  else if (youtubeHosts.has(host)) {
    if (input.pathname === '/watch') videoId = input.searchParams.get('v');
    else videoId = /^\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})\/?$/.exec(input.pathname)?.[1] ?? null;
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  return {provider:'youtube',url:`https://www.youtube.com/watch?v=${videoId}`,embed:youtubeEmbed(videoId)};
}

function newProfileSongLink(value) {
  const link = musicLink(value);
  return link?.provider === 'youtube' ? link : null;
}

function providerFrame(link, title) {
  const frame = document.createElement('iframe');
  frame.className = `song-embed song-embed-${link.provider}`;
  frame.src = link.embed;
  frame.title = `${title} on ${PROVIDER_NAMES[link.provider]}`;
  frame.loading = 'eager';
  frame.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.setAttribute('allowfullscreen', '');
  return frame;
}

function providerOpen(link) {
  const anchor = document.createElement('a');
  anchor.className = 'song-open-service'; anchor.href = link.url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
  anchor.textContent = `Open in ${PROVIDER_NAMES[link.provider]} ↗`;
  return anchor;
}

export function createMemberSongs({onSessionExpired,onEditProfile}) {
  const root = document.getElementById('member-songs-root');
  if (!root) return {setUser() {}};
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const header = element('div', 'song-heading');
  const heading = element('h3', '', 'My Music · ROOSTER PLAYER');
  const refreshButton = element('button', 'member-secondary', 'Refresh songs');
  refreshButton.type = 'button';
  header.append(heading, refreshButton);
  const intro = element('p', 'song-intro', 'Music is optional for everyone. Add up to 3 YouTube songs, or feature songs you love from other members.');
  const help = element('p', 'song-help', 'Paste a YouTube video link. The modern ROOSTER PLAYER never starts by itself and keeps the real play counter.');
  const profileHint = element('a', 'song-profile-hint', 'Open My Profile');
  profileHint.href = '#member-profile-panel'; profileHint.hidden = true; help.append(profileHint);
  profileHint.addEventListener('click',()=>onEditProfile?.());
  const notice = element('p', 'song-status');
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const list = element('div', 'song-list');
  const featuredHeading = element('h3','','Featured from my community');
  const featuredHelp = element('p','song-help','Open someone’s Profile Music and tap Add to my Profile Music. Keep up to 3 favorites here, with credit to the original creator.');
  const featuredList = element('div','song-list');
  const browse = element('a','song-open-service','Find people and music');browse.href='/people.html';
  const viewMusic = element('a','song-open-service','View my Profile Music');viewMusic.href='/my-profile.html?view=songs';
  root.replaceChildren(header, intro, help, notice, list, viewMusic, featuredHeading, featuredHelp, featuredList, browse);

  let user = null;
  let generation = 0;
  let busy = false;
  let loaded = false;
  const requests = new Set();
  const cards = [];
  const current = epoch => user && generation === epoch;
  const empty = slot => ({slot,revision:null,status:'empty',title:null,duration:null,url:null,source:null,provider:null,external_url:null});
  const report = text => { notice.textContent = text; profileHint.hidden = true; };
  const safeAudio = (url, slot) => typeof url === 'string' && new RegExp(`^/api/member-song-audio/${user.id.toLowerCase()}/${slot}/[a-f0-9]{64}$`).test(url) ? url : null;
  const linkedRecord = value => {
    const link = value?.status === 'approved' && value.source === 'link' ? musicLink(value.external_url) : null;
    return link?.embed && link.provider === value.provider && link.url === value.external_url ? link : null;
  };
  const validRecord = value => {
    if (!value || ![1,2,3].includes(value.slot) || !['empty','approved','pending','rejected'].includes(value.status) ||
        (value.revision !== null && typeof value.revision !== 'string') || (value.title !== null && typeof value.title !== 'string')) return false;
    if (value.status === 'empty') return value.title === null;
    if (!value.title?.trim()) return false;
    if (value.source === 'link') return Boolean(linkedRecord(value));
    return value.source === 'upload' && Number.isFinite(value.duration) && value.duration > 0 && value.duration <= 600;
  };

  function clearPlayer(card) {
    for (const player of card.player.children) if (player.tagName === 'AUDIO') { player.pause(); player.removeAttribute('src'); player.load(); }
    card.player.replaceChildren();
  }
  function showLinkHint(card) {
    const link = newProfileSongLink(card.link.value);
    card.linkHint.textContent = !card.link.value.trim() ? 'Paste one YouTube link.' : link ? 'YouTube link ready.' : 'Use a YouTube link to one video.';
    card.linkHint.dataset.valid = String(Boolean(link));
  }
  function resetDraft(card) {
    card.dirty = false; card.retry = null;
    card.title.value = card.record.title || '';
    card.link.value = card.record.source === 'link' ? card.record.external_url || '' : '';
    showLinkHint(card);
  }
  function controls() {
    refreshButton.disabled = !user || busy;
    for (const card of cards) {
      card.title.disabled = !user || !loaded || busy;
      card.link.disabled = !user || !loaded || busy;
      card.submit.disabled = !user || !loaded || busy || !newProfileSongLink(card.link.value);
      card.remove.disabled = !user || !loaded || busy;
      card.cancel.disabled = busy;
      card.cancel.hidden = !card.dirty;
      card.submit.textContent = card.record.status === 'empty' ? 'Add song' : 'Replace song';
      card.remove.hidden = card.record.status === 'empty';
      card.form.setAttribute('aria-busy', String(busy));
    }
  }
  function renderRecord(card) {
    const record = card.record;
    clearPlayer(card);
    card.currentTitle.textContent = record.title || 'Choose a song';
    const provider = linkedRecord(record);
    card.state.textContent = record.status === 'empty' ? 'This spot is open.' : provider ? `On your profile through ${PROVIDER_NAMES[provider.provider]}.` : record.status === 'approved' ? 'On your profile.' : 'Replace this old upload with a song link.';
    if (provider) card.player.append(providerFrame(provider, record.title), providerOpen(provider));
    else if (record.status === 'approved') {
      const url = safeAudio(record.url, record.slot);
      if (url) {
        const audio = element('audio', 'song-audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = url;
        audio.setAttribute('aria-label', `Play ${record.title}`); card.player.append(audio);
      }
    }
    if (!card.dirty) resetDraft(card);
  }
  function apply(records) {
    for (const card of cards) {
      card.record = records.find(record => record.slot === card.slot) || empty(card.slot);
      renderRecord(card);
    }
  }
  function showFeatured(records = []) {
    featuredList.replaceChildren();
    if (!Array.isArray(records) || records.length > 3) return;
    if (!records.length) { featuredList.append(element('p','song-slot-state','No featured songs yet. This is completely optional.'));return; }
    for (const record of records) {
      if (!MEMBER_ID.test(record?.id || '')) continue;
      const card=element('section','song-card');
      const title=element('h4','song-current-title',record.song?.title || 'Song no longer available');
      const credit=element('p','song-slot-state',record.song?.origin?.name ? `Featured from ${record.song.origin.name}` : 'The original member removed or changed this song.');
      const remove=element('button','member-secondary','Remove from my page');remove.type='button';
      remove.addEventListener('click',async()=>{
        if(!user||busy)return;const epoch=generation;busy=true;remove.disabled=true;controls();report('Removing featured song…');
        try {const data=await request('/api/profile-music-features',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({feature_id:record.id})});if(!current(epoch))return;showFeatured(data.featured);report('Featured song removed. The original song stays with its creator.');}
        catch(error){failure(error,epoch);remove.disabled=false;}
        finally{if(current(epoch)){busy=false;controls();}}
      });
      card.append(title,credit,remove);featuredList.append(card);
    }
  }
  async function request(path, options = {}, timeoutMs = 30000) {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...options.headers}});
      const data = await response.json().catch(() => null);
      if (!response.ok) { const error = new Error('Song request failed'); error.status = response.status; error.profileRequired = data?.error === 'Save your profile once before adding a song.'; error.publicMessage = typeof data?.error === 'string' && data.error.length <= 200 ? data.error : ''; throw error; }
      if (!data || typeof data !== 'object') throw new Error('Invalid song response');
      return data;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function failure(error, epoch) {
    if (!current(epoch)) return;
    if ([401,403].includes(error.status)) { clear(); onSessionExpired(); return; }
    if (error.profileRequired) { report('Save your profile once, then come back to add your song. Your title and link are still here.'); profileHint.hidden = false; return; }
    if (error.status === 409) { report('Your music changed in another window. Tap Refresh songs, then try again.'); return; }
    if (error.status === 429) { report('Give it a minute, then try again. Your song link is still here.'); return; }
    if ([400,413,415].includes(error.status)) { report(error.publicMessage || 'Add a title and paste one YouTube song link.'); return; }
    report('We could not confirm that update. Your title and link are still here. Try the same button again.');
  }
  async function refresh(manual = false) {
    if (!user || busy || document.visibilityState === 'hidden') return;
    const epoch = generation; busy = true; controls();
    if (manual || !loaded) report('Checking your songs…');
    try {
      const data = await request('/api/member-songs/me');
      if (!current(epoch)) return;
      if (data.user?.id !== user.id) { const error = new Error('Session changed'); error.status = 401; throw error; }
      if (data.max_songs !== 3 || !Array.isArray(data.slots) || data.slots.length !== 3 || !data.slots.every(validRecord) || new Set(data.slots.map(record=>record.slot)).size !== 3) throw new Error('Invalid song list');
      apply(data.slots); showFeatured(data.featured); loaded = true; report('');
    } catch (error) { failure(error, epoch); }
    finally { if (current(epoch)) { busy = false; controls(); } }
  }
  async function save(card, remove = false) {
    if (!user || !loaded || busy || (!remove && !card.form.reportValidity())) return;
    const title = card.title.value.trim(); const link = newProfileSongLink(card.link.value);
    if (!remove && (!title || !link)) { card.linkHint.textContent = !title ? 'Give this song a title first.' : 'Paste one YouTube song link.'; return; }
    const snapshot = JSON.stringify({slot:card.slot,title:remove ? '' : title,url:remove ? '' : link.url,remove});
    if (!card.retry || card.retry.snapshot !== snapshot) card.retry = {snapshot,requestId:crypto.randomUUID(),revision:card.record.revision};
    const body = remove ? {slot:card.slot,request_id:card.retry.requestId,revision:card.retry.revision || ''}
      : {slot:card.slot,title,url:link.url,request_id:card.retry.requestId,revision:card.retry.revision || ''};
    const epoch = generation; busy = true; controls(); report(remove ? 'Removing your song…' : 'Adding your song link…');
    try {
      const data = await request(remove ? '/api/member-songs/delete' : '/api/member-songs/link', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if (!current(epoch)) return;
      if (!validRecord(data.slot) || data.slot.slot !== card.slot || !['approved','deleted'].includes(data.status)) throw new Error('Invalid song confirmation');
      card.record = data.slot; card.retry = null; card.dirty = false; renderRecord(card);
      const provider = data.slot?.provider && PROVIDER_NAMES[data.slot.provider];
      report(data.status === 'deleted' ? 'Song removed from your profile.' : `Link saved. Tap play below${provider ? ` or open it in ${provider}` : ''}.`);
    } catch (error) { if (error.status === 409) card.retry = null; failure(error, epoch); }
    finally { if (current(epoch)) { busy = false; controls(); } }
  }

  for (let slot = 1; slot <= 3; slot += 1) {
    const section = element('section','song-card'); section.setAttribute('aria-label',`Song ${slot}`);
    const titleLine = element('h4','song-title',`Song ${slot}`);
    const currentTitle = element('p','song-current-title');
    const state = element('p','song-slot-state');
    const player = element('div','song-link-player');
    const form = element('form','song-form'); form.setAttribute('aria-label',`Update song ${slot}`);
    const titleLabel = element('label','', 'Song title'); const title = element('input'); title.type = 'text'; title.maxLength = 100; title.required = true; title.id = `member-song-title-${slot}`; title.name = 'title'; titleLabel.htmlFor = title.id; titleLabel.append(title);
    const linkLabel = element('label','', 'YouTube song link'); const link = element('input'); link.type = 'url'; link.required = true; link.inputMode = 'url'; link.autocomplete = 'url'; link.placeholder = 'https://www.youtube.com/watch?v='; link.id = `member-song-link-${slot}`; link.name = 'url'; linkLabel.htmlFor = link.id; linkLabel.append(link);
    const linkHint = element('p','song-status','Paste one YouTube link.'); linkHint.setAttribute('role','status'); linkHint.setAttribute('aria-live','polite');
    const actions = element('div','song-actions'); const submit = element('button','member-primary','Add song'); submit.type = 'submit';
    const cancel = element('button','member-secondary','Clear changes'); cancel.type = 'button'; cancel.hidden = true;
    const remove = element('button','member-secondary','Remove song'); remove.type = 'button'; remove.hidden = true;
    actions.append(submit,cancel,remove); form.append(titleLabel,linkLabel,linkHint,actions); section.append(titleLine,currentTitle,state,player,form); list.append(section);
    const card = {slot,record:empty(slot),form,title,link,linkHint,submit,cancel,remove,currentTitle,state,player,dirty:false,retry:null}; cards.push(card);
    const edit = () => { card.dirty = true; card.retry = null; showLinkHint(card); controls(); };
    title.addEventListener('input',edit); link.addEventListener('input',edit);
    form.addEventListener('submit',event=>{event.preventDefault();void save(card);});
    remove.addEventListener('click',()=>void save(card,true));
    cancel.addEventListener('click',()=>{if(busy)return;resetDraft(card);controls();});
    renderRecord(card);
  }
  function clear() {
    generation += 1; user = null; loaded = false; busy = false;
    requests.forEach(controller=>controller.abort()); requests.clear();
    for (const card of cards) { card.record = empty(card.slot); clearPlayer(card); resetDraft(card); }
    featuredList.replaceChildren();report(''); root.hidden = true; controls();
  }
  function setUser(member) {
    if (member?.id && member.id === user?.id) return;
    clear();
    if (!member?.id || !MEMBER_ID.test(member.id)) return;
    user = {id:member.id}; root.hidden = false; void refresh();
  }
  refreshButton.addEventListener('click',()=>void refresh(true));
  document.addEventListener('visibilitychange',()=>{
    if (document.visibilityState === 'hidden') for (const card of cards) clearPlayer(card);
    else if (user) void refresh();
  });
  window.addEventListener('pagehide',clear);
  controls();
  return {setUser};
}
