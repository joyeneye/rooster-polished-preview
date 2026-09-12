import {AUTH_EVENTS,getUser,login,logout,onAuthChange,requestPasswordRecovery} from '@netlify/identity';
import {createMemberProfileEditor} from './member-profile.js?v=20260910-working-camera-v4';

const byId = (id) => document.getElementById(id);
const authKeys = ['confirmation_token','recovery_token','invite_token','email_change_token','access_token'];
const hash = new URLSearchParams(window.location.hash.slice(1));
if (authKeys.some(key => hash.has(key))) {
  window.location.replace(`/members.html${window.location.hash}`);
} else {
  startOwnerEditor();
}

function startOwnerEditor() {
  const status = byId('owner-status');
  const loginPanel = byId('owner-login-panel');
  const editArea = byId('owner-edit-area');
  let user = null;
  let ownerConfirmed = false;
  let busy = true;
  let sessionClosed = false;
  let generation = 0;
  let accessRequest = null;
  const editor = createMemberProfileEditor({
    onEditOpened() {
      const about = byId('member-profile-about');
      // An owner with no custom bio starts from the existing homepage copy.
      // A saved custom bio is already loaded by the shared profile editor.
      if (about && !about.value.trim()) about.value = about.defaultValue;
    },
    onSessionExpired() {
      sessionClosed = true;
      generation += 1;
      accessRequest?.abort();
      ownerConfirmed = false;
      editor.setUser(null);
      render();
      report('Your editor session could not be confirmed. Log in again with your owner account.', 'error');
    },
  });

  function report(text, tone = '') {status.textContent = text;status.dataset.tone = tone;}
  function render() {
    loginPanel.hidden = ownerConfirmed;
    byId('owner-activation-note').textContent = busy ? 'Checking your existing owner login…' : 'Use your website email and password to open your profile editor.';
    editArea.hidden = !ownerConfirmed;
    byId('owner-logout').hidden = !user && !sessionClosed;
    for (const id of ['owner-email','owner-password','owner-login-button','owner-forgot-button','owner-recovery-email','owner-recovery-button','owner-logout']) byId(id).disabled = busy;
    byId('owner-content').setAttribute('aria-busy', String(busy));
  }
  async function checkOwner(candidate) {
    const epoch = ++generation;
    accessRequest?.abort();
    user = candidate;
    ownerConfirmed = false;
    editor.setUser(null);
    render();
    if (!candidate) {report('Log in to edit your About Me, status and picture.');return;}
    if (!candidate.confirmedAt || !Number.isFinite(Date.parse(candidate.confirmedAt))) {
      report('Your owner account could not be confirmed. Please try logging in again.', 'error');return;
    }
    const controller = new AbortController();accessRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/profile/me',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if (!user || generation !== epoch || sessionClosed) return;
      if (!response.ok) {
        report(response.status === 401 || response.status === 403 ? 'Owner access could not be confirmed. Log in with your owner account.' : 'Owner access could not be checked just now. Please try logging in again.', 'error');return;
      }
      const data = await response.json();
      if (!user || generation !== epoch || sessionClosed) return;
      if (data.can_edit_owner !== true || data.profile?.id !== candidate.id) {
        report("This account cannot edit J.White's main profile. Log out, then sign in with your owner account.", 'error');return;
      }
      ownerConfirmed = true;
      render();
      report('Owner access confirmed. Your About Me, status and picture are ready to edit.', 'success');
      editor.setUser(candidate);
      editor.requestEdit();
    } catch {
      if (generation === epoch && !sessionClosed) report('Owner access could not be checked just now. Please try logging in again.', 'error');
    } finally {clearTimeout(timeout);if (accessRequest === controller) accessRequest = null;}
  }

  byId('owner-login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || !event.currentTarget.reportValidity()) return;
    const email = byId('owner-email').value.trim();
    const password = byId('owner-password').value;
    const epoch = generation;
    busy = true;render();report('Checking your login…');
    void (async () => {
      try {
        const member = await login(email,password);
        if (generation !== epoch) return;
        sessionClosed = false;
        await checkOwner(member);
      } catch (error) {
        const code = Number(error?.status);
        report([400,401,422].includes(code) ? 'That login did not work. Check your website email and password, then try again.' : 'The login service could not be reached. Please try again in a moment.', 'error');
      } finally {byId('owner-password').value = '';busy = false;render();}
    })();
  });
  byId('owner-forgot-button').addEventListener('click', () => {
    if (busy) return;
    byId('owner-recovery-form').hidden = false;
    byId('owner-recovery-email').value = byId('owner-email').value;
    byId('owner-recovery-email').focus();
  });
  byId('owner-recovery-form').addEventListener('submit', (event) => {
    event.preventDefault();if (busy || !event.currentTarget.reportValidity()) return;
    const email = byId('owner-recovery-email').value.trim();busy = true;render();report('Requesting your password reset…');
    void requestPasswordRecovery(email).then(() => {
      report('If that email has an active account, a reset link is on the way. Open the email link, finish resetting your password, then return here.', 'success');
    }).catch(() => report('The reset link could not be requested just now. Please try again in a moment.', 'error')).finally(() => {busy = false;render();});
  });
  byId('owner-logout').addEventListener('click', () => {
    if (busy) return;
    busy = true;sessionClosed = true;generation += 1;accessRequest?.abort();user = null;ownerConfirmed = false;editor.setUser(null);render();report('Logging you out…');
    void logout().then(() => report('You are logged out.')).catch(() => report('The editor is closed, but logout could not finish. Try Log Out again.', 'error')).finally(() => {busy = false;render();});
  });
  onAuthChange((event, member) => {
    if (event === AUTH_EVENTS.LOGOUT || !member) {generation += 1;sessionClosed = true;accessRequest?.abort();user = null;ownerConfirmed = false;editor.setUser(null);render();report('Log in to edit your profile.');return;}
    if (busy || sessionClosed) return;
    if (ownerConfirmed && member.id === user?.id) return;
    busy = true;render();void checkOwner(member).finally(() => {busy = false;render();});
  });
  window.addEventListener('pagehide', () => {generation += 1;accessRequest?.abort();editor.setUser(null);ownerConfirmed = false;render();});
  window.addEventListener('pageshow', (event) => {if (event.persisted && !sessionClosed) void initialize();});
  async function initialize() {
    const epoch = generation;
    busy = true;render();
    try {const member = await getUser();if (generation !== epoch || sessionClosed) return;await checkOwner(member);}
    catch {report('Your session could not be checked. Please log in with your owner account.', 'error');}
    finally {busy = false;render();}
  }
  void initialize();
}
