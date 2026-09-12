export function createMemberVerification({onSessionExpired}) {
  const byId = (id) => document.getElementById(id);
  const panel = byId('member-verification');
  const select = byId('verification-member');
  const status = byId('verification-status');
  const controllers = new Set();
  let user = null;
  let generation = 0;
  let members = [];
  let authorized = false;
  let canManageTeam = false;
  let loading = false;
  let saving = false;

  function report(text, tone = '') {status.textContent = text;status.dataset.tone = tone;}
  function selected() {return members.find(member => member.id === select.value);}
  function validRow(row) {return row && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.verified === 'boolean' && typeof row.can_verify === 'boolean';}
  function controls() {
    const member = selected();
    const disabled = !authorized || loading || saving;
    const self = Boolean(member && member.id === user?.id);
    select.disabled = disabled || !members.length;
    byId('verification-refresh').disabled = !user || loading || saving;
    byId('verification-selected').hidden = !member;
    byId('verification-badge-action').disabled = disabled || !member || self;
    byId('verification-team-action').disabled = disabled || !member || self || !canManageTeam;
    byId('verification-team-action').hidden = !canManageTeam;
    byId('verification-self-note').hidden = !self;
    if (member) {
      byId('verification-member-state').textContent = `${member.name}: ${member.verified ? 'Verified' : 'No verified check'}${member.can_verify ? '. Can verify the roster.' : '.'}`;
      byId('verification-badge-action').textContent = member.verified ? 'Remove Verified Check' : 'Give Verified Check';
      byId('verification-team-action').textContent = member.can_verify ? 'Remove Verification Access' : 'Allow to Verify the Roster';
    } else byId('verification-member-state').textContent = '';
    panel.setAttribute('aria-busy', String(loading || saving));
  }
  function render() {
    const old = select.value;
    const option = document.createElement('option');option.value = '';option.textContent = 'Choose somebody on the roster';
    select.replaceChildren(option);
    const names = new Map();
    for (const member of members) names.set(member.name.toLowerCase(), (names.get(member.name.toLowerCase()) || 0) + 1);
    for (const member of members) {
      const entry = document.createElement('option');entry.value = member.id;
      entry.textContent = names.get(member.name.toLowerCase()) > 1 ? `${member.name} (${member.id.slice(0,8)})` : member.name;
      select.append(entry);
    }
    select.value = members.some(member => member.id === old) ? old : '';
    byId('verification-empty').hidden = !authorized || members.length > 0;
    byId('verification-intro').textContent = canManageTeam
      ? 'You choose who gets a check. Giving verification access lets that name on the roster give or remove checks for others. Only you can manage this team.'
      : 'You can give or remove verified checks for others on the roster. J.White manages verification team access.';
    controls();
  }
  async function request(path, options = {}) {
    const controller = new AbortController();controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...options.headers}});
      const data = await response.json().catch(() => null);
      if (!response.ok) {const error = new Error('Verification request failed');error.status = response.status;throw error;}
      if (!data || typeof data !== 'object') throw new Error('Invalid verification response');
      return data;
    } finally {clearTimeout(timeout);controllers.delete(controller);}
  }
  function clearPermissions() {
    authorized = false;canManageTeam = false;members = [];
    select.value = '';select.replaceChildren();
    byId('verification-member-state').textContent = '';
    byId('verification-intro').textContent = '';
    report('');panel.hidden = true;controls();
  }
  async function load({keepStatus = false} = {}) {
    if (!user || loading || saving) return;
    const epoch = generation;loading = true;controls();
    if (!keepStatus && authorized) report('Refreshing roster verification…');
    try {
      const data = await request('/api/verification');
      if (!user || generation !== epoch) return;
      if (!Array.isArray(data.members) || typeof data.can_manage_team !== 'boolean' || data.members.some(row => !validRow(row))) throw new Error('Invalid verification list');
      authorized = true;canManageTeam = data.can_manage_team;
      members = data.members.map(row => ({id:row.id,name:row.name,verified:row.verified,can_verify:row.can_verify}));
      panel.hidden = false;render();
      if (!keepStatus) report('');
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 403) {clearPermissions();return;}
      if (error.status === 401) {clear();onSessionExpired();return;}
      panel.hidden = false;report('Verification tools could not load. Try Refresh the Roster in a moment.', 'error');
    } finally {if (user && generation === epoch) {loading = false;controls();}}
  }
  async function change(action) {
    const member = selected();
    const teamAction = action === 'grant_team' || action === 'revoke_team';
    if (!user || !authorized || loading || saving || !member || member.id === user.id || (teamAction && !canManageTeam)) return;
    const epoch = generation;const id = member.id;
    saving = true;controls();report('Saving your verification change…');
    let reload = false;
    try {
      const data = await request('/api/verification/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({member_id:id,action})});
      if (!user || generation !== epoch) return;
      if (!validRow(data.member) || data.member.id !== id || typeof data.can_manage_team !== 'boolean') throw new Error('Invalid saved verification');
      members = members.map(row => row.id === id ? data.member : row);
      canManageTeam = data.can_manage_team;render();
      report(teamAction ? 'Verification team access updated.' : 'Verified check updated.', 'success');
      reload = true;
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 401) {clear();onSessionExpired();return;}
      if (error.status === 403) {report('That change is not allowed. The roster is being refreshed.', 'error');reload = true;}
      else if (error.status === 404) {report('That name is no longer on the roster. Refresh the Roster to check.', 'error');reload = true;}
      else if (error.status === 429) report('Give it a minute before making another change.', 'error');
      else report('That change could not be confirmed. Refresh the Roster to check before trying again.', 'error');
    } finally {
      if (user && generation === epoch) {
        saving = false;controls();
        if (reload) void load({keepStatus:true});
      }
    }
  }
  function clear() {
    generation += 1;user = null;loading = false;saving = false;
    controllers.forEach(controller => controller.abort());controllers.clear();
    clearPermissions();
  }
  function setUser(member) {
    if (member?.id && member.id === user?.id) return;
    clear();
    if (!member?.id) return;
    user = {id:member.id};void load();
  }
  select.addEventListener('change', controls);
  byId('verification-refresh').addEventListener('click', () => void load());
  byId('verification-badge-action').addEventListener('click', () => {const member = selected();if (member) void change(member.verified ? 'unverify' : 'verify');});
  byId('verification-team-action').addEventListener('click', () => {const member = selected();if (member) void change(member.can_verify ? 'revoke_team' : 'grant_team');});
  window.addEventListener('pagehide', clear);
  return {setUser};
}
