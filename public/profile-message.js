// Private conversations use the same approved-member endpoints as the inbox.
// Nothing private is put in local storage or inferred from the viewed profile.
export function createProfileConversation({doc = document, win = window, send = (...args) => fetch(...args)} = {}) {
  const byId = id => doc.getElementById(id);
  const dialog = byId('profile-conversation'), form = byId('profile-conversation-form');
  if (!dialog || !form) return null;
  const list = byId('profile-conversation-history'), body = byId('profile-conversation-body');
  const feedback = byId('profile-conversation-status'), login = byId('profile-conversation-login');
  const submit = byId('profile-conversation-send'), refresh = byId('profile-conversation-refresh'), more = byId('profile-conversation-more');
  const openers = [...doc.querySelectorAll('[data-profile-message-open]')];
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MESSAGE = /^[a-f0-9]{64}$/;
  const requests = new Set(), media = new Map(), reading = new Set(), retiredIds = new Set();
  const outbox = new Map(), rows = new Map(), confirmedHere = new Set();
  let viewed = null, user = null, epoch = 0, revision = 0, loading = false, sending = false, loaded = false;
  let messages = [], cursors = {inbox_before:null,sent_before:null}, opener = null, poll = null;
  let subject = 'New message';
  const id = value => UUID.test(value?.id || '') ? value.id.toLowerCase() : '';
  const current = generation => generation === epoch && Boolean(id(viewed));
  const cleanName = value => String(value || 'Member').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,60);
  function report(text = '', tone = '') { feedback.textContent = text; feedback.dataset.tone = tone; }
  function controls() {
    const available = loaded && user && user.id !== id(viewed);
    body.disabled = !available;
    submit.disabled = !available || sending || !body.value.trim();
    submit.textContent = '↑';
    submit.setAttribute('aria-label', sending ? 'Sending message' : 'Send message');
    refresh.disabled = loading || sending;
    more.disabled = loading || sending;
    more.hidden = !loaded || !Object.values(cursors).some(Boolean);
    form.setAttribute('aria-busy', String(sending));
    list.setAttribute('aria-busy', String(loading && !loaded));
    for (const item of outbox.values()) if (item.retryButton) item.retryButton.disabled = sending;
    if (body.style) { body.style.height = 'auto'; body.style.height = Math.min(112, Math.max(44, body.scrollHeight || 44)) + 'px'; }
  }
  function releaseMedia(messageId) {
    const item = media.get(messageId);
    if (!item) return;
    item.controller?.abort();
    if (item.url) win.URL.revokeObjectURL(item.url);
    item.node?.pause?.();
    item.node?.removeAttribute('src');
    media.delete(messageId); rows.delete(messageId);
  }
  function revokeMedia() {
    for (const messageId of media.keys()) releaseMedia(messageId);
  }
  function retireMessages(data) {
    if (!Array.isArray(data.retired_message_ids)) return;
    for (const messageId of data.retired_message_ids) if (typeof messageId === 'string' && MESSAGE.test(messageId)) retiredIds.add(messageId);
    messages = messages.filter(message => !retiredIds.has(message.id));
    for (const messageId of retiredIds) { releaseMedia(messageId); reading.delete(messageId); }
  }
  function clear() {
    epoch += 1;
    for (const controller of requests) controller.abort();
    requests.clear(); revokeMedia(); reading.clear(); retiredIds.clear(); outbox.clear(); rows.clear(); confirmedHere.clear();
    clearInterval(poll); poll = null;
    user = null; loading = sending = loaded = false; messages = []; revision = 0;
    cursors = {inbox_before:null,sent_before:null}; subject = 'New message'; body.value = ''; list.replaceChildren();
    login.hidden = true; report(); controls();
  }
  function heading() {
    byId('profile-conversation-name').textContent = cleanName(viewed?.name);
    byId('profile-conversation-initial').textContent = [...cleanName(viewed?.name)][0].toUpperCase();
    const image = byId('profile-conversation-photo'), photo = viewed?.photo_url;
    const safe = typeof photo === 'string' && /^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/.test(photo);
    image.hidden = !safe;
    if (safe) image.src = photo; else image.removeAttribute('src');
    const next = new URL(win.location.href);
    next.searchParams.set('conversation','open');
    login.href = '/members.html?next=' + encodeURIComponent(next.pathname + next.search);
  }
  function valid(message) {
    return message && MESSAGE.test(message.id || '') && UUID.test(message.sender_id || '') && UUID.test(message.recipient_id || '')
      && ['sender_name','recipient_name','subject','body','created_at'].every(key => typeof message[key] === 'string')
      && message.body.length <= 3000 && message.subject.length <= 100 && Number.isFinite(Date.parse(message.created_at));
  }
  function belongs(message) {
    return valid(message) && !retiredIds.has(message.id) && user && ((message.sender_id === user.id && message.recipient_id === id(viewed))
      || (message.sender_id === id(viewed) && message.recipient_id === user.id));
  }
  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  async function request(path, options = {}) {
    const controller = new AbortController(); requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await send(path, {...options, credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal,
        headers:{Accept:'application/json',...options.headers}});
      const data = await response.json().catch(() => null);
      if (!response.ok) { const error = new Error('Conversation request failed'); error.status = response.status; throw error; }
      if (!data || typeof data !== 'object') throw new Error('Invalid conversation response');
      return data;
    } finally { clearTimeout(timer); requests.delete(controller); }
  }
  function failure(error, generation, action) {
    if (!current(generation)) return;
    if (error.status === 401 || error.status === 403) {
      clear(); login.hidden = false;
      report(error.status === 403 ? 'Your account needs access to private messages. Log in to check your account.' : 'Log in to continue this private conversation.', 'error');
      return;
    }
    if (action === 'send') return; // The outgoing bubble owns its retry and error state.
    if (error.status === 429) return report('Give it a moment, then try again.', 'error');
    report('Messages could not connect. Tap Refresh to try again.', 'error');
  }
  function publishUnread(data) {
    if (Number.isSafeInteger(data?.unread_count) && data.unread_count >= 0) {
      win.dispatchEvent(new CustomEvent('jwhite:messages-changed',{detail:{count:data.unread_count}}));
    }
  }
  async function markRead(message) {
    if (!dialog.open || doc.hidden || !user || retiredIds.has(message.id) || reading.has(message.id)) return;
    const generation = epoch; reading.add(message.id);
    try {
      const data = await request('/api/member-messages/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:message.id})});
      if (current(generation) && !retiredIds.has(message.id) && data.message_id === message.id && data.read === true) publishUnread(data);
    } catch (error) {
      if (!retiredIds.has(message.id) && (error.status === 401 || error.status === 403)) failure(error,generation,'read');
    } finally { if (current(generation)) reading.delete(message.id); }
  }
  async function openMedia(message, kind, host, button) {
    if (!dialog.open || !belongs(message) || media.has(message.id)) return;
    const path = '/api/member-message-' + kind + '/' + message.id;
    if (message[kind]?.url !== path) return;
    const generation = epoch, controller = new AbortController(); requests.add(controller);
    const item = {controller,host}; media.set(message.id,item); button.disabled = true; button.textContent = 'Opening…';
    const timer = setTimeout(() => controller.abort(),20000);
    try {
      const response = await send(path,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
      if (!response.ok) { const error = new Error('Private media unavailable'); error.status = response.status; throw error; }
      const blob = await response.blob();
      if (!current(generation) || !dialog.open || media.get(message.id) !== item) return;
      const types = kind === 'photo' ? ['image/jpeg','image/png','image/webp'] : ['video/mp4','video/webm'];
      if (!types.includes(blob.type) || !blob.size || blob.size > (kind === 'photo' ? 3 : 4) * 1024 * 1024) throw new Error('Invalid media');
      const node = element(kind === 'photo' ? 'img' : 'video','profile-conversation-media');
      item.url = win.URL.createObjectURL(blob); item.node = node; node.src = item.url;
      if (kind === 'video') { node.controls = true; node.playsInline = true; node.preload = 'metadata'; }
      else node.alt = 'Private photo from ' + cleanName(message.sender_name);
      item.host.replaceChildren(node);
    } catch (error) {
      if (!current(generation) || media.get(message.id) !== item) return;
      media.delete(message.id); button.disabled = false; button.textContent = 'Try ' + kind + ' again';
      if (item.host !== host) {
        const again = element('button','','Try ' + kind + ' again'); again.type = 'button';
        again.addEventListener('click',()=>void openMedia(message,kind,item.host,again)); item.host.replaceChildren(again);
      }
      if (error.status === 401 || error.status === 403) failure(error,generation,'read');
    } finally { clearTimeout(timer); requests.delete(controller); }
  }
  function outgoingMessage(entry) {
    return {id:entry.key, sender_id:user?.id, recipient_id:entry.payload.recipient_id,
      subject:entry.payload.subject, body:entry.payload.body, created_at:entry.createdAt};
  }
  function confirmOutgoing(entry, message) {
    if (!belongs(message) || message.sender_id !== user?.id || message.recipient_id !== entry.payload.recipient_id
      || message.body !== entry.payload.body || message.subject !== entry.payload.subject) return false;
    entry.confirmed = true;
    confirmedHere.add(message.id);
    const existing = rows.get(entry.key);
    if (existing && !rows.has(message.id)) rows.set(message.id, existing);
    rows.delete(entry.key); outbox.delete(entry.requestId);
    return true;
  }
  function reconcileOutgoing() {
    for (const entry of outbox.values()) {
      const confirmed = entry.expectedId && messages.find(message => message.id === entry.expectedId);
      if (confirmed) confirmOutgoing(entry,confirmed);
    }
  }
  function render({bottom = false, older = false} = {}) {
    const top = list.scrollTop, height = list.scrollHeight;
    const nearBottom = height - top - list.clientHeight < 100;
    const visible = [...messages.map(message=>({message,entry:null})),
      ...[...outbox.values()].map(entry=>({message:outgoingMessage(entry),entry}))]
      .sort((a,b)=>a.message.created_at.localeCompare(b.message.created_at));
    const nodes = [], keep = new Set();
    if (!visible.length) {
      const text = !loaded ? 'Opening your conversation…' : Object.values(cursors).some(Boolean)
        ? 'No recent messages here. Tap Earlier messages to see more.'
        : 'Say hello to ' + cleanName(viewed?.name) + '.';
      let empty = rows.get('empty');
      if (!empty || empty.signature !== text) { empty = {node:element('li','profile-conversation-empty',text),signature:text}; rows.set('empty',empty); }
      keep.add('empty'); nodes.push(empty.node);
    }
    for (let index = 0; index < visible.length; index += 1) {
      const {message,entry} = visible[index], mine = message.sender_id === user?.id;
      const previous = visible[index-1]?.message, next = visible[index+1]?.message;
      const adjacent = other => other?.sender_id === message.sender_id && Math.abs(Date.parse(other.created_at)-Date.parse(message.created_at)) < 300000;
      const grouped = adjacent(previous), groupEnd = !adjacent(next), status = entry?.status || (confirmedHere.has(message.id) ? 'sent' : '');
      const signature = JSON.stringify([message,grouped,groupEnd,status,entry?.error || '']);
      let cached = rows.get(message.id);
      if (!cached || cached.signature !== signature) {
        const item = cached?.node || element('li');
        item.className = 'profile-conversation-message' + (mine ? ' is-mine' : '') + (grouped ? ' is-grouped' : '') + (entry ? ' is-' + status : '');
        item.dataset.messageId = message.id;
        const bubble = element('div','profile-conversation-bubble');
        bubble.append(element('span','profile-conversation-sender',mine ? 'You' : cleanName(viewed?.name)));
        if (!['New message','Photo','Video'].includes(message.subject)) bubble.append(element('strong','',message.subject));
        if (message.body) bubble.append(element('p','',message.body));
        const kind = message.photo ? 'photo' : message.video ? 'video' : '';
        if (kind && message[kind]?.url === '/api/member-message-' + kind + '/' + message.id) {
          const host = element('div','profile-conversation-attachment'), existing = media.get(message.id);
          if (existing?.node) host.append(existing.node);
          else if (existing) { existing.host = host; host.append(element('span','','Opening…')); }
          else {
            const button = element('button','', 'Open ' + kind); button.type = 'button';
            button.addEventListener('click',()=>void openMedia(message,kind,host,button)); host.append(button);
          }
          bubble.append(host);
        }
        const meta = element('div','profile-conversation-meta');
        if (groupEnd) {
          const time = element('time','',new Date(message.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
          time.dateTime = message.created_at; meta.append(time);
        }
        if (status) {
          const label = element('span','profile-conversation-delivery',status === 'sending' ? 'Sending…' : status === 'failed' ? entry.error : 'Sent');
          label.setAttribute('role','status'); meta.append(label);
        }
        if (entry?.status === 'failed') {
          const button = element('button','profile-conversation-retry','Retry'); button.type = 'button';
          button.setAttribute('aria-label','Retry this message'); entry.retryButton = button;
          button.addEventListener('click',()=>void deliver(entry)); meta.append(button);
        }
        item.replaceChildren(bubble,meta); cached = {node:item,signature}; rows.set(message.id,cached);
      }
      keep.add(message.id); nodes.push(cached.node);
    }
    // Leave unchanged bubbles (and playing attachments) in place on every poll.
    for (let index = 0; index < nodes.length; index += 1) {
      if (list.children[index] !== nodes[index]) list.insertBefore(nodes[index],list.children[index] || null);
    }
    for (const node of [...list.children]) if (!nodes.includes(node)) node.remove();
    for (const key of rows.keys()) if (!keep.has(key)) rows.delete(key);
    if (older) list.scrollTop = top + list.scrollHeight - height;
    else if (bottom || nearBottom) list.scrollTop = list.scrollHeight;
    else list.scrollTop = top;
    controls();
  }
  async function load({older = false, quiet = false} = {}) {
    if (!id(viewed) || !dialog.open || doc.hidden || loading || sending) return;
    const generation = epoch, before = revision, previousCursors = {...cursors};
    loading = true; controls(); if (!quiet) report(older ? 'Opening earlier messages…' : 'Connecting…');
    const query = new URLSearchParams({limit:'100',directory:'0'});
    if (older) for (const [key,value] of Object.entries(cursors)) if (value) query.set(key,value);
    try {
      const data = await request('/api/member-messages?' + query);
      if (!current(generation) || before !== revision) return;
      if (!id(data.user) || (user && id(data.user) !== user.id)) { const error = new Error('Account changed'); error.status = 401; throw error; }
      if (!Array.isArray(data.inbox) || !Array.isArray(data.sent)) throw new Error('Invalid messages');
      const first = !loaded; user = {id:id(data.user)};
      retireMessages(data);
      const added = [...data.inbox,...data.sent].filter(belongs);
      messages = [...new Map([...messages,...added].map(message => [message.id,message])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));
      if (first || older) cursors = Object.fromEntries(['inbox_before','sent_before'].map(key=>[key,older && !previousCursors[key] ? null : typeof data.next?.[key] === 'string' && data.next[key].length <= 128 ? data.next[key] || null : null]));
      reconcileOutgoing(); loaded = true; login.hidden = true; render({bottom:first,older});
      if (!quiet) report(user.id === id(viewed) ? 'This is your profile. Open another person’s profile to message them.' : '');
      publishUnread(data);
      for (const message of added) if (message.recipient_id === user.id && data.unread_ids?.includes(message.id)) void markRead(message);
    } catch (error) { failure(error,generation,'read'); }
    finally { if (current(generation)) { loading = false; controls(); } }
  }
  // This API is for the inbox's already authenticated, current-session mailbox
  // snapshot. Public profile information must never be used to hydrate messages.
  function hydrate(data) {
    if (!id(viewed) || loaded || loading || sending || user || outbox.size || body.value || !id(data?.user)
      || !Array.isArray(data.inbox) || !Array.isArray(data.sent)) return false;
    user = {id:id(data.user)};
    retireMessages(data);
    messages = [...new Map([
      ...data.inbox.filter(message=>belongs(message) && message.recipient_id === user.id),
      ...data.sent.filter(message=>belongs(message) && message.sender_id === user.id)
    ].map(message=>[message.id,{...message}])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));
    cursors = Object.fromEntries(['inbox_before','sent_before'].map(key=>[key,
      typeof data.next?.[key] === 'string' && data.next[key].length <= 128 ? data.next[key] || null : null]));
    loaded = true; revision += 1; login.hidden = true; report(); render({bottom:true});
    return true;
  }
  function fitKeyboard() {
    if (!win.visualViewport || !dialog.style) return;
    if (win.matchMedia?.('(max-width:600px)').matches) {
      dialog.style.setProperty('--conversation-height',win.visualViewport.height + 'px');
      dialog.style.setProperty('--conversation-top',win.visualViewport.offsetTop + 'px');
    } else { dialog.style.removeProperty('--conversation-height'); dialog.style.removeProperty('--conversation-top'); }
  }
  function startPolling() {
    clearInterval(poll);
    poll = setInterval(()=>{if (dialog.open && !doc.hidden) void load({quiet:true});},5000);
  }
  async function open(button) {
    if (!id(viewed)) return false;
    opener = button || opener; heading();
    if (button && !body.value.trim() && !sending) subject = ['profile-business-message','profile-studio-collaborate'].includes(button.id)
      ? cleanName(button.textContent).slice(0,100) || 'New message' : 'New message';
    if (!dialog.open) dialog.showModal();
    fitKeyboard(); render(); startPolling(); await load();
    if (dialog.open && !body.disabled) body.focus({preventScroll:true});
    return true;
  }
  function sendError(error) {
    if (error.status === 429) return 'Try again in a moment';
    if (error.status === 404) return 'Not sent · person unavailable';
    if (error.status === 400 || error.status === 413) return 'Not sent · check your message';
    return 'Send unconfirmed';
  }
  async function deliver(entry) {
    if (!user || !loaded || sending || entry.confirmed || !outbox.has(entry.requestId) || entry.payload.recipient_id !== id(viewed)) return;
    const generation = epoch;
    sending = true; entry.status = 'sending'; entry.error = ''; revision += 1;
    report(); render({bottom:true});
    try {
      // Same deterministic ID as the server: a later poll can confirm a timed-out
      // send by ID, never by matching someone else's text or timestamps.
      const identify = !entry.expectedId && win.crypto.subtle
        ? win.crypto.subtle.digest('SHA-256',new TextEncoder().encode(user.id + ':' + entry.requestId)).then(digest=>{
          if (current(generation)) entry.expectedId = [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
        }).catch(()=>{}) : Promise.resolve();
      const [,delivery] = await Promise.allSettled([identify,request('/api/member-messages/send',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...entry.payload,request_id:entry.requestId})})]);
      if (!current(generation)) return;
      if (delivery.status === 'rejected') throw delivery.reason;
      const data = delivery.value;
      if (!confirmOutgoing(entry,data.message)) throw new Error('Send not confirmed');
      revision += 1;
      messages = [...new Map([...messages,data.message].map(message=>[message.id,message])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at));
      render();
    } catch (error) {
      if (!current(generation)) return;
      if (error.status === 401 || error.status === 403) { failure(error,generation,'send'); return; }
      if (!entry.confirmed) { entry.status = 'failed'; entry.error = sendError(error); render(); }
    } finally { if (current(generation)) { sending = false; controls(); } }
  }
  async function submitMessage(event) {
    event.preventDefault();
    if (!user || !loaded || sending || user.id === id(viewed) || !body.value.trim() || !form.reportValidity()) return;
    const payload = {recipient_id:id(viewed),subject,body:body.value.trim().replace(/\r\n?/g,'\n')};
    if (payload.body.length > 3000) return report('Keep your message within 3,000 characters.','error');
    const requestId = win.crypto.randomUUID();
    const entry = {requestId,key:'outgoing:' + requestId,payload,createdAt:new Date().toISOString(),status:'sending',error:'',confirmed:false};
    outbox.set(requestId,entry);
    body.value = ''; // Keep the next draft separate from this exact retry payload.
    const delivery = deliver(entry);
    if (dialog.open && !body.disabled) body.focus({preventScroll:true});
    await delivery;
  }
  function close() {
    clearInterval(poll); poll = null; revokeMedia();
    if (dialog.open) dialog.close();
    opener?.focus({preventScroll:true});
  }
  function ready(member) {
    if (id(member) !== id(viewed)) { clear(); if (dialog.open) dialog.close(); }
    viewed = id(member) ? member : null;
    if (viewed) heading();
  }
  function sessionChanged() {
    clear();
    if (dialog.open) { render(); void load(); startPolling(); }
  }
  for (const button of openers) button.addEventListener('click',event=>{
    if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !id(viewed)) return;
    event.preventDefault(); void open(button);
  });
  form.addEventListener('submit',submitMessage);
  submit.addEventListener('pointerdown',event=>{if(doc.activeElement === body)event.preventDefault();});
  win.visualViewport?.addEventListener('resize',fitKeyboard);
  win.visualViewport?.addEventListener('scroll',fitKeyboard);
  body.addEventListener('input',controls);
  refresh.addEventListener('click',()=>void load()); more.addEventListener('click',()=>void load({older:true}));
  byId('profile-conversation-close').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{if(event.target === dialog) close();});
  byId('profile-conversation-photo').addEventListener('error',event=>{event.target.hidden = true;});
  win.addEventListener('jwhite:profile-ready',event=>ready(event.detail));
  win.addEventListener('jwhite:session-changed',sessionChanged);
  win.addEventListener('storage',event=>{if(!event.key || event.key === 'gotrue.user') sessionChanged();});
  win.addEventListener('pagehide',()=>{clear();if(dialog.open)dialog.close();});
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)revokeMedia();else if(dialog.open){render();void load({quiet:true});}});
  if (win.JWhitePublicProfile) ready(win.JWhitePublicProfile);
  if (new URL(win.location.href).searchParams.get('conversation') === 'open') {
    if (viewed) void open();
    else win.addEventListener('jwhite:profile-ready',()=>{if(viewed&&!dialog.open)void open();},{once:true});
  }
  return {open,close,clear,setRecipient:ready,hydrate};
}

if (typeof document !== 'undefined' && typeof window !== 'undefined' && document.getElementById('public-profile-message')) createProfileConversation();
