/* INVITE ONLY, in the browser.
 *
 * The server is what actually enforces this: every community endpoint checks
 * the account's access row and answers 403 until J.White has approved it. This
 * module is the part a person sees — the label on the door, the box for an
 * invite code, the waiting-list form, and the Founder's controls for handing
 * out invitations and deciding who gets in.
 *
 * A code somebody types before they have an account is held in this tab only
 * (sessionStorage) and redeemed the moment they finish signing in, so the code
 * survives the trip through the confirmation email without ever being a URL
 * somebody can share by accident.
 */
const CODE_HOLD = 'roster-invite-code';
const CODE_SHAPE = /^ROSTER-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function normalizeInviteCode(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 14 || !raw.startsWith('ROSTER')) return '';
  const code = `ROSTER-${raw.slice(6, 10)}-${raw.slice(10, 14)}`;
  return CODE_SHAPE.test(code) ? code : '';
}

export function heldInviteCode(store) {
  try { return normalizeInviteCode(store?.getItem(CODE_HOLD)); } catch { return ''; }
}

export function holdInviteCode(store, value) {
  const code = normalizeInviteCode(value);
  try { if (code) store?.setItem(CODE_HOLD, code); else store?.removeItem(CODE_HOLD); } catch { /* private mode */ }
  return code;
}

const DEFAULT_STATE = Object.freeze({
  invite_only: true, signed_in: false, approved: false, status: 'unknown',
  is_owner: false, member_id: null, name: null, grandfathered: false, message: '',
});

async function readJSON(response) {
  try { return await response.json(); } catch { return null; }
}

