/** The Creator Application. Anybody can send one — no account, no invite code —
 * so this page only needs the opportunity slug from the link that brought the
 * applicant here. The opportunity's own copy is written with textContent, and
 * the confirmation message is whatever the server returns. */
(() => {
  'use strict';
  const root = document.querySelector('[data-apply-root]');
  if (!root) return;

  const titleNode = root.querySelector('[data-apply-title]');
  const headlineNode = root.querySelector('[data-apply-headline]');
  const detailNode = root.querySelector('[data-apply-detail]');
  const form = root.querySelector('[data-apply-form]');
  const statusNode = root.querySelector('[data-apply-status]');
  const laneBlock = root.querySelector('[data-apply-lanes]');
  const laneChoices = root.querySelector('[data-apply-lane-choices]');
  const pitchLabel = root.querySelector('[data-apply-pitch-label]');
  const done = root.querySelector('[data-apply-done]');
  const doneMessage = root.querySelector('[data-apply-done-message]');
  const card = form && form.closest('.apply-card');

  const FALLBACK_SLUG = 'jspace-female-group-2026';
  const params = new URLSearchParams(location.search);
  const slug = (params.get('opportunity') || params.get('slug') || FALLBACK_SLUG).trim();

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
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

  function status(message, tone) {
    if (!statusNode) return;
    statusNode.textContent = message || '';
    if (tone) statusNode.dataset.tone = tone; else delete statusNode.dataset.tone;
  }

  /** One radio per lane, so "Female Rapper" and "Female R&B Singer" come from
   * the opportunity itself rather than being hard-coded on this page. */
  function renderLanes(lanes) {
    if (!laneBlock || !laneChoices) return;
    laneChoices.textContent = '';
    if (!Array.isArray(lanes) || !lanes.length) {
      laneBlock.hidden = true;
      return;
    }
    lanes.forEach(lane => {
      const wrap = document.createElement('label');
      wrap.className = 'apply-lane';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'lane';
      input.value = lane;
      input.required = true;
      if (lanes.length === 1) input.defaultChecked = true;
      const text = document.createElement('span');
      text.textContent = lane;
      wrap.append(input, text);
      laneChoices.append(wrap);
    });
    laneBlock.hidden = false;
  }

  function value(name) {
    const field = form.elements[name];
    return field ? String(field.value || '').trim() : '';
  }

  async function loadOpportunity() {
    try {
      const data = await request(`/api/opportunity?slug=${encodeURIComponent(slug)}`);
      const item = data.opportunity || {};
      if (titleNode && item.title) titleNode.textContent = item.title;
      if (headlineNode) headlineNode.textContent = item.headline || '';
      if (detailNode) detailNode.textContent = item.description || '';
      renderLanes(item.lanes);
      if (pitchLabel && item.featured !== true) {
        const label = pitchLabel.firstChild;
        if (label && label.nodeType === 3) label.nodeValue = 'Why are you right for this?';
      }
      if (item.status !== 'open') {
        if (detailNode) detailNode.textContent = 'This opportunity is closed. Check the board for what is open now.';
        return;
      }
      if (form) form.hidden = false;
      document.title = `${item.title || 'Creator Application'} | ROOSTER`;
    } catch (error) {
      if (detailNode) detailNode.textContent = error.message || 'That opportunity could not be loaded.';
      const back = document.createElement('p');
      back.className = 'apply-done-actions';
      const link = document.createElement('a');
      link.href = '/opportunities.html';
      link.textContent = 'See what is on the board';
      back.append(link);
      if (detailNode && detailNode.parentNode) detailNode.parentNode.append(back);
    }
  }

  if (form) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const laneField = form.elements.lane;
      const body = {
        slug,
        lane: laneField ? String(laneField.value || '') : '',
        name: value('name'),
        artist_name: value('artist_name'),
        age_confirmed: !!(form.elements.age_confirmed && form.elements.age_confirmed.checked),
        city: value('city'),
        region: value('region'),
        contact_email: value('contact_email'),
        instagram: value('instagram'),
        tiktok: value('tiktok'),
        streaming_links: value('streaming_links'),
        work_samples: value('work_samples'),
        performance_video: value('performance_video'),
        can_perform: value('can_perform'),
        will_travel: value('will_travel'),
        pitch: value('pitch'),
      };
      if (!body.age_confirmed) {
        status('Please confirm you are 18 or older.', 'error');
        return;
      }
      if (!body.instagram && !body.tiktok && !body.contact_email) {
        status('Add an Instagram, a TikTok or an email so we can reach you.', 'error');
        return;
      }
      if (!body.streaming_links && !body.work_samples) {
        status('Add at least one link to your music or work samples.', 'error');
        return;
      }
      if (button) button.disabled = true;
      status('Sending your application…');
      try {
        const result = await request('/api/opportunity/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (doneMessage && result.message) doneMessage.textContent = result.message;
        if (card) card.hidden = true;
        if (done) {
          done.hidden = false;
          done.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      } catch (error) {
        status(error.message, 'error');
        if (button) button.disabled = false;
      }
    });
  }

  void loadOpportunity();
})();
