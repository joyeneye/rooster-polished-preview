import {
  AUTH_EVENTS,
  acceptInvite,
  getSettings,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  requestPasswordRecovery,
  signup,
  updateUser,
} from '@netlify/identity';
import {createMemberInbox} from './member-inbox.js';
import {createMemberProfileEditor} from './member-profile.js?v=20260910-working-camera-v4';
import {createMemberVerification} from './member-verification.js';
import {createMemberChat} from './member-chat.js';
import {createMemberAlbum} from './member-album.js';
import {createMemberMedia} from './member-media.js';
import {createMemberClips} from './member-clips.js';
import {createMemberSongs} from './member-songs.js?v=20260906-music-player-v1';
import {createMemberDiscovery} from './member-discovery.js';
import {createMemberAnnouncements} from './member-announcements.js';
import {createFounderAnnouncements} from './founder-announcements.js';
import {musicGuideElement, renderMusicGuide} from './music-guide.js';
import {createRosterAccess} from './roster-access-client.js';

const byId = (id) => document.getElementById(id);
const views = [...document.querySelectorAll('[data-member-view]')];
const navigation = [...document.querySelectorAll('[data-member-go]')];
const fields = [...document.querySelectorAll('.member-card fieldset')];
const status = byId('member-status');
const heading = byId('member-heading');
const signupOptions = [...document.querySelectorAll('[data-signup-option]')];
const account = byId('member-account');
const accountLauncher = byId('member-account-launcher');
const accountActions = [...document.querySelectorAll('[data-account-go]')];
const accountPanels = [...document.querySelectorAll('[data-account-panel]')];
const accountBackActions = [...document.querySelectorAll('[data-account-back]')];
const registrationNote = byId('member-registration-note');
const retryButton = byId('member-retry');
const titles = {login: 'Log In to the Roster', signup: 'Get on the Roster', invite: 'Enter Your Invite Code', request: 'Request an Invite', forgot: 'Forgot Your Password?', reset: 'Set Your Password', account: 'Your Account'};
const authKeys = ['confirmation_token', 'recovery_token', 'invite_token', 'email_change_token', 'access_token'];
const startingHash = window.location.hash;
// Only this fixed in-app destination is accepted; never redirect to an arbitrary URL.
const monaReturnValues = new URLSearchParams(window.location.search).getAll('next');
const returnToMona = monaReturnValues.length === 1 && monaReturnValues[0] === '/mona';
let editProfileIntent = startingHash === '#edit-profile';
// ROOSTER is invite only, so these two links are front doors of their own.
const startingDoor = startingHash === '#invite-code' ? 'invite' : startingHash === '#request-invite' ? 'request' : null;
let memberDestinationIntent = ['#member-profile-panel', '#member-mail', '#member-chat', '#member-clips-root', '#member-songs-root', '#friend-requests', '#member-photo-album', '#member-media-manage', '#member-discovery', '#owner-discovery', '#founder-announcements'].includes(startingHash) ? startingHash : null;
let settings = null;
let currentUser = null;
let loadedProfileState = null;
let wallReturning = false;
let activeView = 'login';
let ready = false;
let busy = false;
let resetRequired = false;
let inviteToken = null;
let sessionClosed = false;
const album = createMemberAlbum();
const mediaManager = createMemberMedia();
const inbox = createMemberInbox({
  onSessionExpired(reason) {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report(reason === 'confirmation'
      ? 'Your account could not open messages. Confirm your email, then log in again.'
      : 'Your session ended. Log in again to open your inbox.', 'error');
    void logout().catch(() => {});
  },
});
const profileEditor = createMemberProfileEditor({
  onEditOpened() {
    editProfileIntent = false;
    byId('member-edit-login-note').hidden = true;
    if (window.location.hash === '#edit-profile') window.history.replaceState(null, '', window.location.pathname + window.location.search);
  },
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again with a confirmed email to update your profile.', 'error');
    void logout().catch(() => {});
  },
  onProfileState(state) {
    loadedProfileState = state;
    renderStartHere();
  },
});
const verification = createMemberVerification({
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again to open your account.', 'error');
    void logout().catch(() => {});
  },
});
const chat = createMemberChat({
  onSessionExpired(reason) {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report(reason === 'confirmation'
      ? 'Confirm your email, then log in to join the room.'
      : 'Your session ended. Log in again to join the room.', 'error');
    void logout().catch(() => {});
  },
});
for (const link of document.querySelectorAll('[data-open-chat]')) {
  link.addEventListener('click', (event) => {
    if (currentUser?.confirmedAt) {
      byId('chat-room').open = true;
      return;
    }
    memberDestinationIntent = '#member-chat';
    event.preventDefault();
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#member-chat`);
    show('login');
    byId('member-heading').scrollIntoView?.({block:'start'});
  });
}
for (const link of document.querySelectorAll('[data-edit-my-profile]')) {
  link.addEventListener('click', () => {
    if (currentUser?.confirmedAt && activeView === 'account') profileEditor.requestEdit();
  });
}
const memberClips = createMemberClips({
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again to make a clip.', 'error');
    void logout().catch(() => {});
  },
});
const memberSongs = createMemberSongs({
  onEditProfile() { profileEditor.requestEdit(); },
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again to manage your profile music.', 'error');
    void logout().catch(() => {});
  },
});
// The same steps the front door shows, sitting inside the music section itself.
const songsRoot = byId('member-songs-root');
if (songsRoot) songsRoot.insertBefore(musicGuideElement(), songsRoot.querySelector('.song-status'));
renderMusicGuide(byId('put-your-music-on-your-page'), {open: true, summary: 'How to put your music on your page'});
const discovery = createMemberDiscovery({
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again to use Discovery.', 'error');
    void logout().catch(() => {});
  },
});

