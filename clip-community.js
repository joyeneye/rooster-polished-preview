const CLIP_ID = /^[a-f0-9]{64}$/;
const VIEWER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const visible = () => document.visibilityState !== 'hidden';
const validCounts = counts => counts && Number.isSafeInteger(counts.apple) && counts.apple >= 0 && Number.isSafeInteger(counts.tomato) && counts.tomato >= 0;
const validReaction = value => value === null || value === 'apple' || value === 'tomato';
const validComment = value => Boolean(value && CLIP_ID.test(value.id)
  && typeof value.name === 'string' && value.name.trim() && value.name.length <= 120
  && typeof value.body === 'string' && value.body.trim() && value.body.length <= 500
  && typeof value.created_at === 'string' && Number.isFinite(Date.parse(value.created_at)));

export function createClipCommunityController() {
  const panels = new Set();
  let opened = null;
  function element(tag, text = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text) {
    const node = element('button', text);
    node.type = 'button';
    return node;
  }

  function attach(clip, card) {
    if (!CLIP_ID.test(clip.id)) return;
    const section = element('section', '', 'clip-community');
    section.setAttribute('aria-label', `Reactions and comments for ${clip.name}`);
    const reactionRow = element('div', '', 'clip-reactions');
    const apple = button('🍏 Green apples · …');
    const tomato = button('🍅 Tomatoes · …');
    apple.className = 'clip-reaction clip-reaction-apple';
    tomato.className = 'clip-reaction clip-reaction-tomato';
    apple.setAttribute('aria-pressed', 'false');
    tomato.setAttribute('aria-pressed', 'false');
    reactionRow.append(apple, tomato);
    const state = element('p', '', 'clip-community-status');
    state.setAttribute('role', 'status');
    const login = element('a', 'Log in to join in', 'clip-community-login');
    login.href = '/members.html';
    login.hidden = true;
    const retryButton = button('Try loading again');
    retryButton.hidden = true;
    const details = element('details', '', 'clip-comments');
    const summary = element('summary', 'Comments');
    const commentList = element('div', '', 'clip-comments-list');
    const empty = element('p', 'Be the first to leave a kind word.', 'clip-comments-empty');
    const form = element('form', '', 'clip-comment-form');
    const label = element('label', 'Leave a comment');
    const body = element('textarea');
    body.rows = 2;
    body.maxLength = 500;
    body.placeholder = 'Keep it friendly. Share some love.';
    label.append(body);
    const help = element('p', 'Up to 500 characters. Comments are checked before they appear.', 'clip-comment-help');
    const send = button('Post comment');
    send.type = 'submit';
    const commentStatus = element('p', '', 'clip-community-status');
    commentStatus.setAttribute('role', 'status');
    form.append(label, help, send, commentStatus);
    details.append(summary, commentList, empty, form);
    section.append(reactionRow, state, login, retryButton, details);
    card.append(section);

    let epoch = 0;
    let revision = 0;
    let alive = true;
    let loaded = false;
    let seen = false;
    let authenticated = false;
    let viewerId = null;
    let counts = null;
    let mine = null;
    let comments = [];
    let total = 0;
    let loading = false;
    let reacting = false;
    let posting = false;
    let reactionRetry = null;
    let commentRetry = null;
    let interval = null;
    let readController = null;
    let readSequence = 0;
    const requests = new Set();
    const current = generation => alive && epoch === generation && visible();

    function controls() {
      const blocked = !alive || !visible() || !loaded || reacting || posting;
      apple.disabled = tomato.disabled = blocked;
      apple.textContent = `🍏 Green apples · ${counts ? counts.apple : '…'}`;
      tomato.textContent = `🍅 Tomatoes · ${counts ? counts.tomato : '…'}`;
      apple.setAttribute('aria-pressed', String(mine === 'apple'));
      tomato.setAttribute('aria-pressed', String(mine === 'tomato'));
      body.disabled = blocked || !authenticated;
      send.disabled = blocked || !authenticated || !body.value.trim() || body.value.length > 500;
      send.textContent = posting ? 'Posting…' : 'Post comment';
      summary.textContent = loaded ? `Comments (${total})` : 'Comments';
      empty.hidden = !loaded || comments.length > 0;
      retryButton.disabled = loading || reacting || posting || !visible();
      form.setAttribute('aria-busy', String(posting));
    }

    function needLogin() {
      authenticated = false;
      viewerId = null;
      mine = null;
      body.value = '';
      reactionRetry = commentRetry = null;
      login.hidden = false;
      state.textContent = 'Log in to react or leave a comment.';
      controls();
    }

    async function request(path, options = {}, controller = new AbortController()) {
      requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(path, {...options, credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal, headers:{Accept:'application/json', ...options.headers}});
        const data = await response.json().catch(() => null);
        if (!response.ok) { const error = new Error('Community request failed'); error.status = response.status; error.data = data; throw error; }
        if (!data || typeof data !== 'object' || data.id !== clip.id) throw new Error('Invalid community response');
        return data;
      } finally { clearTimeout(timeout); requests.delete(controller); }
    }

    function renderComments(next) {
      if (JSON.stringify(comments) === JSON.stringify(next)) return;
      comments = next;
      const rows = next.map(comment => {
        const row = element('article', '', 'clip-comment');
        const name = element('strong', comment.name);
        const text = element('p', comment.body);
        const time = element('time', new Date(comment.created_at).toLocaleString(undefined, {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}));
        time.dateTime = comment.created_at;
        row.append(name, text, time);
        return row;
      });
      commentList.replaceChildren(...rows);
    }

    async function refresh() {
      if (!alive || !visible() || loading || reacting || posting) return;
      const generation = epoch;
      const sequence = ++readSequence;
      const before = revision;
      const controller = new AbortController();
      readController = controller;
      loading = true;
      controls();
      try {
        const data = await request(`/api/clip-community?id=${clip.id}`, {}, controller);
        if (!current(generation) || sequence !== readSequence || before !== revision) return;
        if (!validCounts(data.counts) || !validReaction(data.my_reaction) || typeof data.authenticated !== 'boolean'
          || (data.authenticated ? !VIEWER_ID.test(data.viewer_id) : data.viewer_id !== null)
          || (!data.authenticated && data.my_reaction !== null) || !Array.isArray(data.comments) || data.comments.length > 100
          || !data.comments.every(validComment) || !Number.isSafeInteger(data.comment_count) || data.comment_count < data.comments.length) throw new Error('Invalid clip community');
        if (viewerId !== data.viewer_id) {
          body.value = '';
          reactionRetry = commentRetry = null;
          commentStatus.textContent = '';
          state.textContent = '';
        }
        authenticated = data.authenticated;
        viewerId = data.viewer_id;
        mine = data.my_reaction;
        counts = data.counts;
        total = data.comment_count;
        renderComments(data.comments);
        loaded = true;
        login.hidden = authenticated;
        retryButton.hidden = true;
        if (state.textContent === 'Reactions and comments could not load. Try again.' || !state.textContent) state.textContent = authenticated ? '' : 'Log in to react or leave a comment.';
      } catch (error) {
        if (!current(generation) || sequence !== readSequence) return;
        if (error.status === 401 || error.status === 403) needLogin();
        else if (error.status === 404) {
          counts = null; mine = null; total = 0; loaded = false;
          renderComments([]);
          body.value = '';
          state.textContent = 'This clip is no longer available.';
          retryButton.hidden = true;
        }
        else { state.textContent = 'Reactions and comments could not load. Try again.'; retryButton.hidden = false; }
      } finally {
        if (current(generation) && sequence === readSequence) { loading = false; readController = null; controls(); }
      }
    }

    async function react(value) {
      if (!alive || !visible() || !loaded || reacting || posting) return;
      if (!authenticated) { needLogin(); return; }
      const generation = epoch;
      const desired = mine === value ? null : value;
      if (!reactionRetry || reactionRetry.selected !== value) reactionRetry = {selected:value, reaction:desired, id:crypto.randomUUID()};
      const attempt = reactionRetry;
      let refreshAfter = false;
      revision += 1;
      reacting = true;
      state.textContent = 'Saving your reaction…';
      controls();
      try {
        const data = await request('/api/clip-reaction', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({clip_id:clip.id, reaction:attempt.reaction, request_id:attempt.id})});
        if (!current(generation)) return;
        if (!validCounts(data.counts) || data.reaction !== attempt.reaction) throw new Error('Reaction not confirmed');
        counts = data.counts;
        mine = data.reaction;
        reactionRetry = null;
        state.textContent = mine === null ? 'Reaction removed.' : mine === 'apple' ? 'Green apple added.' : 'Tomato added.';
      } catch (error) {
        if (!current(generation)) return;
        if (error.status === 401 || error.status === 403) needLogin();
        else if (error.status === 409) {
          reactionRetry = null;
          refreshAfter = true;
          state.textContent = 'Your reaction changed. Loading the latest counts before you choose again.';
        }
        else state.textContent = 'We could not confirm your reaction. Tap the same reaction to try again.';
      } finally { if (current(generation)) { reacting = false; controls(); if (refreshAfter) void refresh(); } }
    }

    async function post(event) {
      event.preventDefault();
      if (!alive || !visible() || !details.open || !loaded || posting || reacting) return;
      if (!authenticated) { needLogin(); return; }
      const text = body.value.replace(/\r\n?/g, '\n').trim();
      if (!text || text.length > 500) { commentStatus.textContent = 'Write a comment of 500 characters or fewer.'; return; }
      const generation = epoch;
      if (!commentRetry || commentRetry.body !== text) commentRetry = {body:text,id:crypto.randomUUID()};
      const attempt = commentRetry;
      revision += 1;
      posting = true;
      commentStatus.textContent = 'Checking your comment…';
      controls();
      let refreshAfter = false;
      try {
        const data = await request('/api/clip-comment', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({clip_id:clip.id, body:attempt.body, request_id:attempt.id})});
        if (!current(generation)) return;
        if (data.status === 'approved' && data.published === true && validComment(data.comment) && data.comment.body === attempt.body) {
          const next = [...new Map([...comments, data.comment].map(comment => [comment.id, comment])).values()];
          total += next.length > comments.length ? 1 : 0;
          renderComments(next);
          body.value = '';
          commentRetry = null;
          commentStatus.textContent = 'Your comment is posted.';
          refreshAfter = true;
        } else if (data.status === 'pending' && data.published === false) {
          body.value = '';
          commentRetry = null;
          commentStatus.textContent = 'Your comment is saved for review and has not been posted.';
        } else if (data.status === 'rejected' && data.published === false) {
          commentRetry = null;
          commentStatus.textContent = 'That comment cannot be posted. Keep it kind and try another message.';
        } else throw new Error('Comment not confirmed');
      } catch (error) {
        if (!current(generation)) return;
        if (error.status === 401 || error.status === 403) needLogin();
        else if (error.status === 422 && error.data?.status === 'rejected' && error.data?.published === false) {
          commentRetry = null;
          commentStatus.textContent = 'That comment cannot be posted. Keep it kind and try another message.';
        } else commentStatus.textContent = 'We could not confirm your comment. Tap Post comment again to check without posting it twice.';
      } finally {
        if (current(generation)) { posting = false; controls(); if (refreshAfter) void refresh(); }
      }
    }

    function stopReads() {
      clearInterval(interval);
      interval = null;
      readSequence += 1;
      readController?.abort();
      readController = null;
      loading = false;
    }
    function suspend({clearDraft = false} = {}) {
      epoch += 1;
      stopReads();
      requests.forEach(controller => controller.abort());
      requests.clear();
      readController = null;
      loading = reacting = posting = false;
      if (clearDraft) {
        body.value = '';
        reactionRetry = commentRetry = null;
        authenticated = false;
        viewerId = null;
        mine = null;
        state.textContent = '';
        commentStatus.textContent = '';
      }
      controls();
    }
    function startPolling() {
      stopReads();
      if (!alive || !details.open || !visible()) return;
      void refresh();
      interval = setInterval(() => { if (details.open && visible()) void refresh(); }, 5000);
    }
    const panel = {
      close() { details.open = false; stopReads(); },
      suspend,
      resume() { if (!alive || (!seen && !details.open)) return; if (details.open) startPolling(); else void refresh(); },
      destroy() { suspend({clearDraft:true}); alive = false; observer?.disconnect(); if (opened === panel) opened = null; panels.delete(panel); },
    };
    panels.add(panel);
    apple.addEventListener('click', () => void react('apple'));
    tomato.addEventListener('click', () => void react('tomato'));
    retryButton.addEventListener('click', () => void refresh());
    body.addEventListener('input', controls);
    form.addEventListener('submit', event => void post(event));
    details.addEventListener('toggle', () => {
      if (details.open) { seen = true; if (opened && opened !== panel) opened.close(); opened = panel; startPolling(); }
      else { stopReads(); if (opened === panel) opened = null; }
    });
    let observer = null;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { seen = true; observer.disconnect(); void refresh(); }
      }, {rootMargin:'250px'});
      observer.observe(section);
    } else { seen = true; void refresh(); }
    controls();
  }

  const onVisibility = () => panels.forEach(panel => visible() ? panel.resume() : panel.suspend());
  const onPageHide = () => panels.forEach(panel => panel.suspend({clearDraft:true}));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  function clear() { [...panels].forEach(panel => panel.destroy()); }
  return {attach, clear};
}
