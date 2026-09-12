// Members share one room. The server verifies the Identity session and
// moderates each submission before it can appear in this conversation.
const CHAT_TTL_MS = 60000;

export function createMemberChat({onSessionExpired}) {
  const byId = id => document.getElementById(id);
  const panel = byId('member-chat');
  const room = byId('chat-room');
  const list = byId('chat-messages');
  const form = byId('chat-compose-form');
  const body = byId('chat-body');
  const status = byId('chat-status');
  const connection = byId('chat-connection');
  const newMessages = byId('chat-new-messages');
  const controllers = new Set();
  let user = null;
  let generation = 0;
  let readSequence = 0;
  let readController = null;
  let poll = null;
  let loading = false;
  let sending = false;
  let loaded = false;
  let connected = false;
  let connectionFailed = false;
  let revision = 0;
  let refreshAgain = false;
  let messages = [];
  let unseen = 0;
  let retry = null;
  let statusKind = '';
  let expiryTimer = null;

  const isCurrent = epoch => Boolean(user && generation === epoch);
  const isVisible = () => document.visibilityState !== 'hidden' && room.open;
  const nearBottom = () => list.scrollHeight - list.clientHeight - list.scrollTop <= 64;

  function report(message, tone = '', kind = '') {
    status.textContent = message;
    status.dataset.tone = tone;
    statusKind = kind;
  }

  function controls() {
    const available = Boolean(user && loaded && connected && isVisible());
    body.disabled = !available || sending;
    byId('chat-send').disabled = !available || sending || !body.value.trim();
    byId('chat-send').textContent = sending ? 'Sending…' : 'Send';
    byId('chat-refresh').disabled = !user || loading || sending;
    byId('chat-character-count').textContent = `${body.value.length}/500`;
    form.setAttribute('aria-busy', String(sending));
    byId('chat-empty').hidden = messages.length > 0;
    byId('chat-empty').textContent = loaded
      ? 'You made it. Be the first to say hello!'
      : 'The conversation will appear here when you connect.';
    const state = !user ? 'offline' : !isVisible() ? 'paused' : connected ? 'live' : connectionFailed ? 'reconnecting' : 'connecting';
    const label = ({offline:'Offline',paused:room.open ? 'Paused' : 'Room closed',live:'Live',reconnecting:'Reconnecting…',connecting:'Connecting…'})[state];
    if (connection.textContent !== label) connection.textContent = label;
    connection.dataset.state = state;
  }

  function updateNewMessages() {
    newMessages.hidden = unseen === 0;
    newMessages.textContent = `${unseen} new message${unseen === 1 ? '' : 's'}`;
  }

  function showLatest() {
    list.scrollTop = list.scrollHeight;
    unseen = 0;
    updateNewMessages();
  }

  function messageValid(message) {
    if (!message || typeof message !== 'object') return false;
    return ['id', 'member_id', 'name', 'body', 'created_at'].every(key => typeof message[key] === 'string')
      && Boolean(message.id && message.member_id && message.name.trim() && message.body.trim())
      && message.id.length <= 200 && message.member_id.length <= 200
      && message.name.length <= 120 && message.body.length <= 500
      && Number.isFinite(Date.parse(message.created_at));
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = null;
    if (!messages.length || !isVisible()) return;
    const nextExpiry = Math.max(0, Math.min(...messages.map(message => CHAT_TTL_MS - (Date.now() - Date.parse(message.created_at)))));
    expiryTimer = setTimeout(() => render(messages), nextExpiry);
  }

  function render(additional) {
    const now = Date.now();
    const visible = additional.filter(message => now - Date.parse(message.created_at) < CHAT_TTL_MS);
    const next = [...new Map(visible.map(message => [message.id, message])).values()]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    if (loaded && JSON.stringify(next) === JSON.stringify(messages)) {
      scheduleExpiry();
      return;
    }
    const stickToEnd = !loaded || nearBottom();
    const oldIds = new Set(messages.map(message => message.id));
    const added = next.filter(message => !oldIds.has(message.id)).length;
    // Keep a visible message in the same place if the server's latest window
    // drops an older row while somebody is reading further up the room.
    const listTop = list.getBoundingClientRect().top;
    const anchor = [...list.children].find(item => item.getBoundingClientRect().bottom >= listTop);
    const anchorId = anchor?.dataset.messageId;
    const anchorTop = anchor?.getBoundingClientRect().top;
    const previousScroll = list.scrollTop;
    const rows = next.map(message => {
      const row = document.createElement('li');
      row.className = message.member_id === user.id ? 'chat-message chat-message-own' : 'chat-message';
      row.dataset.messageId = message.id;
      const meta = document.createElement('div');
      meta.className = 'chat-message-meta';
      const name = document.createElement('a');
      name.className = 'chat-message-name';
      name.href = '/profile.html?id=' + encodeURIComponent(message.member_id);
      name.textContent = message.name;
      const time = document.createElement('time');
      time.dateTime = message.created_at;
      time.textContent = new Date(message.created_at).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
      const text = document.createElement('p');
      text.className = 'chat-message-body';
      text.textContent = message.body;
      const messageLink=document.createElement('a');
      messageLink.className='chat-message-write';
      messageLink.textContent='Message';
      // Message opens a private conversation with this exact person. The href
      // is the plain fallback for a new tab or a browser without scripts; the
      // click below keeps the member on this page, so the chat room stays put
      // behind the message and any ROOSTER LIVE room stays connected.
      messageLink.href='/members.html?to='+encodeURIComponent(message.member_id)
        +'&name='+encodeURIComponent(message.name || '')+'#member-mail';
      messageLink.dataset.messageMember=message.member_id;
      messageLink.dataset.messageName=message.name || '';
      messageLink.setAttribute('aria-label','Private message '+message.name);
      messageLink.addEventListener('click',(event)=>{
        if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0) return;
        // The member account answers this by opening the conversation and
        // cancelling the event. Nothing listening means this chat is not
        // inside the account, so the link does what it says instead.
        const handled=!document.dispatchEvent(new CustomEvent('roster:open-conversation',{
          cancelable:true,
          detail:{id:message.member_id,name:message.name,back:'chat'},
        }));
        if(handled) event.preventDefault();
      });
      meta.append(name, time, messageLink);
      row.append(meta, text);
      return row;
    });
    list.replaceChildren(...rows);
    messages = next;
    if (stickToEnd) showLatest();
    else {
      list.scrollTop = previousScroll;
      const nextAnchor = rows.find(row => row.dataset.messageId === anchorId);
      if (nextAnchor && Number.isFinite(anchorTop)) list.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop;
      unseen += added;
      updateNewMessages();
    }
    scheduleExpiry();
    controls();
  }

  async function request(path, options = {}, controller = new AbortController()) {
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), options.method === 'POST' ? 20000 : 5000);
    try {
      const response = await fetch(path, {
        ...options, credentials:'same-origin', cache:'no-store', signal:controller.signal,
        headers:{Accept:'application/json', ...options.headers},
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error('Chat request failed');
        error.status = response.status;
        error.data = data;
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid chat response');
      return data;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  function handleError(error, epoch, action) {
    if (!isCurrent(epoch)) return;
    if (error.status === 401 || error.status === 403) {
      clear();
      onSessionExpired(error.status === 403 ? 'confirmation' : 'session');
      return;
    }
    if (error.status === 429) {
      report('Give the room a moment, then try again.', 'error', action);
      return;
    }
    if (action === 'send') {
      if (error.status === 422 && error.data?.status === 'rejected' && error.data?.published === false) {
        report('That message cannot be shared here. Keep it kind and try a different message.', 'error', action);
      } else if (error.status === 400 || error.status === 413) {
        report('Write a message of 500 characters or fewer, then try again.', 'error', action);
      } else if (error.status === 409) {
        report('That send could not be confirmed. Refresh the room before sending a new message.', 'error', action);
      } else {
        report('We could not confirm your message. Tap Send again to check without posting it twice.', 'error', action);
      }
      return;
    }
    report('Connection interrupted. Reconnecting to the conversation…', 'error', 'read');
  }

  async function refresh({manual = false, urgent = false} = {}) {
    if (!user || !isVisible() || sending) return;
    if (loading) {
      if (manual || urgent) refreshAgain = true;
      return;
    }
    const epoch = generation;
    const reconnecting = loaded && !connected;
    const sequence = ++readSequence;
    const before = revision;
    const controller = new AbortController();
    readController = controller;
    loading = true;
    if (manual || !loaded) report('Joining the conversation…', '', 'read');
    controls();
    try {
      const data = await request('/api/member-chat', {}, controller);
      if (!isCurrent(epoch) || sequence !== readSequence || !isVisible()) return;
      if (data.room !== 'The Listening Room' || !Array.isArray(data.messages) || data.messages.length > 200 || !data.messages.every(messageValid)) throw new Error('Invalid room messages');
      if (before !== revision) { refreshAgain = true; return; }
      connected = true;
      connectionFailed = false;
      render(data.messages);
      loaded = true;
      controls();
      if (statusKind === 'read') report(manual ? 'The room is up to date.' : reconnecting ? 'Back in the conversation.' : 'You’re in. Say hello!', '', 'read-complete');
    } catch (error) {
      if (!isCurrent(epoch) || sequence !== readSequence || !isVisible()) return;
      connected = false;
      connectionFailed = true;
      handleError(error, epoch, 'read');
    } finally {
      if (isCurrent(epoch) && sequence === readSequence) {
        loading = false;
        readController = null;
        controls();
        if (refreshAgain) { refreshAgain = false; void refresh(); }
      }
    }
  }

  function suspendRead() {
    window.RosterChatGlow?.leave();
    clearInterval(poll);
    clearTimeout(expiryTimer);
    expiryTimer = null;
    poll = null;
    readSequence += 1;
    readController?.abort();
    readController = null;
    loading = false;
    connected = false;
    refreshAgain = false;
    controls();
  }

  function startPolling() {
    if (!user || !isVisible()) return;
    // The open room is what makes the Chat Room tab glow for everybody else.
    window.RosterChatGlow?.enter();
    if (loaded) render(messages);
    if (poll === null) poll = setInterval(() => { if (isVisible() && !sending) void refresh(); }, 1000);
    void refresh();
  }

  function clear() {
    window.RosterChatGlow?.leave();
    generation += 1;
    readSequence += 1;
    user = null;
    clearInterval(poll);
    clearTimeout(expiryTimer);
    expiryTimer = null;
    poll = null;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    readController = null;
    loaded = connected = connectionFailed = loading = sending = refreshAgain = false;
    revision = 0;
    messages = [];
    unseen = 0;
    retry = null;
    body.value = '';
    list.replaceChildren();
    list.scrollTop = 0;
    report('');
    updateNewMessages();
    panel.hidden = true;
    controls();
  }

  function setUser(member) {
    if (member?.id && member.id === user?.id) return;
    clear();
    if (!member?.id) return;
    user = {id:member.id};
    window.RosterChatGlow?.setUser(user);
    panel.hidden = false;
    controls();
    startPolling();
  }

  body.addEventListener('input', controls);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!user || sending || !loaded || !connected || !isVisible() || !form.reportValidity()) return;
    const text = body.value.trim().replace(/\r\n?/g, '\n');
    if (!text || body.value.length > 500) {
      report('Write a message of 500 characters or fewer first.', 'error', 'send');
      return;
    }
    if (!retry || retry.body !== text) retry = {body:text, requestId:crypto.randomUUID()};
    const payload = {body:text, request_id:retry.requestId};
    const epoch = generation;
    sending = true;
    controls();
    report('Sending your message…', '', 'send');
    void (async () => {
      let refreshAfterSend = false;
      try {
        const data = await request('/api/member-chat/send', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
        if (!isCurrent(epoch)) return;
        if (data.status === 'approved' && data.published === true) {
          if (!messageValid(data.message) || data.message.member_id !== user.id || data.message.body !== text) throw new Error('Invalid send confirmation');
          revision += 1;
          render([...messages.filter(message => message.id !== data.message.id), data.message]);
          body.value = '';
          retry = null;
          report('Message sent.', 'success', 'send');
          refreshAfterSend = true;
        } else if (data.status === 'pending' && data.published === false) {
          report('Your message is held for review and has not been posted.', '', 'send');
        } else if (data.status === 'rejected' && data.published === false) {
          report('That message cannot be shared here. Keep it kind and try a different message.', 'error', 'send');
        } else throw new Error('Invalid moderation response');
      } catch (error) {
        handleError(error, epoch, 'send');
      } finally {
        if (isCurrent(epoch)) {
          sending = false;
          controls();
          if (refreshAfterSend || refreshAgain) { refreshAgain = false; void refresh({urgent:true}); }
        }
      }
    })();
  });
  byId('chat-refresh').addEventListener('click', () => void refresh({manual:true}));
  newMessages.addEventListener('click', () => { showLatest(); list.focus({preventScroll:true}); });
  list.addEventListener('scroll', () => { if (nearBottom()) { unseen = 0; updateNewMessages(); } });
  room.addEventListener('toggle', () => { if (isVisible()) startPolling(); else suspendRead(); });
  document.addEventListener('visibilitychange', () => { if (isVisible()) startPolling(); else suspendRead(); });
  window.addEventListener('pagehide', clear);
  window.addEventListener('hashchange', () => {
    if (!user || window.location.hash !== '#member-chat') return;
    room.open = true;
    startPolling();
    panel.scrollIntoView?.({block:'start'});
  });
  list.setAttribute('tabindex', '0');
  clear();
  return {setUser};
}