export function createRosterAccess({
  document: doc = document,
  storage = (() => { try { return window.sessionStorage; } catch { return null; } })(),
  fetchImpl = (...args) => fetch(...args),
  onChange = () => {},
} = {}) {
  const byId = (id) => doc.getElementById(id);
  let state = {...DEFAULT_STATE};
  let user = null;
  let loading = false;
  let overview = null;
  let mintedCode = '';

  const status = (name, message, tone = '') => {
    const nodes = [...doc.querySelectorAll('.' + name)];
    const single = byId(name);
    if (single && !nodes.includes(single)) nodes.push(single);
    for (const node of nodes) {
      node.textContent = message;
      node.dataset.tone = tone;
    }
  };

  function paint() {
    doc.body.dataset.memberAccess = state.approved ? 'approved' : state.signed_in ? state.status : 'anonymous';
    const gate = byId('roster-access-gate');
    if (gate) gate.hidden = !(state.signed_in && !state.approved);
    const waiting = byId('access-gate-waiting');
    if (waiting) {
      waiting.hidden = state.status !== 'declined';
      waiting.textContent = state.status === 'declined'
        ? 'This account has not been approved to join ROOSTER. If you think that is a mistake, request an invite again and say who you are.'
        : '';
    }
    const note = byId('access-gate-message');
    if (note) note.textContent = state.message || '';
    const admin = byId('roster-access-admin');
    if (admin) admin.hidden = !state.is_owner;
    const adminLink = byId('roster-access-admin-link');
    if (adminLink) {
      adminLink.hidden = false;
      adminLink.textContent = state.is_owner ? 'Approve & Codes' : 'Requests';
      adminLink.setAttribute('href', state.is_owner ? '#roster-access-admin' : '#friend-requests');
    }
    onChange(state);
  }

  async function refresh() {
    if (loading) return state;
    loading = true;
    try {
      const response = await fetchImpl('/api/access/state', {headers: {Accept: 'application/json'}, credentials: 'same-origin'});
      const body = await readJSON(response);
      state = body && typeof body === 'object' ? {...DEFAULT_STATE, ...body} : {...DEFAULT_STATE};
    } catch {
      // A network hiccup must never look like approval.
      state = {...DEFAULT_STATE};
    } finally {
      loading = false;
    }
    paint();
    return state;
  }

  /** Redeem whatever code is in hand. Called after login so a code typed
   * before the account existed still lets the person in. */
  async function redeem(value, {quiet = false} = {}) {
    const code = normalizeInviteCode(value);
    if (!code) {
      if (!quiet) status('access-code-status', 'Codes look like ROSTER-ABCD-2345. Check the one you were sent.', 'error');
      return false;
    }
    if (!quiet) status('access-code-status', 'Checking your invitation…');
    let body = null;
    try {
      const response = await fetchImpl('/api/access/redeem', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({code}),
      });
      body = await readJSON(response);
      if (!response.ok) throw new Error(body?.error || 'That invite code could not be used.');
    } catch (error) {
      if (!quiet) status('access-code-status', error?.message || 'That invite code could not be used.', 'error');
      return false;
    }
    holdInviteCode(storage, '');
    await refresh();
    if (!quiet) status('access-code-status', body?.message || 'You are in. Welcome to ROOSTER.', 'ok');
    return true;
  }

  async function requestInvite(input) {
    status('access-request-status', 'Sending your request…');
    try {
      const response = await fetchImpl('/api/access/request', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(input),
      });
      const body = await readJSON(response);
      if (!response.ok) throw new Error(body?.error || 'That request could not be sent.');
      status('access-request-status', body?.message || 'You are on the ROOSTER waiting list.', 'ok');
      return true;
    } catch (error) {
      status('access-request-status', error?.message || 'That request could not be sent.', 'error');
      return false;
    }
  }

  /* ------------------------------------------------ the Founder's controls */

  async function admin(payload, {statusId = 'access-admin-status', working = 'Working…'} = {}) {
    status(statusId, working);
    try {
      const response = await fetchImpl('/api/access/admin', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify(payload),
      });
      const body = await readJSON(response);
      if (!response.ok) throw new Error(body?.error || 'That did not go through.');
      overview = body;
      if (body?.invitation?.code) mintedCode = body.invitation.code;
      renderAdmin();
      status(statusId, '');
      return body;
    } catch (error) {
      status(statusId, error?.message || 'That did not go through.', 'error');
      return null;
    }
  }

  function row(parts) {
    const li = doc.createElement('li');
    li.className = 'access-row';
    const top = doc.createElement('div');
    top.className = 'access-row-top';
    for (const piece of parts.top) top.appendChild(piece);
    li.appendChild(top);
    if (parts.detail) {
      const small = doc.createElement('small');
      small.textContent = parts.detail;
      li.appendChild(small);
    }
    if (parts.actions?.length) {
      const actions = doc.createElement('div');
      actions.className = 'access-row-actions';
      for (const button of parts.actions) actions.appendChild(button);
      li.appendChild(actions);
    }
    return li;
  }

  function text(tag, value, {className = '', dataset = {}} = {}) {
    const node = doc.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    for (const [key, item] of Object.entries(dataset)) node.dataset[key] = item;
    return node;
  }

  function action(label, attribute, value, handler) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset[attribute] = String(value);
    button.addEventListener('click', () => { void handler(); });
    return button;
  }

  function fill(listId, rows, empty) {
    const list = byId(listId);
    if (!list) return;
    list.textContent = '';
    if (!rows.length) {
      const li = doc.createElement('li');
      li.className = 'access-empty';
      li.textContent = empty;
      list.appendChild(li);
      return;
    }
    for (const item of rows) list.appendChild(item);
  }

  function renderAdmin() {
    if (!byId('roster-access-admin') || !overview) return;
    const counts = overview.counts || {};
    const countList = byId('access-counts');
    if (countList) {
      countList.textContent = '';
      for (const [label, key] of [['Approved', 'approved'], ['Waiting', 'waiting_requests'], ['Pending', 'pending'], ['Codes ready', 'usable_invitations']]) {
        const li = doc.createElement('li');
        li.appendChild(text('b', String(counts[key] ?? 0)));
        li.appendChild(text('span', label));
        countList.appendChild(li);
      }
    }
    const minted = byId('access-new-code');
    if (minted) {
      minted.hidden = !mintedCode;
      minted.textContent = '';
      if (mintedCode) {
        minted.appendChild(text('span', 'Send this code to the person you approved: '));
        minted.appendChild(text('code', mintedCode));
      }
    }

    fill('access-requests', (overview.requests || []).filter((entry) => entry.status === 'waiting').map((entry) => row({
      top: [text('strong', entry.name), text('span', entry.status, {className: 'access-tag', dataset: {state: entry.status}})],
      detail: `${entry.email}${entry.about ? ` — ${entry.about}` : ''}`,
      actions: [
        action('Approve and make a code', 'accessApprove', entry.id, () => admin({action: 'approve_request', request_id: entry.id})),
        action('Decline', 'accessDecline', entry.id, () => admin({action: 'decline_request', request_id: entry.id})),
      ],
    })), 'Nobody is waiting right now.');

    fill('access-invitations', (overview.invitations || []).map((entry) => row({
      top: [
        text('code', entry.code),
        text('span', entry.usable ? 'ready' : entry.revoked_at ? 'declined' : 'pending', {className: 'access-tag', dataset: {state: entry.usable ? 'approved' : entry.revoked_at ? 'declined' : 'pending'}}),
      ],
      detail: `${entry.uses} of ${entry.max_uses} used${entry.note ? ` — ${entry.note}` : ''}${entry.expires_at ? ` — expires ${new Date(entry.expires_at).toLocaleDateString()}` : ''}`,
      actions: entry.revoked_at ? [] : [action('Withdraw', 'accessRevoke', entry.id, () => admin({action: 'revoke_invitation', invitation_id: entry.id}))],
    })), 'No invitations yet. Make one above.');

    fill('access-members', (overview.members || []).map((entry) => row({
      top: [
        text('strong', entry.name),
        text('span', entry.status, {className: 'access-tag', dataset: {state: entry.status}}),
        ...(entry.grandfathered ? [text('span', 'already a member', {className: 'access-tag', dataset: {state: 'grandfathered'}})] : []),
      ],
      detail: `${entry.member_id}${entry.invite_code ? ` — joined with ${entry.invite_code}` : ''}`,
      actions: [
        ...(entry.status === 'approved' ? [] : [action('Approve', 'accessApprove', entry.member_id, () => admin({action: 'set_member_access', member_id: entry.member_id, status: 'approved'}))]),
        ...(entry.status === 'declined' ? [] : [action('Withdraw access', 'accessDecline', entry.member_id, () => admin({action: 'set_member_access', member_id: entry.member_id, status: 'declined'}))]),
      ],
    })), 'No accounts yet.');
  }

  /* ------------------------------------------------------------- the wiring */

  function wire() {
    for (const form of doc.querySelectorAll('.access-code-form')) form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = event.currentTarget.elements.code?.value || '';
      const code = normalizeInviteCode(value);
      if (!code) { status('access-code-status', 'Codes look like ROSTER-ABCD-2345. Check the one you were sent.', 'error'); return; }
      if (!state.signed_in) {
        // Hold it and send them to make their account. It is redeemed the
        // moment they are signed in, and until then it grants nothing.
        holdInviteCode(storage, code);
        status('access-code-status', 'Code saved. Create your account below and your invitation is applied as soon as you confirm your email.', 'ok');
        doc.dispatchEvent(new CustomEvent('roster:invite-code-held', {detail: {code}}));
        return;
      }
      void redeem(code);
    });

    for (const form of doc.querySelectorAll('.access-request-form')) form.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      void requestInvite({
        name: form.elements.name?.value || '',
        email: form.elements.email?.value || '',
        about: form.elements.about?.value || '',
      }).then((ok) => { if (ok) form.reset(); });
    });

    byId('access-invitation-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      void admin({
        action: 'create_invitation',
        note: form.elements.note?.value || '',
        max_uses: Number(form.elements.max_uses?.value || 1),
        expires_in_days: Number(form.elements.expires_in_days?.value || 30),
      }, {statusId: 'access-admin-status', working: 'Making a code…'});
    });

    byId('access-admin-refresh')?.addEventListener('click', () => { void admin({action: 'overview'}, {working: 'Loading…'}); });
  }

  wire();

  return {
    state: () => ({...state}),
    isApproved: () => state.approved === true,
    isOwner: () => state.is_owner === true,
    heldCode: () => heldInviteCode(storage),
    refresh,
    redeem,
    requestInvite,
    async setUser(nextUser) {
      const changed = (nextUser?.id || null) !== (user?.id || null);
      user = nextUser || null;
      if (!user) {
        state = {...DEFAULT_STATE};
        overview = null;
        paint();
        return state;
      }
      if (changed || state.status === 'unknown') await refresh();
      // A code typed before the account existed gets spent now.
      const held = heldInviteCode(storage);
      if (held && !state.approved) await redeem(held, {quiet: true});
      if (state.is_owner && !overview) await admin({action: 'overview'}, {working: ''});
      return state;
    },
  };
}