const announcements = createMemberAnnouncements({
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again to read your message from J.White.', 'error');
    void logout().catch(() => {});
  },
});
const founderAnnouncements = createFounderAnnouncements({
  onSessionExpired() {
    sessionClosed = true;
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login');
    report('Log in again to use the announcement tools.', 'error');
    void logout().catch(() => {});
  },
});

/* ROOSTER is invite only. The server refuses every community request until this
 * account has redeemed an invitation or been approved, so this module's job is
 * to say so plainly and give the person the two things they can actually do:
 * enter a code, or ask for one. Nothing here grants access. */
const access = createRosterAccess({
  onChange() {
    // Re-render once the answer arrives so the account tools appear the moment
    // approval lands, and stay closed until then.
    if (ready && !accessRendering) {
      accessRendering = true;
      try { show(activeView, {clearStatus: false}); } finally { accessRendering = false; }
    }
  },
});
let accessRendering = false;

/* A code typed before the account existed is held for this tab only and spent
 * on the first sign-in. Saying so on the signup form keeps it from feeling
 * like the code was thrown away. */
function paintHeldInvite() {
  const note = byId('signup-invite-held');
  if (!note) return;
  const code = access.heldCode();
  note.hidden = !code;
  note.textContent = code
    ? `Invite code ${code} is saved for this tab. It is applied to your account as soon as you confirm your email.`
    : '';
}
document.addEventListener('roster:invite-code-held', () => {
  paintHeldInvite();
  show('signup');
});

/* Message beside somebody opens a private conversation with that exact
   person, right here in the account. Nothing navigates away, so the chat room
   is still behind it and a ROOSTER LIVE room stays connected. */
document.addEventListener('roster:open-conversation', (event) => {
  const detail = event.detail || {};
  if (!communityOpen()) {
    // Not logged in or not approved yet: let the link go to the log in
    // screen, which then comes back to the messages panel.
    memberDestinationIntent = '#member-mail';
    return;
  }
  event.preventDefault();
  setAccountTool('mail', {scroll: true, updateHash: true});
  if (!inbox.openConversation(detail)) setAccountTool('mail', {scroll: true, updateHash: true});
});

/* The way back out of a conversation and into the room it started in. */
byId('mail-conversation-back')?.addEventListener('click', () => {
  if (!communityOpen()) return;
  setAccountTool('chat', {scroll: true, updateHash: true});
});

/** True once the server has confirmed this account is invited and approved. */
function communityOpen() {
  return Boolean(currentUser?.confirmedAt) && access.isApproved();
}

