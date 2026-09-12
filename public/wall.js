(() => {
  'use strict';

  const form = document.getElementById('comment-wall-form');
  const submitButton = document.getElementById('wall-submit');
  const status = document.getElementById('wall-status');
  const list = document.getElementById('wall-list');
  const empty = document.getElementById('wall-empty');
  const count = document.getElementById('wall-count');
  if (!form || !submitButton || !status || !list || !empty || !count) return;

  const nameField = form.elements.namedItem('name');
  const messageField = form.elements.namedItem('message');
  const botField = form.elements.namedItem('bot-field');
  if (!nameField || !messageField) return;

  const dateFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric'
  });
  const emptyMessage = 'No comments yet. Be the first to leave a message.';
  let comments = [];
  let total = 0;
  let rendered = '';
  let submitting = false;
  let loading = false;
  let reloadRequested = false;
  let mutationVersion = 0;
  let retryDraft = null;

  const setStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const PHOTO = /^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/;

  const readComment = (comment) => {
    if (!comment || typeof comment !== 'object') return null;
    if (typeof comment.id !== 'string' || !comment.id.trim()) return null;
    if (typeof comment.name !== 'string' || typeof comment.message !== 'string') return null;
    if (typeof comment.published_at !== 'string') return null;
    const name = comment.name.trim();
    const message = comment.message.trim();
    const date = new Date(comment.published_at);
    if (name.length < 2 || name.length > 60 || message.length < 2 || message.length > 1000 || !Number.isFinite(date.getTime())) return null;
    // A comment is joined to a member by the member ID the server stored with
    // it. Without that ID the comment shows initials and links nowhere, so an
    // older comment is never pointed at somebody else's profile.
    const authorId = typeof comment.author_id === 'string' && UUID.test(comment.author_id) ? comment.author_id.toLowerCase() : null;
    const ownProfile = typeof comment.profile_url === 'string' &&
      (comment.profile_url === '/#home' || comment.profile_url === `/profile.html?id=${authorId}`);
    return {
      id: comment.id, name, message, published_at: date.toISOString(), author_id: authorId,
      photo_url: authorId && typeof comment.photo_url === 'string' && PHOTO.test(comment.photo_url) ? comment.photo_url : null,
      profile_url: authorId && ownProfile ? comment.profile_url : null,
      verified: authorId ? comment.verified === true : false,
      verified_owner: authorId ? comment.verified_owner === true : false,
    };
  };

  const initials = (value) => value.split(/\s+/).slice(0, 2)
    .map((word) => Array.from(word)[0]).join('').toLocaleUpperCase();

  const sortComments = (entries) => entries.sort((a, b) =>
    Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id));

  const makeComment = (comment) => {
    const item = document.createElement('li');
    item.className = 'wall-entry';
    const sender = document.createElement('div');
    sender.className = 'wall-comment-sender';
    const avatar = document.createElement('div');
    avatar.className = 'wall-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials(comment.name);
    if (comment.photo_url) {
      const photo = document.createElement('img');
      photo.src = comment.photo_url;
      photo.alt = '';
      photo.loading = 'lazy';
      // A picture that cannot load leaves the initials in place.
      photo.addEventListener('error', () => photo.remove());
      avatar.append(photo);
    }
    const content = document.createElement('div');
    content.className = 'wall-comment-content';
    const heading = document.createElement('div');
    heading.className = 'wall-comment-heading';
    const name = document.createElement('h3');
    name.className = 'wall-comment-name';
    name.textContent = comment.name;
    if (comment.verified_owner || comment.verified) {
      const badge = document.createElement('span');
      badge.className = comment.verified_owner ? 'official-gold-badge' : 'member-verified-badge';
      badge.textContent = '✓';
      badge.title = comment.verified_owner ? 'Official ROOSTER account' : 'Verified on the ROOSTER';
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', comment.verified_owner ? 'Official account' : 'Verified on the ROOSTER');
      name.append(' ', badge);
    }
    const date = document.createElement('time');
    date.className = 'wall-comment-date';
    date.dateTime = comment.published_at;
    const publishedAt = new Date(comment.published_at);
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    date.textContent = `${dateFormat.format(publishedAt)} at ${time.format(publishedAt)}`;
    const message = document.createElement('p');
    message.className = 'wall-comment-message';
    message.textContent = comment.message;
    // The picture and the name are one link to the member's ROOSTER profile.
    const identity = document.createElement(comment.profile_url ? 'a' : 'div');
    identity.className = 'wall-comment-link';
    if (comment.profile_url) {
      identity.href = comment.profile_url;
      identity.setAttribute('aria-label', `Open ${comment.name}'s ROOSTER profile`);
    }
    identity.append(name, avatar);
    sender.append(identity);
    heading.append(date);
    content.append(heading, message);
    item.append(sender, content);
    window.JWhiteWallInteractions?.attach(content,'owner',comment.id);
    return item;
  };

  const render = () => {
    const signature = JSON.stringify(comments);
    if (signature !== rendered) {
      const fragment = document.createDocumentFragment();
      comments.forEach((comment) => fragment.append(makeComment(comment)));
      list.replaceChildren(fragment);
      rendered = signature;
    }
    const label = `${total} ${total === 1 ? 'comment' : 'comments'}`;
    if (count.textContent !== label) count.textContent = label;
    if (empty.textContent !== emptyMessage) empty.textContent = emptyMessage;
    empty.hidden = comments.length > 0;
  };

  const loadComments = async (force = false) => {
    if (document.hidden && !force) return;
    if (loading) {
      // Only a confirmed post needs to queue another fetch. Polls never overlap.
      if (force) reloadRequested = true;
      return;
    }
    loading = true;
    const startedVersion = mutationVersion;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/comments', {
        cache: 'no-store', signal: controller.signal
      });
      if (!response.ok) throw new Error('Comments unavailable');
      const data = await response.json();
      if (!data || !Array.isArray(data.comments) || !Number.isSafeInteger(data.total) || data.total < data.comments.length) {
        throw new Error('Invalid comments response');
      }
      const next = data.comments.map(readComment);
      if (next.some((comment) => !comment)) throw new Error('Invalid comment');
      if (startedVersion !== mutationVersion) {
        // An older request must never erase a comment just confirmed by POST.
        reloadRequested = true;
        return;
      }
      comments = sortComments(Array.from(new Map(next.map((comment) => [comment.id, comment])).values()));
      total = data.total;
      render();
    } catch (error) {
      if (startedVersion === mutationVersion) {
        empty.textContent = comments.length
          ? 'Comments could not refresh. We will try again shortly.'
          : 'Comments could not load. We will try again shortly. You can still leave a comment below.';
        empty.hidden = false;
      }
    } finally {
      window.clearTimeout(timeout);
      loading = false;
      if (reloadRequested) {
        reloadRequested = false;
        loadComments(true);
      }
    }
  };

  const newRequestId = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  [nameField, messageField].forEach((field) => {
    field.addEventListener('input', () => field.setCustomValidity(''));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const name = nameField.value.trim();
    const message = messageField.value.trim();
    nameField.setCustomValidity(name.length < 2 ? 'Please enter a name with at least 2 characters.' :
      name.length > 60 ? 'Please keep your name to 60 characters or fewer.' : '');
    messageField.setCustomValidity(message.length < 2 ? 'Please write a comment with at least 2 characters.' :
      message.length > 1000 ? 'Please keep your comment to 1,000 characters or fewer.' : '');
    if (!form.reportValidity()) return;

    const honeypot = botField ? botField.value : '';
    const draftKey = JSON.stringify([name, message, honeypot]);
    if (!retryDraft || retryDraft.key !== draftKey) retryDraft = { key: draftKey, id: newRequestId() };
    const requestId = retryDraft.id;
    const originalName = nameField.value;
    const originalMessage = messageField.value;
    const originalLabel = submitButton.textContent;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Checking comment…';
    form.setAttribute('aria-busy', 'true');
    setStatus('Checking your comment before it appears…', 'loading');

    try {
      const response = await fetch('/api/comments/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, 'bot-field': honeypot, request_id: requestId }),
        signal: controller.signal
      });
      let data;
      try { data = await response.json(); } catch (error) { throw new Error('Invalid server response'); }
      if (response.status === 422 && data && data.status === 'rejected') {
        setStatus('This wall is for love and respect. Negative comments or personal attacks about anyone are not published. Your draft is still here.', 'error');
        return;
      }
      if (response.status === 202 && data && data.status === 'pending') {
        if (nameField.value === originalName && messageField.value === originalMessage) form.reset();
        retryDraft = null;
        setStatus('Your comment is saved for review and is not public yet.', 'pending');
        return;
      }
      if (!response.ok) {
        const failure = new Error('Submission unavailable');
        if (response.status === 429) failure.publicMessage = 'Please wait a moment before posting again. Your draft is still here.';
        throw failure;
      }
      // Only an explicit approval can add a comment to the public wall.
      // Older or unexpected API responses must never bypass moderation.
      if ((response.status !== 200 && response.status !== 201) || !data || data.status !== 'approved') {
        throw new Error('No approval received');
      }
      const confirmed = readComment(data.comment);
      if (!confirmed) throw new Error('No approved comment received');
      mutationVersion += 1;
      const exists = comments.some((comment) => comment.id === confirmed.id);
      comments = sortComments([...comments.filter((comment) => comment.id !== confirmed.id), confirmed]);
      if (!exists) total += 1;
      render();
      if (nameField.value === originalName && messageField.value === originalMessage) form.reset();
      retryDraft = null;
      setStatus('Your comment is live.', 'success');
      loadComments(true);
    } catch (error) {
      setStatus(error.publicMessage || 'We could not confirm your comment was approved. Your draft is still here. Please try again.', 'error');
    } finally {
      window.clearTimeout(timeout);
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
      form.removeAttribute('aria-busy');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadComments();
  });
  window.addEventListener('focus', () => loadComments());
  window.setInterval(() => loadComments(), 3000);
  loadComments(true);
})();
