// Authentication stays in @netlify/identity. Its nf_jwt cookie accompanies
// these same origin requests; the server checks the member on every request.
import {preparePrivatePhoto} from './photo-helper.js';
import {preparePrivateVideo, recordPrivateVideo} from './video-helper.js';
import {createProfileConversation} from './profile-message.js';

export function createMemberInbox({onSessionExpired}) {
  const byId = (id) => document.getElementById(id);
  const panel = byId('member-mail');
  const messenger = createProfileConversation();
  const status = byId('mail-status');
  const list = byId('mail-list');
  const form = byId('mail-compose-form');
  const recipient = byId('mail-recipient');
  const MEMBER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const recipientParams = new URLSearchParams(window.location?.search || '');
  let requestedRecipient = recipientParams.getAll('to').length === 1 && MEMBER_ID.test(recipientParams.get('to') || '') ? recipientParams.get('to').toLowerCase() : null;
  let requestedName = cleanName(recipientParams.get('name'));
  const subject = byId('mail-subject');
  const body = byId('mail-body');
  byId('mail-video-input').accept = 'video/mp4,video/webm,video/quicktime,.mp4,.mov,.m4v,.webm';
  const tabs = [...document.querySelectorAll('[data-mail-go]')];
  const controllers = new Set();
  let user = null;
  let generation = 0;
  let revision = 0;
  let poll = null;
  let loading = false;
  let sending = false;
  let loaded = false;
  let refreshAgain = false;
  let active = 'inbox';
  let folder = 'inbox';
  let selectedId = null;
  let inbox = [];
  let sent = [];
  let unreadCount = 0;
  let unreadIds = new Set();
  let retiredIds = new Set();
  let markingRead = new Set();
  let members = [];
  let pagedMemberIds = new Set();
  /* The person a conversation was opened with. Somebody reached through
     Message in the chat room, or by replying, is always available to write to
     even when the loaded page of the roster does not happen to include them.
     Without this, Message quietly landed on the inbox instead of on them. */
  let pinned = null;
  /* Where the member came from, so they can get back in one tap. */
  let backTo = null;
  let retry = null;
  let draftPhoto = null;
  let draftPhotoId = null;
  let draftPhotoURL = null;
  let preparingPhoto = false;
  let preparation = null;
  let photoRevision = 0;
  let detailPhotoURL = null;
  let detailPhotoKey = null;
  let detailPhotoRequest = null;
  let detailPhotoRevision = 0;
  let draftVideo = null;
  let draftVideoId = null;
  let draftVideoURL = null;
  let videoPreparation = null;
  let preparingVideo = false;
  let videoRevision = 0;
  let recording = null;
  let detailVideoURL = null;
  let detailVideoKey = null;
  let detailVideoRequest = null;
  let detailVideoRevision = 0;
  let next = {inbox_before:null,sent_before:null,members_after:null};

  const isCurrent = (epoch) => user && generation === epoch;

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /** Everybody this member can write to right now. */
  function knows(id) {
    return members.some(member => member.id === id) || pinned?.id === id;
  }

  function report(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function dateText(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString(undefined, {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  }

  function messageValid(message) {
    return message && ['id','sender_id','recipient_id','sender_name','recipient_name','subject','body','created_at'].every(key => typeof message[key] === 'string');
  }

  function publishUnread() {
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('jwhite:messages-changed', {detail:{count:unreadCount}}));
    }
  }

  function mergeUnread(data, pageMessages, replace = false) {
    if (!Number.isSafeInteger(data?.unread_count) || data.unread_count < 0 || !Array.isArray(data.unread_ids)) return;
    const pageIds = new Set(pageMessages.map(message => message.id));
    const nextUnread = replace ? new Set() : new Set(unreadIds);
    for (const id of pageIds) nextUnread.delete(id);
    for (const id of data.unread_ids) if (typeof id === 'string' && pageIds.has(id) && !retiredIds.has(id)) nextUnread.add(id);
    unreadIds = nextUnread;
    unreadCount = data.unread_count;
    publishUnread();
  }

  function retireMessages(data) {
    if (!Array.isArray(data.retired_message_ids)) return;
    for (const id of data.retired_message_ids) if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) retiredIds.add(id);
    inbox = inbox.filter(message => !retiredIds.has(message.id));
    sent = sent.filter(message => !retiredIds.has(message.id));
    let removedUnread = 0;
    for (const id of retiredIds) {
      if (unreadIds.delete(id)) removedUnread += 1;
      markingRead.delete(id);
    }
    if (removedUnread) {
      unreadCount = Math.max(0, unreadCount - removedUnread);
      publishUnread();
    }
    if (retiredIds.has(selectedId)) {
      selectedId = null;
      if (active === 'detail') active = folder;
      clearDetailPhoto();
      clearDetailVideo();
      ['mail-message-subject','mail-message-from','mail-message-to','mail-message-date','mail-message-body'].forEach(id => { byId(id).textContent = ''; });
      byId('mail-message-date').removeAttribute('datetime');
    }
  }

  function sortMessages(messages) {
    return messages.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  function controls() {
    const available = Boolean(user && loaded && (members.length || pinned));
    recipient.disabled = !available || sending;
    subject.disabled = !available || sending;
    body.disabled = !available || sending;
    byId('mail-send').disabled = !available || sending || preparingPhoto || preparingVideo;
    byId('mail-send').textContent = sending ? 'Sending…' : 'Send Message';
    if (byId('mail-open-chat')) {
      byId('mail-open-chat').hidden = !messenger;
      byId('mail-open-chat').disabled = !available || sending || !knows(recipient.value);
    }
    if (!messenger && byId('mail-attachments-compose')) byId('mail-attachments-compose').open = true;
    byId('mail-sent-tab').hidden = Boolean(messenger);
    byId('mail-refresh').disabled = !user || loading || sending;
    byId('mail-load-more').disabled = !user || loading || sending;
    byId('mail-more-members').disabled = !user || loading || sending;
    byId('mail-more-members').hidden = !next.members_after;
    tabs.forEach(tab => { tab.disabled = !user || sending; });
    byId('mail-no-members').hidden = !loaded || members.length > 0 || Boolean(pinned);
    byId('mail-add-photo').disabled = !available || sending || Boolean(recording);
    byId('mail-photo-input').disabled = !available || sending || Boolean(recording);
    byId('mail-remove-photo').disabled = sending;
    byId('mail-add-video').disabled = !available || sending || Boolean(recording);
    byId('mail-video-input').disabled = !available || sending || Boolean(recording);
    byId('mail-record-video').disabled = !available || sending || Boolean(recording);
    byId('mail-remove-video').disabled = sending;
    byId('mail-stop-recording').disabled = !recording;
    byId('mail-cancel-recording').disabled = !preparingVideo;
    body.required = !draftPhoto && !draftVideo;
    subject.required = false;
    form.setAttribute('aria-busy', String(sending));
  }

  function photoReport(text) { byId('mail-photo-status').textContent = text; }

  function clearDraftPreview() {
    if (draftPhotoURL) URL.revokeObjectURL(draftPhotoURL);
    draftPhotoURL = null;
    byId('mail-photo-preview').removeAttribute('src');
    byId('mail-photo-draft').hidden = true;
  }

  function stopPhotoPreparation() {
    photoRevision += 1;
    preparation?.abort();
    preparation = null;
    preparingPhoto = false;
    byId('mail-photo-input').value = '';
  }

  function clearDraftPhoto() {
    stopPhotoPreparation();
    clearDraftPreview();
    draftPhoto = null;
    draftPhotoId = null;
    photoReport('');
  }

  function clearVideoElement(id) {
    const element = byId(id);
    element.pause();
    element.srcObject = null;
    element.removeAttribute('src');
    element.load();
  }

  function clearVideoPreview() {
    clearVideoElement('mail-video-preview');
    if (draftVideoURL) URL.revokeObjectURL(draftVideoURL);
    draftVideoURL = null;
    byId('mail-video-draft').hidden = true;
  }

  function stopVideoPreparation() {
    videoRevision += 1;
    videoPreparation?.abort();
    videoPreparation = null;
    recording?.cancel();
    recording = null;
    preparingVideo = false;
    clearVideoElement('mail-recording-preview');
    byId('mail-recording').hidden = true;
    byId('mail-recording-countdown').textContent = '';
    byId('mail-video-input').value = '';
  }

  function clearDraftVideo() {
    stopVideoPreparation();
    clearVideoPreview();
    draftVideo = null;
    draftVideoId = null;
  }

  function renderDraftVideo() {
    if (active !== 'compose' || !draftVideo) { clearVideoPreview(); return; }
    if (!draftVideoURL) {
      draftVideoURL = URL.createObjectURL(draftVideo);
      byId('mail-video-preview').src = draftVideoURL;
    }
    byId('mail-video-draft').hidden = false;
  }

  async function chooseVideo(capture = false) {
    if (!user || sending || active !== 'compose' || recording) return;
    const file = capture ? null : byId('mail-video-input').files?.[0];
    if (!capture && !file) return;
    stopPhotoPreparation();
    stopVideoPreparation();
    const epoch = generation;
    const version = videoRevision;
    const controller = new AbortController();
    videoPreparation = controller;
    preparingVideo = true;
    const current = () => isCurrent(epoch) && version === videoRevision && active === 'compose' && document.visibilityState !== 'hidden';
    photoReport(capture ? 'Allow your camera and microphone to record a private clip.' : 'Checking your video…');
    controls();
    try {
      let video;
      if (capture) {
        byId('mail-recording').hidden = false;
        recording = recordPrivateVideo({
          signal:controller.signal,
          onStream(stream) {
            if (!current()) return;
            if (!stream) { clearVideoElement('mail-recording-preview'); return; }
            const preview = byId('mail-recording-preview');
            preview.muted = true;
            preview.srcObject = stream;
            preview.play()?.catch(() => {});
          },
          onTick(seconds) {
            if (current()) byId('mail-recording-countdown').textContent = `${seconds} seconds left`;
          },
        });
        controls();
        video = await recording.result;
      } else video = await preparePrivateVideo(file, {signal:controller.signal,onProgress(percent) {
        if (current()) photoReport(`Making your phone video smaller… ${percent}%. Keep this page open.`);
      }});
      if (!current()) return;
      clearDraftPhoto();
      clearVideoPreview();
      draftVideo = video;
      draftVideoId = crypto.randomUUID();
      retry = null;
      renderDraftVideo();
      photoReport('Video ready. Watch it first, then tap Send Message.');
    } catch (error) {
      if (!current()) return;
      if (error.name !== 'AbortError') photoReport(error.message || 'We could not open your camera. Try Add video to choose a clip instead.');
    } finally {
      if (isCurrent(epoch) && version === videoRevision) {
        preparingVideo = false;
        videoPreparation = null;
        recording = null;
        clearVideoElement('mail-recording-preview');
        byId('mail-recording').hidden = true;
        controls();
      }
    }
  }

  function renderDraftPhoto() {
    if (active !== 'compose' || !draftPhoto) { clearDraftPreview(); return; }
    if (!draftPhotoURL) draftPhotoURL = URL.createObjectURL(draftPhoto);
    byId('mail-photo-preview').src = draftPhotoURL;
    byId('mail-photo-draft').hidden = false;
  }

  async function choosePhoto() {
    if (!user || sending || active !== 'compose') return;
    const file = byId('mail-photo-input').files?.[0];
    if (!file) return;
    stopVideoPreparation();
    stopPhotoPreparation();
    const epoch = generation;
    const version = photoRevision;
    const controller = new AbortController();
    preparation = controller;
    preparingPhoto = true;
    photoReport('Getting your picture ready…');
    controls();
    try {
      const photo = await preparePrivatePhoto(file, {signal:controller.signal});
      if (!isCurrent(epoch) || version !== photoRevision || active !== 'compose') return;
      clearDraftVideo();
      clearDraftPreview();
      draftPhoto = photo;
      draftPhotoId = crypto.randomUUID();
      retry = null;
      renderDraftPhoto();
      photoReport('Picture ready. Tap Send Message when you are ready.');
    } catch (error) {
      if (!isCurrent(epoch) || version !== photoRevision) return;
      if (error.name !== 'AbortError') photoReport(error.message || 'We could not prepare that picture. Try another one.');
    } finally {
      if (isCurrent(epoch) && version === photoRevision) {
        preparingPhoto = false;
        preparation = null;
        controls();
      }
    }
  }

  function clearDetailPhoto() {
    detailPhotoRevision += 1;
    detailPhotoRequest?.abort();
    detailPhotoRequest = null;
    detailPhotoKey = null;
    if (detailPhotoURL) URL.revokeObjectURL(detailPhotoURL);
    detailPhotoURL = null;
    byId('mail-message-photo').removeAttribute('src');
    byId('mail-message-photo').hidden = true;
    byId('mail-message-photo-wrap').hidden = true;
    byId('mail-message-photo-status').textContent = '';
    byId('mail-photo-retry').hidden = true;
  }

  async function renderDetailPhoto(message) {
    const expected = /^[a-f0-9]{64}$/.test(message.id) ? `/api/member-message-photo/${message.id}` : null;
    if (!message.photo || !expected || message.photo.url !== expected || document.visibilityState === 'hidden') {
      clearDetailPhoto();
      return;
    }
    if (detailPhotoKey === expected) return;
    clearDetailPhoto();
    detailPhotoKey = expected;
    const epoch = generation;
    const version = detailPhotoRevision;
    const controller = new AbortController();
    detailPhotoRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    byId('mail-message-photo-wrap').hidden = false;
    byId('mail-message-photo-status').textContent = 'Opening private picture…';
    const current = () => isCurrent(epoch) && version === detailPhotoRevision && active === 'detail' && selectedId === message.id && document.visibilityState !== 'hidden';
    try {
      const response = await fetch(expected, {credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal, headers:{Accept:'image/jpeg,image/png,image/webp'}});
      if (!current()) return;
      if (!response.ok) {
        const error = new Error('Private picture could not open'); error.status = response.status; throw error;
      }
      const blob = await response.blob();
      if (!current()) return;
      if (!['image/jpeg','image/png','image/webp'].includes(blob.type) || !blob.size || blob.size > 3 * 1024 * 1024) throw new Error('Invalid private picture');
      detailPhotoURL = URL.createObjectURL(blob);
      byId('mail-message-photo').src = detailPhotoURL;
      byId('mail-message-photo').hidden = false;
      byId('mail-message-photo-status').textContent = '';
    } catch (error) {
      if (!current()) return;
      if (error.status === 401 || error.status === 403) { handleError(error, epoch, 'read'); return; }
      clearDetailPhoto();
      detailPhotoKey = expected;
      byId('mail-message-photo-wrap').hidden = false;
      byId('mail-message-photo-status').textContent = 'This picture could not open. Tap Try photo again.';
      byId('mail-photo-retry').hidden = false;
    } finally {
      clearTimeout(timeout);
      if (version === detailPhotoRevision) detailPhotoRequest = null;
    }
  }

  function clearDetailVideo() {
    detailVideoRevision += 1;
    detailVideoRequest?.abort();
    detailVideoRequest = null;
    detailVideoKey = null;
    clearVideoElement('mail-message-video');
    if (detailVideoURL) URL.revokeObjectURL(detailVideoURL);
    detailVideoURL = null;
    byId('mail-message-video').hidden = true;
    byId('mail-message-video-wrap').hidden = true;
    byId('mail-message-video-status').textContent = '';
    byId('mail-video-retry').hidden = true;
  }

  async function renderDetailVideo(message) {
    const expected = /^[a-f0-9]{64}$/.test(message.id) ? `/api/member-message-video/${message.id}` : null;
    if (!message.video || message.photo || !expected || message.video.url !== expected || document.visibilityState === 'hidden') {
      clearDetailVideo();
      return;
    }
    if (detailVideoKey === expected) return;
    clearDetailVideo();
    detailVideoKey = expected;
    const epoch = generation;
    const version = detailVideoRevision;
    const controller = new AbortController();
    detailVideoRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    byId('mail-message-video-wrap').hidden = false;
    byId('mail-message-video-status').textContent = 'Opening private video…';
    const current = () => isCurrent(epoch) && version === detailVideoRevision && active === 'detail' && selectedId === message.id && document.visibilityState !== 'hidden';
    try {
      const response = await fetch(expected, {credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'video/mp4,video/webm'}});
      if (!current()) return;
      if (!response.ok) { const error = new Error('Private video could not open'); error.status = response.status; throw error; }
      const blob = await response.blob();
      if (!current()) return;
      if (!['video/mp4','video/webm'].includes(blob.type) || !blob.size || blob.size > 4 * 1024 * 1024) throw new Error('Invalid private video');
      detailVideoURL = URL.createObjectURL(blob);
      byId('mail-message-video').src = detailVideoURL;
      byId('mail-message-video').hidden = false;
      byId('mail-message-video-status').textContent = '';
    } catch (error) {
      if (!current()) return;
      if (error.status === 401 || error.status === 403) { handleError(error, epoch, 'read'); return; }
      clearDetailVideo();
      detailVideoKey = expected;
      byId('mail-message-video-wrap').hidden = false;
      byId('mail-message-video-status').textContent = 'This video could not open. Tap Try video again.';
      byId('mail-video-retry').hidden = false;
    } finally {
      clearTimeout(timeout);
      if (version === detailVideoRevision) detailVideoRequest = null;
    }
  }

  function renderMembers() {
    const previous = recipient.value || requestedRecipient;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose somebody on the roster';
    const options = [placeholder];
    const names = new Map();
    for (const member of members) {
      const name = (member.name || 'Member').trim().toLowerCase();
      names.set(name, (names.get(name) || 0) + 1);
    }
    // The person a conversation was opened with comes first and is always
    // offered, whichever page of the roster this inbox happens to have loaded.
    if (pinned && !members.some(member => member.id === pinned.id)) {
      const option = document.createElement('option');
      option.value = pinned.id;
      option.textContent = pinned.name;
      options.push(option);
    }
    for (const member of members) {
      const option = document.createElement('option');
      option.value = member.id;
      const name = member.name || 'Member';
      option.textContent = names.get(name.trim().toLowerCase()) > 1 ? `${name} (${member.id.slice(0,8)})` : name;
      options.push(option);
    }
    recipient.replaceChildren(...options);
    recipient.value = knows(previous) ? previous : '';
    if (requestedRecipient && recipient.value === requestedRecipient) requestedRecipient = null;
  }

  function conversationRows() {
    const latest = new Map();
    for (const message of sortMessages([...inbox,...sent])) {
      const peer = message.sender_id === user?.id ? message.recipient_id : message.sender_id;
      if (!latest.has(peer)) latest.set(peer,message);
    }
    return [...latest.values()];
  }

  function openTextConversation(person, button) {
    if (!messenger || !user || sending || !MEMBER_ID.test(person?.id || '') || person.id === user.id) return false;
    messenger.setRecipient({id:person.id,name:cleanName(person.name) || 'Member'});
    if (loaded) messenger.hydrate?.({user,inbox,sent,unread_count:unreadCount,unread_ids:[...unreadIds],retired_message_ids:[...retiredIds],next});
    void messenger.open(button);
    return true;
  }

  function renderRows() {
    const messages = messenger ? conversationRows() : folder === 'sent' ? sent : inbox;
    byId('mail-load-more').hidden = messenger ? !next.inbox_before && !next.sent_before : !next[folder === 'sent' ? 'sent_before' : 'inbox_before'];
    list.replaceChildren();
    byId('mail-list-heading').textContent = messenger ? 'Messages' : folder === 'sent' ? 'Sent by You' : 'Your Conversations';
    byId('mail-empty').hidden = loaded && messages.length > 0;
    byId('mail-empty').textContent = !loaded
      ? 'Your messages will show up here once your inbox connects.'
      : folder === 'sent'
        ? "You haven't sent anything yet. Tap New."
        : 'No conversations yet. Tap New to say hello to somebody on the ROOSTER.';
    for (const message of messages) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const peer = message.sender_id === user.id ? {id:message.recipient_id,name:message.recipient_name} : {id:message.sender_id,name:message.sender_name};
      const isUnread = messenger ? inbox.some(item => item.sender_id === peer.id && unreadIds.has(item.id)) : folder === 'inbox' && unreadIds.has(message.id);
      button.className = isUnread ? 'mail-row is-unread' : 'mail-row';
      if (isUnread) button.setAttribute('aria-label', `New message from ${message.sender_name || 'Member'}: ${message.subject}`);
      const person = messenger ? peer.name : folder === 'sent' ? message.recipient_name : message.sender_name;
      const badge = document.createElement('span');
      badge.className = 'mail-avatar';
      badge.textContent = [...(person || 'M')][0].toUpperCase();
      badge.setAttribute('aria-hidden', 'true');
      const from = document.createElement('span');
      from.className = 'mail-row-person';
      from.textContent = !messenger && folder === 'sent' ? `To: ${person || 'Member'}` : person || 'Member';
      const summary = document.createElement('span');
      summary.className = 'mail-row-summary';
      const title = document.createElement('strong');
      title.textContent = message.photo ? `${message.subject || 'Photo'} · Photo` : message.video ? `${message.subject || 'Video'} · Video` : message.subject;
      if (messenger && ['New message','Photo','Video'].includes(message.subject)) title.hidden = true;
      const preview = document.createElement('span');
      preview.className = 'mail-row-preview';
      const cleanPreview = String(message.body || '').replace(/\s+/g, ' ').trim();
      preview.textContent = cleanPreview.length > 82 ? `${cleanPreview.slice(0, 79)}…` : cleanPreview || 'Open message';
      const timestamp = document.createElement('time');
      timestamp.dateTime = message.created_at;
      timestamp.textContent = messenger ? new Date(message.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : dateText(message.created_at);
      summary.append(title, preview, timestamp);
      if (isUnread) {
        const fresh = document.createElement('span');
        fresh.className = 'mail-new-badge';
        fresh.textContent = 'NEW';
        fresh.setAttribute('aria-hidden', 'true');
        summary.append(fresh);
      }
      button.append(badge, from, summary);
      button.addEventListener('click', () => {
        if (openTextConversation(peer,button)) return;
        selectedId = message.id;
        active = 'detail';
        render();
        byId('mail-message-subject').focus();
        if (isUnread) void markRead(message);
      });
      item.append(button);
      list.append(item);
    }
  }

  function selectedMessage() {
    return (folder === 'sent' ? sent : inbox).find(message => message.id === selectedId);
  }

  function renderDetail() {
    const message = selectedMessage();
    if (!message) {
      active = folder;
      return;
    }
    byId('mail-back').textContent = folder === 'sent' ? '‹ Sent by You' : '‹ Your Conversations';
    byId('mail-message-subject').textContent = message.subject;
    byId('mail-message-from').textContent = message.sender_name || 'Member';
    byId('mail-message-to').textContent = message.recipient_name || 'Member';
    byId('mail-message-date').textContent = dateText(message.created_at);
    byId('mail-message-date').dateTime = message.created_at;
    byId('mail-message-body').textContent = message.body;
    byId('mail-reply').hidden = message.sender_id === user?.id;
    void renderDetailPhoto(message);
    void renderDetailVideo(message);
  }

  /** Open a private conversation with one exact person: the member behind
   * Message in the chat room, on a profile, or in a link. */
  function openConversation(request = {}) {
    const id = typeof request.id === 'string' && MEMBER_ID.test(request.id.trim()) ? request.id.trim().toLowerCase() : '';
    if (!user || sending || !id || id === user.id) return false;
    if (openTextConversation({id,name:request.name || members.find(member => member.id === id)?.name})) return true;
    pinned = {id, name: cleanName(request.name) || members.find(member => member.id === id)?.name || 'This member'};
    backTo = request.back === 'chat' ? 'chat' : null;
    renderMembers();
    recipient.value = id;
    subject.value = '';
    body.value = '';
    clearDraftPhoto();
    clearDraftVideo();
    retry = null;
    selectedId = null;
    active = 'compose';
    render();
    report(`Writing to ${pinned.name}. Only the two of you can read this.`);
    body.focus();
    return true;
  }

  /** Back to a plain new message, addressed to nobody in particular. */
  function resetCompose() {
    pinned = null;
    backTo = null;
    renderMembers();
    report('');
  }

  function render() {
    if (!user) return;
    byId('mail-inbox-count').textContent = String(messenger ? conversationRows().length : inbox.length);
    byId('mail-sent-count').textContent = String(sent.length);
    if (active === 'detail') renderDetail();
    if (active !== 'detail') { clearDetailPhoto(); clearDetailVideo(); }
    if (active !== 'compose') { stopPhotoPreparation(); stopVideoPreparation(); }
    renderDraftPhoto();
    renderDraftVideo();
    byId('mail-list-view').hidden = active === 'detail' || active === 'compose';
    byId('mail-detail').hidden = active !== 'detail';
    byId('mail-compose').hidden = active !== 'compose';
    byId('mail-compose-heading').textContent = pinned ? `Message ${pinned.name}` : 'New Message';
    const back = byId('mail-conversation-back');
    if (back) {
      back.hidden = active !== 'compose' || backTo !== 'chat';
      back.textContent = '\u00ab Back to the chat room';
    }
    tabs.forEach(tab => {
      const selected = tab.dataset.mailGo === (active === 'detail' ? folder : active);
      if (selected) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    if (active === 'inbox' || active === 'sent') renderRows();
    controls();
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        headers: {Accept:'application/json',...options.headers},
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error('Member message request failed');
        error.status = response.status;
        throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid message response');
      return data;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  async function markRead(message) {
    if (!user || retiredIds.has(message.id) || !unreadIds.has(message.id) || markingRead.has(message.id)) return;
    const epoch = generation;
    markingRead.add(message.id);
    try {
      const data = await request('/api/member-messages/read', {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({message_id:message.id}),
      });
      if (!isCurrent(epoch) || retiredIds.has(message.id) || data.message_id !== message.id || data.read !== true ||
          !Number.isSafeInteger(data.unread_count) || data.unread_count < 0) return;
      unreadIds.delete(message.id);
      unreadCount = data.unread_count;
      publishUnread();
      if (active === 'inbox' || active === 'sent') render();
    } catch (error) {
      if (!isCurrent(epoch) || retiredIds.has(message.id)) return;
      if (error.status === 401 || error.status === 403) return handleError(error, epoch, 'read');
      report('Message opened, but its new badge could not update. It will try again when your inbox refreshes.', 'error');
    } finally {
      if (isCurrent(epoch)) markingRead.delete(message.id);
    }
  }

  function handleError(error, epoch, action) {
    if (!isCurrent(epoch)) return;
    if (error.status === 401 || error.status === 403) {
      clear();
      onSessionExpired(error.status === 403 ? 'confirmation' : 'session');
      return;
    }
    if (error.status === 429) return report('A few too many requests. Give it a minute, then try again.', 'error');
    if (action === 'send') {
      if (error.status === 404) return report('That name is not available for messages. Refresh the roster and choose somebody else.', 'error');
      if (error.status === 400 || error.status === 413 || error.status === 415) return report('Check your message and attachment. Choose one picture or a phone video up to 100 MB and 30 seconds.', 'error');
      if (error.status === 409) return report('That send request could not be reused. Check Sent before starting a new message.', 'error');
      return report("We couldn't confirm that message went through. Try Send Message again to check without sending it twice.", 'error');
    }
    report("Your inbox couldn't connect just now. Tap Refresh to try again.", 'error');
  }

  async function refresh({manual = false} = {}) {
    if (!user || document.visibilityState === 'hidden') return;
    if (loading) {
      if (manual) refreshAgain = true;
      return;
    }
    const epoch = generation;
    const before = revision;
    loading = true;
    if (manual || !loaded) report('Checking your inbox…');
    controls();
    try {
      const data = await request('/api/member-messages');
      if (!isCurrent(epoch)) return;
      if (!data.user || data.user.id !== user.id) {
        const error = new Error('The member session changed');
        error.status = 401;
        throw error;
      }
      if (!Array.isArray(data.inbox) || !Array.isArray(data.sent) || !Array.isArray(data.members)) throw new Error('Invalid inbox response');
      if (before !== revision) {
        refreshAgain = true;
        return;
      }
      const firstLoad = !loaded;
      retireMessages(data);
      const received = data.inbox.filter(message => messageValid(message) && message.recipient_id === user.id && !retiredIds.has(message.id));
      inbox = mergeMessages(inbox, received);
      sent = mergeMessages(sent, data.sent.filter(message => messageValid(message) && message.sender_id === user.id));
      mergeUnread(data, received, firstLoad);
      const uniqueMembers = new Map(members.filter(member => pagedMemberIds.has(member.id)).map(member => [member.id, member]));
      for (const member of data.members) {
        if (member && typeof member.id === 'string' && typeof member.name === 'string' && member.id !== user.id) uniqueMembers.set(member.id, {id:member.id,name:member.name});
      }
      members = [...uniqueMembers.values()];
      if (firstLoad) next = normalizeNext(data.next);
      loaded = true;
      renderMembers();
      render();
      if (firstLoad && requestedRecipient) {
        const asked = requestedRecipient;
        const name = requestedName;
        requestedRecipient = null;
        requestedName = '';
        if (openConversation({id: asked, name})) {
          // The address bar goes back to plain messages, so a reload or a later
          // tap on Messages lands on the inbox rather than reopening this.
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('to');
            url.searchParams.delete('name');
            window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
          } catch { /* an address bar that cannot be tidied changes nothing */ }
        }
      }
      if (!sending && (manual || status.textContent === 'Checking your inbox…' || status.dataset.tone === 'error')) report(manual ? 'Your inbox is up to date.' : '');
    } catch (error) {
      handleError(error, epoch, 'read');
    } finally {
      if (isCurrent(epoch)) {
        loading = false;
        controls();
        if (refreshAgain) {
          refreshAgain = false;
          void refresh();
        }
      }
    }
  }

  function mergeMessages(existing, additional) {
    return sortMessages([...new Map([...existing,...additional].filter(message => !retiredIds.has(message.id)).map(message => [message.id,message])).values()]);
  }

  function normalizeNext(value) {
    return Object.fromEntries(['inbox_before','sent_before','members_after'].map(key => [key, typeof value?.[key] === 'string' && value[key] ? value[key] : null]));
  }

  async function loadMore(kind) {
    const key = kind === 'members' ? 'members_after' : kind === 'sent' ? 'sent_before' : 'inbox_before';
    if (!user || loading || sending || !next[key]) return;
    const epoch = generation;
    const before = revision;
    loading = true;
    controls();
    report(kind === 'members' ? 'Loading more of the roster…' : 'Loading older messages…');
    try {
      const query = new URLSearchParams({[key]:next[key]});
      const data = await request(`/api/member-messages?${query}`);
      if (!isCurrent(epoch)) return;
      if (data.user?.id !== user.id) {
        const error = new Error('The member session changed'); error.status = 401; throw error;
      }
      if (!Array.isArray(data[kind])) throw new Error('Invalid message page');
      if (before !== revision) { refreshAgain = true; return; }
      retireMessages(data);
      if (kind === 'members') {
        const all = new Map(members.map(member => [member.id,member]));
        for (const member of data.members) if (member && typeof member.id === 'string' && typeof member.name === 'string' && member.id !== user.id) {
          all.set(member.id,{id:member.id,name:member.name});
          pagedMemberIds.add(member.id);
        }
        members = [...all.values()];
        renderMembers();
      } else {
        const added = data[kind].filter(message => messageValid(message) && !retiredIds.has(message.id) && (kind === 'sent' ? message.sender_id : message.recipient_id) === user.id);
        if (kind === 'sent') sent = mergeMessages(sent, added);
        else inbox = mergeMessages(inbox, added);
      }
      const received = Array.isArray(data.inbox) ? data.inbox.filter(message => messageValid(message) && message.recipient_id === user.id && !retiredIds.has(message.id)) : [];
      mergeUnread(data, received);
      next[key] = normalizeNext(data.next)[key];
      render();
      report('');
    } catch (error) {
      handleError(error, epoch, 'read');
    } finally {
      if (isCurrent(epoch)) {
        loading = false;
        controls();
        if (refreshAgain) { refreshAgain = false; void refresh(); }
      }
    }
  }

  function clear() {
    generation += 1;
    user = null;
    messenger?.clear();
    messenger?.close();
    clearInterval(poll);
    poll = null;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    inbox = [];
    sent = [];
    unreadCount = 0;
    unreadIds = new Set();
    retiredIds = new Set();
    markingRead = new Set();
    members = [];
    pagedMemberIds = new Set();
    pinned = null;
    backTo = null;
    retry = null;
    clearDraftPhoto();
    clearDetailPhoto();
    clearDraftVideo();
    clearDetailVideo();
    next = {inbox_before:null,sent_before:null,members_after:null};
    selectedId = null;
    active = 'inbox';
    folder = 'inbox';
    loaded = false;
    loading = false;
    sending = false;
    refreshAgain = false;
    revision = 0;
    form.reset();
    list.replaceChildren();
    renderMembers();
    ['mail-message-subject','mail-message-from','mail-message-to','mail-message-date','mail-message-body'].forEach(id => { byId(id).textContent = ''; });
    byId('mail-message-date').removeAttribute('datetime');
    byId('mail-inbox-count').textContent = '0';
    byId('mail-sent-count').textContent = '0';
    publishUnread();
    report('');
    panel.hidden = true;
    controls();
  }

  function setUser(member) {
    if (member?.id && member.id === user?.id) return;
    clear();
    if (!member?.id) return;
    user = {id:member.id,name:member.name || 'Member'};
    panel.hidden = false;
    render();
    void refresh();
    poll = setInterval(() => {
      if (document.visibilityState !== 'hidden' && !sending && !byId('profile-conversation')?.open) void refresh();
    }, 20000);
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (!user || sending) return;
      active = tab.dataset.mailGo;
      if (active !== 'compose') folder = active;
      else resetCompose();
      selectedId = null;
      render();
      (active === 'compose' ? byId('mail-compose-heading') : byId('mail-list-heading')).focus();
    });
  }
  byId('mail-refresh').addEventListener('click', () => void refresh({manual:true}));
  byId('mail-load-more').addEventListener('click', () => {
    if (!messenger) return void loadMore(folder);
    void (async () => { if (next.inbox_before) await loadMore('inbox'); if (next.sent_before) await loadMore('sent'); })();
  });
  byId('mail-open-chat')?.addEventListener('click', () => {
    const person = members.find(member => member.id === recipient.value) || pinned;
    if (person) openTextConversation(person,byId('mail-open-chat'));
  });
  recipient.addEventListener('change',controls);
  byId('profile-conversation')?.addEventListener('close', () => { if (user) void refresh(); });
  byId('mail-more-members').addEventListener('click', () => void loadMore('members'));
  byId('mail-back').addEventListener('click', () => {
    active = folder;
    selectedId = null;
    render();
    byId('mail-list-heading').focus();
  });
  byId('mail-reply').addEventListener('click', () => {
    const message = selectedMessage();
    if (!message || !user || sending) return;
    // Replying pins the sender, so a reply is never refused because their
    // name sits on a page of the roster this inbox has not loaded.
    pinned = {id: message.sender_id, name: cleanName(message.sender_name) || 'This member'};
    backTo = null;
    renderMembers();
    recipient.value = message.sender_id;
    subject.value = (/^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`).slice(0, 100);
    body.value = '';
    clearDraftPhoto();
    clearDraftVideo();
    retry = null;
    active = 'compose';
    report('');
    render();
    body.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!user || sending || preparingPhoto || preparingVideo || !loaded || !(members.length || pinned) || !form.reportValidity()) return;
    const data = {recipient_id:recipient.value,subject:subject.value.trim() || (draftPhoto ? 'Photo' : draftVideo ? 'Video' : 'New message'),body:body.value.trim()};
    if (!knows(data.recipient_id) || (!draftPhoto && !draftVideo && !data.body)) {
      report('Choose somebody on the roster, then add a message or picture or video.', 'error');
      return;
    }
    const snapshot = JSON.stringify({...data,photo_id:draftPhotoId,video_id:draftVideoId});
    if (!retry || retry.snapshot !== snapshot) retry = {snapshot,requestId:crypto.randomUUID()};
    const payload = {...data,request_id:retry.requestId};
    const photoToSend = draftPhoto;
    const videoToSend = draftVideo;
    let options;
    if (photoToSend || videoToSend) {
      const multipart = new FormData();
      for (const [key, value] of Object.entries(payload)) multipart.append(key, value);
      if (photoToSend) multipart.append('photo', photoToSend, photoToSend.name);
      else multipart.append('video', videoToSend, videoToSend.name);
      options = {method:'POST',body:multipart};
    } else options = {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)};
    const epoch = generation;
    sending = true;
    controls();
    report('Sending your message…');
    void (async () => {
      try {
        const response = await request('/api/member-messages/send', options);
        if (!isCurrent(epoch)) return;
        if (!messageValid(response.message) || response.message.sender_id !== user.id || response.message.recipient_id !== data.recipient_id) throw new Error('Invalid send confirmation');
        revision += 1;
        sent = sortMessages([response.message,...sent.filter(message => message.id !== response.message.id)]);
        retry = null;
        clearDraftPhoto();
        clearDraftVideo();
        form.reset();
        active = 'sent';
        folder = 'sent';
        report('Message sent.', 'success');
        render();
        byId('mail-list-heading').focus();
        void refresh();
      } catch (error) {
        handleError(error, epoch, 'send');
      } finally {
        if (isCurrent(epoch)) {
          sending = false;
          controls();
        }
      }
    })();
  });
  byId('mail-add-photo').addEventListener('click', () => {
    if (user && !sending && active === 'compose') byId('mail-photo-input').click();
  });
  byId('mail-photo-input').addEventListener('change', () => void choosePhoto());
  byId('mail-add-video').addEventListener('click', () => {
    if (user && !sending && !recording && active === 'compose') byId('mail-video-input').click();
  });
  byId('mail-video-input').addEventListener('change', () => void chooseVideo());
  byId('mail-record-video').addEventListener('click', () => void chooseVideo(true));
  byId('mail-stop-recording').addEventListener('click', () => {
    if (!recording) return;
    recording.stop();
    byId('mail-stop-recording').disabled = true;
    photoReport('Getting your video ready…');
  });
  byId('mail-cancel-recording').addEventListener('click', () => {
    stopVideoPreparation();
    photoReport('Recording canceled.');
    controls();
  });
  byId('mail-remove-video').addEventListener('click', () => {
    if (sending) return;
    clearDraftVideo();
    retry = null;
    photoReport('Video removed.');
    controls();
  });
  byId('mail-remove-photo').addEventListener('click', () => {
    if (sending) return;
    clearDraftPhoto();
    retry = null;
    photoReport('Picture removed.');
    controls();
  });
  byId('mail-photo-retry').addEventListener('click', () => {
    if (!user || active !== 'detail') return;
    clearDetailPhoto();
    const message = selectedMessage();
    if (message) void renderDetailPhoto(message);
  });
  byId('mail-message-photo').addEventListener('error', () => {
    if (!detailPhotoURL) return;
    const key = detailPhotoKey;
    clearDetailPhoto();
    detailPhotoKey = key;
    byId('mail-message-photo-wrap').hidden = false;
    byId('mail-message-photo-status').textContent = 'This picture could not open. Tap Try photo again.';
    byId('mail-photo-retry').hidden = false;
  });
  byId('mail-video-retry').addEventListener('click', () => {
    if (!user || active !== 'detail') return;
    clearDetailVideo();
    const message = selectedMessage();
    if (message) void renderDetailVideo(message);
  });
  byId('mail-message-video').addEventListener('error', () => {
    if (!detailVideoURL) return;
    const key = detailVideoKey;
    clearDetailVideo();
    detailVideoKey = key;
    byId('mail-message-video-wrap').hidden = false;
    byId('mail-message-video-status').textContent = 'This video could not play. Try a different browser or tap Try video again.';
    byId('mail-video-retry').hidden = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      clearDetailPhoto(); clearDetailVideo();
      clearDraftPreview(); clearVideoPreview();
      stopPhotoPreparation(); stopVideoPreparation();
    }
    else if (user) {
      render();
      if (!sending) void refresh();
    }
  });
  window.addEventListener('pagehide', clear);
  return {setUser, openConversation, backTo: () => backTo};
}