const accountTargets = Object.freeze({
  home: 'member-account-launcher',
  profile: 'member-profile-panel',
  songs: 'member-songs-root',
  photos: 'member-photo-album',
  media: 'member-media-manage',
  clips: 'member-clips-root',
  mail: 'member-mail',
  chat: 'member-chat',
  friends: 'friend-requests',
  discovery: 'member-discovery',
  founder: 'founder-announcements',
});
const accountHashes = Object.freeze({
  profile: '#member-profile-panel',
  songs: '#member-songs-root',
  photos: '#member-photo-album',
  media: '#member-media-manage',
  clips: '#member-clips-root',
  mail: '#member-mail',
  chat: '#member-chat',
  friends: '#friend-requests',
  discovery: '#member-discovery',
  founder: '#founder-announcements',
});

function accountToolFromHash(hash) {
  if (hash === '#owner-discovery') return 'discovery';
  if (hash === '#edit-profile') return 'profile';
  return Object.keys(accountHashes).find((tool) => accountHashes[tool] === hash) || null;
}

function accountPanel(tool) {
  const matches = accountPanels.filter((panel) => panel.dataset.accountPanel === tool);
  return matches.find((panel) => !panel.hidden) || matches[0] || byId(accountTargets[tool]);
}

function setAccountTool(requestedTool, {scroll = true, updateHash = false} = {}) {
  const tool = Object.hasOwn(accountTargets, requestedTool) ? requestedTool : 'home';
  account.dataset.accountTool = tool;
  for (const action of accountActions) {
    action.setAttribute('aria-current', action.dataset.accountGo === tool ? 'page' : 'false');
  }
  for (const panel of accountPanels) {
    panel.dataset.accountActive = String(panel.dataset.accountPanel === tool);
  }
  for (const back of accountBackActions) back.hidden = tool === 'home';
  if (tool === 'chat' && currentUser?.confirmedAt) byId('chat-room').open = true;
  if (updateHash) {
    const hash = tool === 'home' ? '' : accountHashes[tool] || '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  }
  if (!scroll) return;
  const target = accountPanel(tool);
  target?.scrollIntoView?.({block: 'start', behavior: 'smooth'});
  if (tool === 'home') accountLauncher?.focus?.({preventScroll: true});
}

function destinationLoginCopy(destination) {
  const messages = {
    '#member-profile-panel': 'Log in to set up your profile.',
    '#member-mail': 'Log in to open your private messages.',
    '#member-chat': 'Log in to join The Listening Room.',
    '#member-clips-root': 'Log in to make your Short Clip.',
    '#member-songs-root': 'Log in to choose the music for your profile.',
    '#friend-requests': 'Log in to see your roster requests.',
    '#member-photo-album': 'Log in to manage your photos.',
    '#member-media-manage': 'Log in to remove your photos and videos.',
    '#member-discovery': 'Log in to send J.White your best song.',
    '#owner-discovery': 'Log in to open Discovery.',
    '#founder-announcements': 'Log in to send a ROOSTER announcement.',
  };
  return messages[destination] || 'Log in to open your account.';
}

function renderStartHere() {
  const startHere = byId('member-start-here');
  if (!startHere) return;
  startHere.hidden = !(activeView === 'account' && currentUser?.confirmedAt && loadedProfileState?.firstLogin === true);
}

for (const action of accountActions) {
  if ('accountBack' in action.dataset) continue;
  action.addEventListener('click', (event) => {
    const tool = action.dataset.accountGo;
    if (!Object.hasOwn(accountTargets, tool)) return;
    event.preventDefault();
    const destination = tool === 'home' ? null : accountHashes[tool];
    if (!ready || busy) return;
    if (!currentUser?.confirmedAt || activeView !== 'account') {
      memberDestinationIntent = destination;
      if (destination) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${destination}`);
      show('login');
      byId('member-heading').scrollIntoView?.({block: 'start'});
      return;
    }
    memberDestinationIntent = null;
    setAccountTool(tool, {updateHash: true});
  });
}

for (const back of accountBackActions) {
  back.addEventListener('click', (event) => {
    event.preventDefault();
    if (activeView === 'account' && currentUser?.confirmedAt) setAccountTool('home', {updateHash: true});
  });
}

function report(message, tone = '') {
  status.textContent = message;
  status.dataset.tone = tone;
}

function registrationAllowed() {
  return settings?.disableSignup === false && settings?.autoconfirm === false;
}

function controls() {
  const disabled = !ready || busy;
  fields.forEach((fieldset) => { fieldset.disabled = disabled; });
  navigation.forEach((button) => { button.disabled = disabled; });
  byId('member-logout').disabled = disabled;
  byId('member-logout-retry').disabled = disabled;
  retryButton.disabled = busy;
  byId('members-content').setAttribute('aria-busy', String(busy));
  signupOptions.forEach((option) => { option.hidden = !registrationAllowed(); });
  registrationNote.hidden = !ready || registrationAllowed();
  registrationNote.textContent = settings?.disableSignup
    ? 'New spots on the roster are by invitation right now. Already on the roster? You can still log in.'
    : 'New spots on the roster open soon. Already on the roster? You can still log in.';
}

function show(view, {focus = false, clearStatus = true} = {}) {
  // Signing up is only offered behind the invite code screen now.
  if (view === 'signup' && !registrationAllowed()) view = 'invite';
  if (view === 'account' && !currentUser) view = 'login';
  if (view === 'reset' && !resetRequired && !inviteToken) view = 'login';
  activeView = view;
  byId('member-edit-login-note').hidden = !editProfileIntent || view !== 'login';
  byId('member-destination-note').hidden = !memberDestinationIntent || view !== 'login';
  byId('member-destination-note').textContent = destinationLoginCopy(memberDestinationIntent);
  for (const tab of document.querySelectorAll('[data-auth-tab]')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.authTab === view));
  }
  document.body.dataset.memberState = view;
  for (const element of views) element.hidden = element.dataset.memberView !== view;
  heading.textContent = titles[view];
  if (clearStatus) report('');
  if (currentUser) {
    const name = typeof currentUser.name === 'string' ? currentUser.name.trim() : '';
    byId('member-greeting').textContent = name ? `Welcome, ${name}.` : 'Welcome to ROOSTER';
    byId('member-account-email').textContent = currentUser.email || 'Email not available';
    byId('member-account-verified').textContent = currentUser.confirmedAt ? 'Email confirmed' : 'Email confirmation needed';
  } else {
    byId('member-greeting').textContent = 'Welcome to ROOSTER';
    byId('member-account-email').textContent = '';
    byId('member-account-verified').textContent = '';
  }
  byId('reset-intro').textContent = inviteToken
    ? 'You got an invite. Set your password and come on in.'
    : "Choose a new password and you're good to go.";
  byId('member-save-password').textContent = inviteToken ? 'Accept Invite' : 'Save Password';
  if (view === 'signup' || view === 'invite') paintHeldInvite();
  window.dispatchEvent(new CustomEvent('jwhite:session-changed'));
  // The gate asks the server about this account. Until it answers yes, the
  // account tools below stay shut.
  void access.setUser(currentUser?.confirmedAt ? currentUser : null);
  album.setUser(view === 'account' && communityOpen() ? currentUser : null);
  mediaManager.setUser(view === 'account' && communityOpen() ? currentUser : null);
  inbox.setUser(view === 'account' && communityOpen() ? currentUser : null);
  profileEditor.setUser(view === 'account' && communityOpen() ? currentUser : null);
  verification.setUser(view === 'account' && communityOpen() ? currentUser : null);
  chat.setUser(view === 'account' && communityOpen() ? currentUser : null);
  memberClips.setUser(view === 'account' && communityOpen() ? currentUser : null);
  memberSongs.setUser(view === 'account' && communityOpen() ? currentUser : null);
  discovery.setUser(view === 'account' && communityOpen() ? currentUser : null);
  announcements.setUser(view === 'account' && communityOpen() ? currentUser : null);
  founderAnnouncements.setUser(view === 'account' && communityOpen() ? currentUser : null);
  const accountReady = view === 'account' && communityOpen();
  if (!accountReady) {
    loadedProfileState = null;
    setAccountTool('home', {scroll: false});
  } else {
    const requestedTool = editProfileIntent ? 'profile' : accountToolFromHash(memberDestinationIntent) || account.dataset.accountTool || 'home';
    setAccountTool(requestedTool, {scroll: false});
  }
  renderStartHere();
  controls();
  if (accountReady && window.location.hash === '#member-chat') byId('chat-room').open = true;
  if (accountReady && memberDestinationIntent) {
    byId(memberDestinationIntent.slice(1)).scrollIntoView?.({block:'start'});
    memberDestinationIntent = null;
  }
  window.JWhiteFriendSession?.setUser(view === 'account' && communityOpen() ? currentUser : null);
  window.JWhiteCommunity?.setUser(view === 'account' && communityOpen() ? currentUser : null);
  if (accountReady) void returnToMemberWall();
  if (focus) heading.focus();
  if (accountReady && editProfileIntent) profileEditor.requestEdit();
}

function authError(error, action) {
  const code = Number(error?.status);
  const message = typeof error?.message === 'string' ? error.message : '';
  if (code === 429 || /rate.?limit|too many/i.test(message)) return 'A few too many tries. Give it a minute, then try again.';
  if (action === 'login' && /confirm|verif/i.test(message)) return 'Confirm your email first. Check your inbox for the link we sent when you joined.';
  if (action === 'login' && [400, 401, 422].includes(code)) return 'That email and password did not work. Try again or use Forgot your password.';
  if (action === 'signup' && code === 403) return 'New accounts are not open right now. Please check back soon.';
  if (action === 'signup' && [400, 409, 422].includes(code)) return "We couldn't create that account. Check your details. If you've joined before, log in or reset your password.";
  if (action === 'callback') return 'That email link could not be opened. It may have expired or already been used. Try logging in, or request a new password reset link.';
  if (action === 'reset' && [401, 403].includes(code)) return 'That reset link has expired. Request a new one from Forgot your password.';
  if (action === 'reset' && code === 422) return 'That password was not accepted. Try a longer password with a mix of words, numbers and symbols.';
  return "We couldn't connect to your account just now. Please try again in a moment.";
}

function clearAuthHash() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (authKeys.some((key) => params.has(key))) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

function clearPasswords(form) {
  form.querySelectorAll('[data-password-input]').forEach((input) => {
    input.value = '';
    input.type = 'password';
  });
  form.querySelectorAll('[data-toggle-password]').forEach((toggle) => {
    toggle.setAttribute('aria-pressed', 'false');
    toggle.textContent = 'Show password';
  });
}

for (const toggle of document.querySelectorAll('[data-toggle-password]')) {
  const input = byId(toggle.dataset.togglePassword);
  toggle.addEventListener('click', () => {
    const showPassword = input.type === 'password';
    input.type = showPassword ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(showPassword));
    toggle.textContent = showPassword ? 'Hide password' : 'Show password';
    input.focus();
  });
}

function passwordsMatch(form, passwordId, confirmId) {
  const password = byId(passwordId);
  const confirm = byId(confirmId);
  confirm.setCustomValidity(password.value === confirm.value ? '' : 'Those passwords do not match.');
  if (!form.reportValidity()) return false;
  return true;
}

for (const [passwordId, confirmId] of [['signup-password', 'signup-confirm'], ['reset-password', 'reset-confirm']]) {
  for (const id of [passwordId, confirmId]) byId(id).addEventListener('input', () => byId(confirmId).setCustomValidity(''));
}

/** The front door renders its own buttons after this file has already bound the
 * static ones, so it switches views through here instead of the DOM. */
window.RosterFrontDoor = {
  registrationOpen: () => registrationAllowed(),
  signedIn: () => Boolean(currentUser),
  openSignup() {
    if (!ready || busy) return false;
    show(registrationAllowed() ? 'signup' : 'login', {focus: true});
    byId('member-heading').scrollIntoView({block: 'center', behavior: 'smooth'});
    return true;
  },
  openLogin() {
    if (!ready || busy) return false;
    show('login', {focus: true});
    byId('member-heading').scrollIntoView({block: 'center', behavior: 'smooth'});
    return true;
  },
  openMusic() {
    if (!ready || busy) return false;
    if (!currentUser) { memberDestinationIntent = '#member-songs-root'; show('login', {focus: true}); return true; }
    show('account');
    setAccountTool('songs', {updateHash: true});
    return true;
  },
};

for (const button of navigation) {
  button.addEventListener('click', () => {
    if (!ready || busy) return;
    for (const form of document.querySelectorAll('.member-card form')) clearPasswords(form);
    if (button.dataset.memberGo === 'forgot') byId('forgot-email').value = byId('login-email').value;
    show(button.dataset.memberGo, {focus: true});
    if (button.closest('.portal-join-panel')) byId('member-heading').scrollIntoView({block:'center',behavior:'smooth'});
  });
}

async function submitAction(form, action, operation) {
  if (!ready || busy || !form.reportValidity()) return;
  busy = true;
  controls();
  report(action === 'login' ? 'Logging you in…' : action === 'signup' ? 'Making your account…' : action === 'forgot' ? 'Sending your reset link…' : 'Saving your password…');
  try {
    await operation();
  } catch (error) {
    report(authError(error, action), 'error');
    if (action === 'reset' && [401, 403].includes(Number(error?.status))) {
      resetRequired = false;
      inviteToken = null;
      show('forgot', {focus: true, clearStatus: false});
    }
  } finally {
    clearPasswords(form);
    busy = false;
    controls();
  }
}

byId('member-login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = byId('login-email').value.trim();
  const password = byId('login-password').value;
  void submitAction(form, 'login', async () => {
    currentUser = await login(email, password);
    sessionClosed = false;
    byId('member-logout-retry').hidden = true;
    resetRequired = false;
    if (!memberDestinationIntent && !editProfileIntent) {
      window.location.assign(returnToMona ? '/mona' : '/?view=for_you');
      return;
    }
    show('account', {focus: true});
    report("You're in. Welcome back.", 'success');
  });
});

byId('member-signup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!registrationAllowed() || !passwordsMatch(form, 'signup-password', 'signup-confirm')) return;
  const name = byId('signup-name').value.trim();
  if (name.length < 2) {
    report('Add a display name with at least two characters.', 'error');
    byId('signup-name').focus();
    return;
  }
  const email = byId('signup-email').value.trim();
  const password = byId('signup-password').value;
  void submitAction(form, 'signup', async () => {
    const user = await signup(email, password, {full_name: name});
    form.reset();
    if (user.confirmedAt) {
      currentUser = await getUser();
      sessionClosed = false;
      show(currentUser ? 'account' : 'login', {focus: true});
      report(currentUser ? "You're in. Welcome to ROOSTER." : 'Your account is ready. You can log in now.', 'success');
    } else {
      byId('login-email').value = email;
      show('login', {focus: true});
      report('Check your email to finish joining. Click the confirmation link, then come on back.', 'success');
    }
  });
});

byId('member-forgot-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = byId('forgot-email').value.trim();
  void submitAction(form, 'forgot', async () => {
    try {
      await requestPasswordRecovery(email);
    } catch (error) {
      // Keep the same response when the service does not recognize an email.
      if (Number(error?.status) !== 404) throw error;
    }
    report('If that email has an account, a reset link is on the way. Check your inbox and spam folder.', 'success');
  });
});

byId('member-reset-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if ((!resetRequired && !inviteToken) || !passwordsMatch(form, 'reset-password', 'reset-confirm')) return;
  const password = byId('reset-password').value;
  void submitAction(form, 'reset', async () => {
    if (inviteToken) {
      const invitedUser = await acceptInvite(inviteToken, password);
      // Identity 2.0 accepts the invitation without setting its browser auth
      // cookies. Complete the session through the supported login API before
      // loading profile or inbox endpoints that require those cookies.
      inviteToken = null;
      resetRequired = false;
      currentUser = null;
      byId('login-email').value = invitedUser.email || '';
      try {
        currentUser = await login(invitedUser.email, password);
      } catch (error) {
        show('login', {focus: true, clearStatus: false});
        throw error;
      }
    } else {
      currentUser = await updateUser({password});
    }
    sessionClosed = false;
    resetRequired = false;
    inviteToken = null;
    form.reset();
    show('account', {focus: true});
    report('Your password is saved. Welcome to ROOSTER', 'success');
  });
});

async function signOut() {
  if (!ready || busy) return;
  busy = true;
  sessionClosed = true;
  editProfileIntent = false;
  currentUser = null;
  resetRequired = false;
  inviteToken = null;
  byId('member-logout-retry').hidden = true;
  show('login', {focus: true});
  controls();
  report('Logging you out…');
  try {
    await logout();
    currentUser = null;
    resetRequired = false;
    inviteToken = null;
    show('login', {focus: true});
    report("You're logged out. Come back anytime.", 'success');
  } catch (error) {
    report('Your messages are hidden, but logout could not finish. Please try again.', 'error');
    byId('member-logout-retry').hidden = false;
  } finally {
    busy = false;
    controls();
  }
}
byId('member-logout').addEventListener('click', () => void signOut());
byId('member-logout-retry').addEventListener('click', () => void signOut());

onAuthChange((event, user) => {
  if (sessionClosed && event !== AUTH_EVENTS.LOGOUT) return;
  currentUser = user;
  if (event === AUTH_EVENTS.RECOVERY) resetRequired = true;
  if (event === AUTH_EVENTS.LOGOUT) {
    resetRequired = false;
    inviteToken = null;
  }
  if (!ready || busy) return;
  show(resetRequired ? 'reset' : currentUser ? 'account' : 'login', {clearStatus: false});
});

async function initialize() {
  if (busy) return;
  busy = true;
  ready = false;
  retryButton.hidden = true;
  report('Getting your spot ready…');
  controls();
  try {
    settings = await getSettings();
    let callback = null;
    let callbackError = null;
    try {
      callback = await handleAuthCallback();
    } catch (error) {
      callbackError = error;
      clearAuthHash();
    }
    currentUser = callback?.user || await getUser();
    ready = true;
    if (callback?.type === 'recovery') resetRequired = true;
    if (callback?.type === 'invite') inviteToken = callback.token;
    const nextView = resetRequired || inviteToken ? 'reset' : currentUser ? 'account' : startingDoor || (startingHash === '#signup' ? 'signup' : 'login');
    show(nextView);
    if (callbackError) report(authError(callbackError, 'callback'), 'error');
    else if (callback?.type === 'confirmation') report('Email confirmed. Welcome to ROOSTER', 'success');
    else if (callback?.type === 'email_change') report('Your new email is confirmed.', 'success');
    else if (callback?.type === 'recovery') report('Your reset link worked. Set your new password below.', 'success');
    else if (callback?.type === 'invite') report('Your invite is ready. Set your password to finish joining.', 'success');
  } catch {
    settings = null;
    ready = false;
    report('Logging in to the ROOSTER is unavailable right now. Please try again in a moment. The music and photos are still open.', 'error');
    retryButton.hidden = false;
  } finally {
    busy = false;
    controls();
  }
}

retryButton.addEventListener('click', () => void initialize());
window.addEventListener('pagehide', () => {
  for (const form of document.querySelectorAll('.member-card form')) clearPasswords(form);
});
window.addEventListener('hashchange', () => {
  const hash = window.location.hash;
  if (hash === '#edit-profile') editProfileIntent = true;
  // The two invite-only doors are links from every page, so they open here.
  if (hash === '#invite-code' || hash === '#request-invite') {
    if (!ready || busy) return;
    if (currentUser) show('account', {clearStatus: false});
    else show(hash === '#invite-code' ? 'invite' : 'request');
    return;
  }
  const tool = accountToolFromHash(hash);
  if (!tool) return;
  if (hash !== '#edit-profile') memberDestinationIntent = hash;
  if (!ready || busy) return;
  if (currentUser?.confirmedAt) show('account', {clearStatus:false});
  else show(resetRequired || inviteToken ? 'reset' : 'login', {clearStatus:false});
});
window.addEventListener('pageshow', (event) => {
  if (!event.persisted || sessionClosed) return;
  void getUser().then((user) => {
    if (sessionClosed) return;
    currentUser = user;
    show(resetRequired || inviteToken ? 'reset' : user ? 'account' : 'login', {clearStatus:false});
    if (!user) report('Log in again to open your account.', 'error');
  });
});
void initialize();

// A wall login returns to the same profile only after the server confirms this session.
async function returnToMemberWall() {
  const values = new URLSearchParams(window.location.search).getAll('wall_member');
  if (wallReturning || values.length !== 1 || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(values[0])) return;
  const sessionId = currentUser?.id;
  if (!sessionId || !currentUser?.confirmedAt) return;
  wallReturning = true;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/profile/me', {credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
    const data = await response.json();
    if (!response.ok || data.profile?.id !== sessionId || currentUser?.id !== sessionId) throw new Error('Session unavailable');
    window.location.assign(`/profile.html?id=${values[0].toLowerCase()}#member-wall`);
  } catch { wallReturning = false; report('Your wall could not reopen yet. Try logging in again, then open their page.'); }
  finally { clearTimeout(timeout); }
}
