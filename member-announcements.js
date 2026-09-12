/** The Founder announcement a member sees on their ROOSTER home page. The copy
 * itself always comes from the server, so nothing is announced here that was
 * not actually sent. Opening it marks it read and it stops showing on the
 * home page, while the same message stays in their ROOSTER messages. */
export function createMemberAnnouncements({onSessionExpired} = {}) {
  const byId = (id) => document.getElementById(id);
  const panel = byId('member-announcement');
  const status = byId('member-announcement-status');
  const body = byId('member-announcement-body');
  const openButton = byId('member-announcement-open');
  const controllers = new Set();
  let user = null;
  let generation = 0;
  let announcement = null;
  let expanded = false;
  let busy = false;

  function report(text, tone = '') {
    if (!status) return;
    status.textContent = text;
    status.dataset.tone = tone;
  }
  function validRow(row) {
    return Boolean(row) && typeof row === 'object' &&
      Number.isInteger(row.id) && typeof row.subject === 'string' && row.subject.trim() !== '' &&
      typeof row.body === 'string' && row.body.trim() !== '' &&
      typeof row.author_name === 'string' && typeof row.author_title === 'string' &&
      typeof row.read === 'boolean' && typeof row.show_on_homepage === 'boolean' &&
      typeof row.show_as_notification === 'boolean' && typeof row.show_as_message === 'boolean';
  }
  function paragraphs(text) {
    const parts = text.split('\n\n').map((part) => part.trim()).filter(Boolean);
    body.replaceChildren(...parts.map((part) => {
      const line = document.createElement('p');
      line.textContent = part;
      return line;
    }));
  }

  // The flag line above the announcement is styled in capitals, so the brand
  // is written out in its own span that opts back out of the uppercasing.
  function brandLine(node, text) {
    node.replaceChildren();
    const parts = text.split('ROOSTER');
    parts.forEach((part, index) => {
      if (index > 0) {
        const brand = document.createElement('span');
        brand.className = 'brand';
        brand.textContent = 'ROOSTER';
        node.append(brand);
      }
      if (part) node.append(document.createTextNode(part));
    });
  }
  function render() {
    if (!panel) return;
    // Once it has been read it is no longer news on the home page; the copy in
    // their messages is where they re-read it.
    const showing = Boolean(announcement) && (!announcement.read || expanded) &&
      (announcement.show_on_homepage || announcement.show_as_notification);
    panel.hidden = !showing;
    if (!showing) {
      body.hidden = true;
      body.replaceChildren();
      return;
    }
    byId('member-announcement-new').hidden = announcement.read;
    brandLine(byId('member-announcement-from'), `A message from ${announcement.author_name}, ${announcement.author_title}`);
    byId('member-announcement-heading').textContent = announcement.subject;
    body.hidden = !expanded;
    if (expanded) paragraphs(announcement.body);
    else body.replaceChildren();
    openButton.textContent = expanded ? 'Close' : announcement.read ? 'Read Again' : 'Read Message';
    openButton.disabled = busy;
    panel.setAttribute('aria-busy', String(busy));
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
        throw error;
      }
      if (!data || typeof data !== 'object') throw new Error('Invalid announcement response');
      return data;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }
  async function load() {
    if (!user || busy) return;
    const epoch = generation;
    busy = true;
    try {
      const data = await request('/api/announcements/mine');
      if (!user || generation !== epoch) return;
      if (!Array.isArray(data.announcements) || data.announcements.some((row) => !validRow(row))) throw new Error('Invalid announcement list');
      const unread = data.announcements.find((row) => !row.read);
      announcement = unread || null;
      expanded = false;
      report('');
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 401) {
        clear();
        onSessionExpired?.();
        return;
      }
      // A quiet failure: an announcement that cannot load is retried on the
      // next login rather than shown as a broken banner.
      announcement = null;
    } finally {
      if (user && generation === epoch) {
        busy = false;
        render();
      }
    }
  }
  async function open() {
    if (!user || !announcement || busy) return;
    if (expanded) {
      expanded = false;
      render();
      return;
    }
    expanded = true;
    render();
    if (announcement.read) return;
    const epoch = generation;
    const id = announcement.id;
    busy = true;
    render();
    try {
      await request('/api/announcements/read', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({announcement_id: id})});
      if (!user || generation !== epoch) return;
      if (announcement?.id === id) announcement = {...announcement, read: true};
      report('');
      window.dispatchEvent(new CustomEvent('jwhite:announcement-read'));
    } catch (error) {
      if (!user || generation !== epoch) return;
      if (error.status === 401) {
        clear();
        onSessionExpired?.();
        return;
      }
      report('Your message is open, but it could not be marked read yet.', 'error');
    } finally {
      if (user && generation === epoch) {
        busy = false;
        render();
      }
    }
  }
  function clear() {
    generation += 1;
    user = null;
    busy = false;
    announcement = null;
    expanded = false;
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
  openButton?.addEventListener('click', () => void open());
  window.addEventListener('pagehide', clear);
  return {setUser, refresh: () => void load()};
}
