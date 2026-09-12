/** The Founder Announcement panel. Regular members never see it: the panel and
 * its launcher link stay hidden unless the server confirms this account may
 * announce, and every send is checked again on the server. */
export function createFounderAnnouncements({onSessionExpired} = {}) {
  const byId = (id) => document.getElementById(id);
  const panel = byId('founder-announcements');
  const link = byId('founder-announcements-link');
  const status = byId('founder-announcements-status');
  const form = byId('founder-announcement-form');
  const subject = byId('founder-announcement-subject');
  const message = byId('founder-announcement-body');
  const audience = byId('founder-announcement-audience');
  const levels = byId('founder-announcement-levels');
  const people = byId('founder-announcement-people');
  const peopleList = byId('founder-announcement-people-list');
  const previewCard = byId('founder-announcement-preview-card');
  const controllers = new Set();
  const MAX_PEOPLE = 200;
  let user = null;
  let generation = 0;
  let access = null;
  let preview = null;
  let slug = null;
  let loading = false;
  let saving = false;

  function report(text, tone = '') {
    status.textContent = text;
    status.dataset.tone = tone;
  }
  function surfaces() {
    return {
      message: byId('founder-surface-message').checked,
      notification: byId('founder-surface-notification').checked,
      homepage: byId('founder-surface-homepage').checked,
    };
  }
  function checkedValues(container) {
    return [...container.querySelectorAll('input[type="checkbox"]')].filter((box) => box.checked).map((box) => box.value);
  }
  function draft() {
    const kind = audience.value;
    return {
      subject: subject.value,
      body: message.value,
      audience: {
        kind,
        levels: kind === 'levels' ? checkedValues(levels) : [],
        member_ids: kind === 'members' ? checkedValues(peopleList) : [],
      },
      surfaces: surfaces(),
      ...(slug ? {slug} : {}),
    };
  }
  function paragraphs(target, text) {
    const parts = String(text).split('\n\n').map((part) => part.trim()).filter(Boolean);
    target.replaceChildren(...parts.map((part) => {
      const line = document.createElement('p');
      line.textContent = part;
      return line;
    }));
  }
  function surfaceWords(chosen) {
    const names = [];
    if (chosen.message) names.push('ROOSTER Message');
    if (chosen.notification) names.push('Notification');
    if (chosen.homepage) names.push('Homepage Announcement');
    return names.length === 3 ? 'All three: ROOSTER Message, Notification and Homepage Announcement' : names.join(' and ');
  }
  function controls() {
    const kind = audience.value;
    levels.hidden = kind !== 'levels';
    people.hidden = kind !== 'members';
    const disabled = !access?.can_send || loading || saving;
    for (const field of [subject, message, audience]) field.disabled = disabled;
    for (const box of form.querySelectorAll('input[type="checkbox"]')) box.disabled = disabled;
    byId('founder-announcement-preview').disabled = disabled;
    byId('founder-announcement-reset').disabled = disabled;
    byId('founder-announcement-send').disabled = disabled || !preview;
    byId('founder-launch').hidden = !access?.can_manage_team;
    byId('founder-launch-action').disabled = disabled || !access?.can_manage_team || access?.membership_live;
    panel.setAttribute('aria-busy', String(loading || saving));
  }
  function renderAudience() {
    audience.replaceChildren(...access.audiences.map((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      const total = access.counts?.[entry.value];
      option.textContent = Number.isInteger(total) ? `${entry.label} (${total})` : entry.label;
      return option;
    }));
    audience.value = access.audiences.some((entry) => entry.value === 'early_members') ? 'early_members' : access.audiences[0].value;
    const legend = document.createElement('legend');
    legend.textContent = 'Membership levels';
    levels.replaceChildren(legend, ...access.levels.map((entry) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = entry.value;
      label.append(box, document.createTextNode(` ${entry.label}`));
      return label;
    }));
    peopleList.replaceChildren(...access.members.map((member) => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = member.id;
      box.addEventListener('change', () => {
        if (checkedValues(peopleList).length > MAX_PEOPLE) {
          box.checked = false;
          report(`You can choose up to ${MAX_PEOPLE} people at a time.`, 'error');
        }
      });
      label.append(box, document.createTextNode(` ${member.name}${member.early_member ? ' — Early Member' : ''}`));
      return label;
    }));
  }
  function renderLaunch() {
    byId('founder-launch-state').textContent = access.membership_live
      ? `The new membership system is on. ${access.launch?.early_member_count ?? 0} existing members hold Early Member status since ${new Date(access.launch.launched_at).toLocaleDateString()}.`
      : 'Turn this on first. Every account that exists right now is given Early Member status, and only then can an announcement about it be sent.';
    byId('founder-launch-action').textContent = access.membership_live ? 'The New Membership System Is On' : 'Turn On The New Membership System';
  }
  function renderHistory() {
    const list = byId('founder-history');
    list.replaceChildren(...access.history.map((row) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = row.subject;
      const detail = document.createElement('p');
      detail.className = 'member-small';
      detail.textContent = `${row.audience_label} · ${row.recipient_count} recipients · ${row.read_count} read · sent ${new Date(row.sent_at).toLocaleString()}`;
      item.append(title, detail);
      return item;
    }));
    byId('founder-history-empty').hidden = access.history.length > 0;
  }
  function render() {
    if (!access?.can_send) {
      panel.hidden = true;
      if (link) link.hidden = true;
      previewCard.hidden = true;
      controls();
      return;
    }
    panel.hidden = false;
    if (link) link.hidden = false;
    byId('founder-announcements-intro').textContent = access.can_manage_team
      ? 'You write it, you see who it reaches, then you send it. Nobody else can send a ROOSTER announcement unless you authorize them.'
      : 'J.White authorized you to send ROOSTER announcements. Every announcement goes out under his name.';
    renderLaunch();
    renderHistory();
    controls();
  }
  function fillLaunchMessage() {
    if (!access?.launch_announcement) return;
    subject.value = access.launch_announcement.subject;
    message.value = access.launch_announcement.body;
    audience.value = access.launch_announcement.audience.kind;
    slug = access.launch_announcement.slug;
    byId('founder-surface-message').checked = access.launch_announcement.surfaces.message;
    byId('founder-surface-notification').checked = access.launch_announcement.surfaces.notification;
    byId('founder-surface-homepage').checked = access.launch_announcement.surfaces.homepage;
    preview = null;
    previewCard.hidden = true;
    controls();
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, {...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: {Accept: 'application/json', ...options.headers}});
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error('Announcement request failed');
        error.status = response.status;
        error.detail = typeof data?.error === 'string' ? data.error : '';
        throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid announcement response');
      return data;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  function validAccess(data) {
    return data?.can_send === true && typeof data.can_manage_team === 'boolean' &&
      Array.isArray(data.audiences) && data.audiences.length > 0 &&
      data.audiences.every((entry) => typeof entry?.value === 'string' && typeof entry?.label === 'string') &&
      Array.isArray(data.levels) && data.levels.every((entry) => typeof entry?.value === 'string' && typeof entry?.label === 'string') &&
      Array.isArray(data.members) && data.members.every((row) => typeof row?.id === 'string' && typeof row?.name === 'string') &&
      Array.isArray(data.history) && typeof data.membership_live === 'boolean' &&
      typeof data.launch_announcement?.subject === 'string' && typeof data.launch_announcement?.body === 'string';
  }
  async function load({keepStatus = false} = {}) {
    if (!user || loading || saving) return;
    const epoch = generation;
    loading = true;
    controls();
    try {
      const data = await request('/api/founder/announcements');
      if (!user || generation !== epoch) return;
      if (!validAccess(data)) throw new Error('Invalid announcement access');
      const first = !access;
      access = data;
      renderAudience();
      render();
      if (first && !subject.value.trim() && !message.value.trim()) fillLaunchMessage();
      if (!keepStatus) report('');
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 403) {
        access = null;
        render();
        return;
      }
      if (error.status === 401) {
        clear();
        onSessionExpired?.();
        return;
      }
      if (access) report('The announcement tools could not refresh. Try again in a moment.', 'error');
    } finally {
      if (user && generation === epoch) {
        loading = false;
        controls();
      }
    }
  }
  async function launch() {
    if (!user || !access?.can_manage_team || access.membership_live || loading || saving) return;
    const epoch = generation;
    saving = true;
    controls();
    report('Turning the new membership system on and marking existing members…');
    try {
      const data = await request('/api/founder/membership', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'launch_membership'})});
      if (!user || generation !== epoch) return;
      if (typeof data.launch?.launched_at !== 'string') throw new Error('Invalid membership launch');
      report(`The new membership system is on. ${data.launch.early_member_count} existing members now hold Early Member status.`, 'success');
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 401) {
        clear();
        onSessionExpired?.();
        return;
      }
      report(error.detail || 'The membership system could not be turned on. Try again in a moment.', 'error');
    } finally {
      if (user && generation === epoch) {
        saving = false;
        controls();
        void load({keepStatus: true});
      }
    }
  }
  async function showPreview() {
    if (!user || !access?.can_send || loading || saving) return;
    const epoch = generation;
    saving = true;
    preview = null;
    previewCard.hidden = true;
    controls();
    report('Counting who this reaches…');
    try {
      const data = await request('/api/founder/announcements/preview', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(draft())});
      if (!user || generation !== epoch) return;
      const card = data.preview;
      if (!card || typeof card.subject !== 'string' || typeof card.body !== 'string' || !Number.isInteger(card.recipient_count)) throw new Error('Invalid announcement preview');
      preview = card;
      slug = typeof card.slug === 'string' ? card.slug : slug;
      byId('founder-preview-count').textContent = `${card.recipient_count} ${card.recipient_count === 1 ? 'member' : 'members'} will get this.`;
      byId('founder-preview-audience').textContent = card.audience_label;
      byId('founder-preview-surfaces').textContent = surfaceWords(card.surfaces);
      byId('founder-preview-subject').textContent = card.subject;
      paragraphs(byId('founder-preview-body'), card.body);
      byId('founder-preview-signature').textContent = `${card.author_name} / ${card.author_title}`;
      previewCard.hidden = false;
      report(card.membership_live ? '' : 'Turn the new membership system on before sending. Existing members need their Early Member status first.', card.membership_live ? '' : 'error');
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 401) {
        clear();
        onSessionExpired?.();
        return;
      }
      report(error.detail || 'That announcement could not be previewed. Check your message and try again.', 'error');
    } finally {
      if (user && generation === epoch) {
        saving = false;
        controls();
      }
    }
  }
  async function send() {
    if (!user || !access?.can_send || !preview || loading || saving) return;
    if (!window.confirm(`Send this announcement to ${preview.recipient_count} ${preview.recipient_count === 1 ? 'member' : 'members'}?`)) return;
    const epoch = generation;
    saving = true;
    controls();
    report('Sending your announcement…');
    try {
      const data = await request('/api/founder/announcements/send', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...draft(), slug: preview.slug})});
      if (!user || generation !== epoch) return;
      if (!Number.isInteger(data.announcement_id)) throw new Error('Invalid announcement result');
      preview = null;
      slug = null;
      previewCard.hidden = true;
      subject.value = '';
      message.value = '';
      report(data.status === 'already_sent'
        ? 'That announcement was already sent. Nobody received a second copy.'
        : `Sent to ${data.recipient_count} ${data.recipient_count === 1 ? 'member' : 'members'}. It is waiting in their ROOSTER messages.`, 'success');
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 401) {
        clear();
        onSessionExpired?.();
        return;
      }
      report(error.detail || 'That announcement could not be sent. Preview it again before trying.', 'error');
    } finally {
      if (user && generation === epoch) {
        saving = false;
        controls();
        void load({keepStatus: true});
      }
    }
  }
  function clear() {
    generation += 1;
    user = null;
    loading = false;
    saving = false;
    access = null;
    preview = null;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    report('');
    render();
  }
  function setUser(member) {
    if (member?.id && member.id === user?.id) return;
    clear();
    if (!member?.id) return;
    user = {id: member.id};
    void load();
  }
  audience.addEventListener('change', () => {
    preview = null;
    previewCard.hidden = true;
    controls();
  });
  for (const field of [subject, message]) {
    field.addEventListener('input', () => {
      if (!preview) return;
      preview = null;
      slug = null;
      previewCard.hidden = true;
      controls();
    });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void showPreview();
  });
  byId('founder-announcement-send').addEventListener('click', () => void send());
  byId('founder-announcement-reset').addEventListener('click', fillLaunchMessage);
  byId('founder-launch-action').addEventListener('click', () => void launch());
  window.addEventListener('pagehide', clear);
  return {setUser};
}
