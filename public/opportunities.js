/** Creator Opportunities board. Reading and filtering the board needs no
 * account, so this script runs for visitors too; the posting form, the private
 * applications list and the close control only appear once /api/profile/me
 * says somebody is signed in. All member-supplied text is written with
 * textContent so a posting can never inject markup into the board. */
(() => {
  'use strict';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const board = document.querySelector('[data-opportunity-board]');
  if (!board) return;

  const listNode = board.querySelector('[data-opportunity-list]');
  const countNode = board.querySelector('[data-opportunity-count]');
  const filterForm = board.querySelector('[data-opportunity-filters]');
  const sortNode = board.querySelector('[data-opportunity-sort]');
  const postPanel = board.querySelector('[data-opportunity-post]');
  const postForm = postPanel && postPanel.querySelector('form');
  const postStatus = postPanel && postPanel.querySelector('[data-post-status]');
  const signedOutNote = board.querySelector('[data-opportunity-signed-out]');

  let me = null;
  let vocabulary = null;
  let sort = 'newest';
  let loading = false;

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error((data && data.error) || 'Please try again.');
        error.status = response.status;
        throw error;
      }
      return data || {};
    } finally {
      clearTimeout(timer);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
  }

  function status(node, message, tone) {
    if (!node) return;
    node.textContent = message || '';
    if (tone) node.dataset.tone = tone; else delete node.dataset.tone;
  }

  function label(list, value) {
    if (!Array.isArray(list)) return value || '';
    const found = list.find(item => item.value === value);
    return found ? found.label : (value || '');
  }

  function ago(iso) {
    const then = Date.parse(iso || '');
    if (!Number.isFinite(then)) return '';
    const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days}d ago` : new Date(then).toLocaleDateString();
  }

  function place(item) {
    return [item.city, item.region].filter(Boolean).join(', ');
  }

  function fillSelect(select, values, anyLabel) {
    if (!select) return;
    select.textContent = '';
    select.append(new Option(anyLabel, ''));
    for (const value of values) {
      select.append(value && typeof value === 'object'
        ? new Option(value.label, value.value)
        : new Option(String(value), String(value)));
    }
  }

  /** The vocabulary drives both the filters and the posting form, so the page
   * never hard-codes a role list that could drift from the server's. */
  async function loadVocabulary() {
    if (vocabulary) return vocabulary;
    vocabulary = await request('/api/opportunities/options');
    fillSelect(filterForm && filterForm.elements.role, vocabulary.seeking_roles || [], 'Any role');
    fillSelect(filterForm && filterForm.elements.genre, vocabulary.genres || [], 'Any genre');
    fillSelect(filterForm && filterForm.elements.mode, vocabulary.work_modes || [], 'Remote or in person');
    if (postForm) {
      fillSelect(postForm.elements.poster_role, vocabulary.poster_roles || [], 'What do you do?');
      fillSelect(postForm.elements.seeking_role, vocabulary.seeking_roles || [], 'Who do you need?');
      fillSelect(postForm.elements.genre, vocabulary.genres || [], 'Any genre');
      fillSelect(postForm.elements.work_mode, vocabulary.work_modes || [], 'Remote or in person');
    }
    return vocabulary;
  }

  function mine(item) {
    if (!me) return false;
    if (me.owner) return true;
    return !!item.posted_by_member_id && item.posted_by_member_id.toLowerCase() === me.id;
  }

  function applicationRow(application) {
    const card = el('li', 'opportunity-application');
    card.append(el('h4', null, `${application.artist_name} · ${application.name}`));
    const rows = [
      ['Applying as', application.lane],
      ['18 or older', application.age_confirmed ? 'Confirmed' : 'Not confirmed'],
      ['Where', [application.city, application.region].filter(Boolean).join(', ')],
      ['Email', application.contact_email],
      ['Instagram', application.instagram],
      ['TikTok', application.tiktok],
      ['Streaming', application.streaming_links],
      ['Samples', application.work_samples],
      ['Performance video', application.performance_video],
      ['Dances / performs', application.can_perform],
      ['Can travel', application.will_travel],
      ['Why them', application.pitch],
      ['Applied', ago(application.created_at)],
    ].filter(([, value]) => value);
    const list = el('dl');
    for (const [term, value] of rows) {
      list.append(el('dt', null, term));
      list.append(el('dd', null, value));
    }
    card.append(list);
    return card;
  }

  async function showApplications(item, host, button) {
    button.disabled = true;
    host.textContent = '';
    host.append(el('p', 'opportunity-status', 'Loading applications…'));
    try {
      const data = await request(`/api/opportunity/applications?slug=${encodeURIComponent(item.slug)}`);
      host.textContent = '';
      const rows = Array.isArray(data.applications) ? data.applications : [];
      if (!rows.length) {
        host.append(el('p', 'opportunity-status', 'No applications yet.'));
      } else {
        const list = el('ul', 'opportunity-applications');
        for (const application of rows) list.append(applicationRow(application));
        host.append(el('p', 'opportunity-status', `${rows.length} application${rows.length === 1 ? '' : 's'}. These are private to you.`));
        host.append(list);
      }
    } catch (error) {
      host.textContent = '';
      const note = el('p', 'opportunity-status', error.message);
      note.dataset.tone = 'error';
      host.append(note);
    } finally {
      button.disabled = false;
    }
  }

  function opportunityCard(item) {
    const card = el('li', `opportunity-card${item.featured ? ' is-featured' : ''}`);
    const top = el('div', 'opportunity-card-top');
    top.append(el('h3', null, item.title));
    top.append(el('span', 'opportunity-card-when', ago(item.created_at)));
    card.append(top);

    const roles = vocabulary || {};
    card.append(el('p', 'opportunity-pair', `${label(roles.poster_roles, item.poster_role)} looking for ${label(roles.seeking_roles, item.seeking_role)}`));
    if (item.headline) card.append(el('p', 'opportunity-card-headline', item.headline));
    if (item.description) card.append(el('p', 'opportunity-card-body', item.description));

    const tags = el('ul', 'opportunity-tags');
    if (item.featured) tags.append(el('li', 'is-featured-tag', 'Featured'));
    for (const lane of item.lanes || []) tags.append(el('li', null, lane));
    if (item.genre) tags.append(el('li', null, item.genre));
    const where = place(item);
    if (where) tags.append(el('li', null, where));
    tags.append(el('li', null, label(roles.work_modes, item.work_mode)));
    tags.append(el('li', null, `Posted by ${item.posted_by_name}`));
    if (item.application_count > 0) tags.append(el('li', null, item.application_count + ' applied'));
    card.append(tags);

    const actions = el('div', 'opportunity-card-actions');
    const apply = el('a', 'opportunity-apply-link', 'Apply through ROOSTER');
    apply.href = `/apply.html?opportunity=${encodeURIComponent(item.slug)}`;
    actions.append(apply);
    if (item.posted_by_member_id) {
      const profile = el('a', null, `View ${item.posted_by_name}`);
      profile.href = `/profile.html?id=${encodeURIComponent(item.posted_by_member_id)}`;
      actions.append(profile);
    } else if (item.posted_by_kind === 'owner') {
      const profile = el('a', null, 'View J.White’s page');
      profile.href = '/#home';
      actions.append(profile);
    }
    card.append(actions);

    if (mine(item)) {
      const host = el('div');
      const readButton = el('button', null, `Applications (${item.application_count})`);
      readButton.type = 'button';
      readButton.addEventListener('click', () => void showApplications(item, host, readButton));
      const closeButton = el('button', null, item.status === 'open' ? 'Close this' : 'Reopen this');
      closeButton.type = 'button';
      closeButton.addEventListener('click', async () => {
        closeButton.disabled = true;
        try {
          await request('/api/opportunity/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: item.slug, reopen: item.status !== 'open' }),
          });
          await load();
        } catch (error) {
          closeButton.disabled = false;
          status(host, error.message, 'error');
        }
      });
      actions.append(readButton, closeButton);
      card.append(host);
    }
    return card;
  }

  function filters() {
    if (!filterForm) return '';
    const params = new URLSearchParams();
    for (const key of ['role', 'genre', 'mode']) {
      const value = filterForm.elements[key] && filterForm.elements[key].value;
      if (value) params.set(key, value);
    }
    const location = filterForm.elements.place ? filterForm.elements.place.value.trim() : '';
    if (location) params.set('place', location.slice(0, 60));
    params.set('sort', sort);
    return `?${params.toString()}`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      await loadVocabulary();
      const data = await request(`/api/opportunities${filters()}`);
      const rows = Array.isArray(data.opportunities) ? data.opportunities : [];
      listNode.textContent = '';
      listNode.removeAttribute('aria-busy');
      if (!rows.length) {
        const empty = el('p', 'opportunity-empty', 'Nothing matches that yet. Clear the filters to see everything on the board, or post what you are looking for.');
        listNode.append(empty);
      } else {
        for (const item of rows) listNode.append(opportunityCard(item));
      }
      if (countNode) {
        countNode.textContent = rows.length
          ? `${rows.length} open ${rows.length === 1 ? 'opportunity' : 'opportunities'} · ${sort === 'trending' ? 'trending first' : 'newest first'}`
          : 'No open opportunities match these filters.';
      }
    } catch (error) {
      listNode.textContent = '';
      listNode.removeAttribute('aria-busy');
      const note = el('p', 'opportunity-empty', error.message || 'The board could not load. Please try again.');
      listNode.append(note);
    } finally {
      loading = false;
    }
  }

  function applySession(profile) {
    const id = profile && profile.id;
    me = UUID.test(id || '')
      ? { id: String(id).toLowerCase(), owner: profile.verified_owner === true, name: profile.name || '' }
      : null;
    if (postPanel) postPanel.hidden = !me;
    if (signedOutNote) signedOutNote.hidden = !!me;
  }

  async function sessionCheck() {
    try {
      const data = await request('/api/profile/me');
      applySession(data.profile);
    } catch (error) {
      if (error.status === 401 || error.status === 403) applySession(null);
    }
  }

  if (filterForm) {
    filterForm.addEventListener('submit', event => { event.preventDefault(); void load(); });
    filterForm.addEventListener('change', () => void load());
    const reset = filterForm.querySelector('.opportunity-reset');
    if (reset) reset.addEventListener('click', () => {
      filterForm.reset();
      sort = 'newest';
      syncSort();
      void load();
    });
  }

  function syncSort() {
    if (!sortNode) return;
    for (const button of sortNode.querySelectorAll('button[data-sort]')) {
      button.setAttribute('aria-pressed', button.dataset.sort === sort ? 'true' : 'false');
    }
  }

  if (sortNode) {
    sortNode.addEventListener('click', event => {
      const button = event.target.closest('button[data-sort]');
      if (!button) return;
      sort = button.dataset.sort === 'trending' ? 'trending' : 'newest';
      syncSort();
      void load();
    });
    syncSort();
  }

  if (postForm) {
    postForm.addEventListener('submit', async event => {
      event.preventDefault();
      const button = postForm.querySelector('button[type="submit"]');
      const data = new FormData(postForm);
      const body = {};
      for (const key of ['title', 'headline', 'description', 'poster_role', 'seeking_role', 'genre', 'city', 'region', 'work_mode']) {
        body[key] = String(data.get(key) || '').trim();
      }
      if (button) button.disabled = true;
      status(postStatus, 'Posting…');
      try {
        const result = await request('/api/opportunity/post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        postForm.reset();
        await loadVocabulary();
        status(postStatus, result.message || 'Your opportunity is on the board.', 'success');
        await load();
      } catch (error) {
        status(postStatus, error.message, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  void sessionCheck();
  void load();
})();
