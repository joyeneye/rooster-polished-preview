import {AUTH_EVENTS, getUser, onAuthChange} from '@netlify/identity';

const editLink = document.querySelector('.profile-edit-link');
let generation = 0;
let request = null;

function hideEditorLink() {
  generation += 1;
  request?.abort();
  request = null;
  if (editLink) editLink.hidden = true;
}

async function refreshOwnerAccess() {
  hideEditorLink();
  if (!editLink || document.hidden) return;
  const epoch = generation;
  let timeout;
  try {
    const user = await getUser();
    if (epoch !== generation || !user?.confirmedAt || !Number.isFinite(Date.parse(user.confirmedAt))) return;
    const controller = new AbortController();
    request = controller;
    timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('/api/profile/me', {
      credentials:'same-origin', cache:'no-store', signal:controller.signal,
      headers:{Accept:'application/json'},
    });
    if (!response.ok || epoch !== generation) return;
    const data = await response.json();
    if (epoch !== generation || document.hidden) return;
    editLink.hidden = !(data.can_edit_owner === true && data.profile?.id === user.id);
  } catch {
    // Visitors and unconfirmed sessions keep the public page without editing.
  } finally {
    clearTimeout(timeout);
    if (epoch === generation) request = null;
  }
}

onAuthChange((event, user) => {
  if (event === AUTH_EVENTS.LOGOUT || !user) hideEditorLink();
  else void refreshOwnerAccess();
});
window.addEventListener('pagehide', hideEditorLink);
window.addEventListener('pageshow', () => void refreshOwnerAccess());
window.addEventListener('focus', () => void refreshOwnerAccess());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hideEditorLink();
  else void refreshOwnerAccess();
});
void refreshOwnerAccess();
