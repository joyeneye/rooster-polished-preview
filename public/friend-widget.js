(() => {
  const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PREVIEW_SIZE = 8;
  const PAGE_SIZE = 24;
  const REFRESH_MS = 15000;
  const PROFILE_CACHE_MS = 60000;

  document.querySelectorAll('[data-friend-widget]').forEach((root) => {
    const get = (selector) => root.querySelector(selector);
    const count = get('[data-friend-count]');
    const label = get('[data-friend-label]');
    const button = get('[data-add-friend]');
    const status = get('[data-friend-status]');
    const loadStatus = get('[data-friend-load-status]');
    const summary = get('[data-friend-summary]');
    const list = get('[data-friend-list]');
    const viewAll = get('[data-friend-view-all]');
    const more = get('[data-friend-more]');
    const retry = get('[data-friend-retry]');
    if (!count || !list || !status || !loadStatus || !summary || !viewAll || !more || !retry) return;

    const queryTarget = new URLSearchParams(window.location.search).get('id');
    const target = (root.dataset.friendTarget === 'pending' ? queryTarget : root.dataset.friendTarget) || '';
    const validTarget = target === 'owner' || MEMBER_ID.test(target);
    const defaultButtonText = button?.textContent || 'Add to My Roster';
    const publicName = document.getElementById('public-profile-name');
    const profiles = new Map();
    const format = (n) => n.toLocaleString('en-US');
    let targetName = root.dataset.friendName || 'This page';
    let total = null;
    let friends = null;
    let expanded = false;
    let limit = PREVIEW_SIZE;
    let adding = false;
    let loadPromise = null;
    let timer = null;
    let failures = 0;
    let renderVersion = 0;
    let fingerprint = '';
    let renderedAt = 0;
    let paused = false;

    function updateName() {
      targetName = target === 'owner' ? 'JWhite' : publicName?.textContent.trim() || root.dataset.friendName || 'This page';
      const heading = get('[data-friend-heading]');
      const owner = get('[data-friend-owner-name]');
      if (heading) heading.textContent = `${targetName}'s Roster`;
      if (owner) owner.textContent = targetName;
      root.dataset.friendName = targetName;
    }
    updateName();
    if (publicName && target !== 'owner') {
      new MutationObserver(updateName).observe(publicName, { childList: true, characterData: true, subtree: true });
    }

    async function request(path, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(path, {
          ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json', ...options.headers },
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const error = new Error(data?.error || 'Request failed');
          error.status = response.status;
          throw error;
        }
        if (!data || typeof data !== 'object') throw new Error('Invalid response');
        return data;
      } finally { clearTimeout(timeout); }
    }

    function setCount(value) {
      // Never invent a zero while loading or after a failed request.
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid roster size');
      total = value;
      count.textContent = format(value);
      count.removeAttribute('aria-label');
      if (label) label.textContent = value === 1 ? 'name' : 'names';
    }
    function initials(name) {
      return String(name || '?').trim().split(/\s+/).slice(0, 2).map((part) => [...part][0] || '').join('').toUpperCase() || '?';
    }
    function safePhoto(value) {
      try {
        if (typeof value !== 'string' || !value) return null;
        const url = new URL(value, location.origin);
        return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol) ? url.href : null;
      } catch { return null; }
    }
    async function getProfile(friend) {
      const cached = profiles.get(friend.member_id);
      if (cached && Date.now() - cached.time < PROFILE_CACHE_MS) return cached.promise;
      const promise = request(`/api/profile?id=${encodeURIComponent(friend.member_id)}`)
        .then((data) => data.profile || null).catch(() => null);
      profiles.set(friend.member_id, { time: Date.now(), promise });
      return promise;
    }
    function friendCard(friend) {
      let name = friend.member_name || (friend.member_id === 'owner' ? 'JWhite' : 'Member');
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'profile-friend-card';
      link.href = friend.member_id === 'owner' || friend.profile_url === '/#home'
        ? '/#home' : `/profile.html?id=${encodeURIComponent(friend.member_id)}`;
      const caption = document.createElement('span');
      caption.className = 'profile-friend-name';
      const avatar = document.createElement('span');
      avatar.className = 'profile-friend-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      const action = document.createElement('span');
      action.className = 'profile-friend-open';
      action.textContent = friend.automatic_owner === true && friend.member_id === 'owner' ? 'Your Connector · View Profile »' : 'View Profile »';
      // Native links work without popup permissions or click handlers.
      link.append(caption, avatar, action);
      item.append(link);
      function hydrate(profile) {
        if (typeof profile?.name === 'string' && profile.name.trim()) name = profile.name;
        caption.textContent = name;
        caption.title = name;
        link.setAttribute('aria-label', friend.automatic_owner === true && friend.member_id === 'owner'
          ? `View ${name}'s profile, your connector` : `View ${name}'s profile`);
        avatar.textContent = initials(name);
        const photo = safePhoto(profile?.photo_url);
        if (photo) {
          const image = document.createElement('img');
          image.src = photo; image.alt = ''; image.loading = 'lazy';
          image.addEventListener('error', () => image.remove(), { once: true });
          avatar.append(image);
        }
      }
      hydrate(null);
      return {item, hydrate};
    }
    function renderRelationship(value) {
      if (!button) return;
      const expected = target === 'owner' ? 'owner' : target.toLowerCase();
      const returned = typeof value?.target_id === 'string' ? value.target_id.toLowerCase() : null;
      const state = returned === expected && ['self','accepted','incoming','outgoing','declined','none'].includes(value?.state) ? value.state : 'none';
      button.disabled = state === 'self' || state === 'accepted' || state === 'outgoing' || state === 'declined';
      if (state === 'self') {
        button.textContent = 'This Is Your Profile';
        status.textContent = '';
      } else if (state === 'accepted') {
        const connector = target === 'owner' && value.automatic_owner === true;
        button.textContent = connector ? 'J.White Is Your Connector' : 'On My Roster';
        status.textContent = connector ? 'J.White is Your Connector and the first name on your roster.' : 'Already on your roster.';
      } else if (state === 'incoming') {
        button.textContent = 'Respond to Request';
        status.textContent = 'This person sent you a request. Open Roster Requests to respond.';
      } else if (state === 'outgoing') {
        button.textContent = 'Request Sent';
        status.textContent = 'Roster request sent. Waiting for acceptance.';
      } else if (state === 'declined') {
        button.textContent = 'Request Declined';
        status.textContent = 'This roster request was declined.';
      } else {
        button.textContent = defaultButtonText;
        button.disabled = false;
        status.textContent = '';
      }
    }
    function updateControls() {
      const available = friends?.length || 0;
      viewAll.hidden = !available;
      viewAll.textContent = expanded ? 'Back to the Roster »' : 'View the Whole Roster »';
      viewAll.setAttribute('aria-expanded', String(expanded));
      more.hidden = !expanded || limit >= available;
      if (total === null) summary.textContent = 'Loading the roster…';
      else if (friends === null || (total > 0 && !available)) summary.textContent = 'The roster size is available. The roster list is not available yet.';
      else if (!total) summary.textContent = 'Nobody on this roster yet.';
      else summary.textContent = `Displaying ${format(Math.min(limit, available))} of ${format(total)} on the roster.`;
    }
    async function renderFriends(force = false) {
      updateControls();
      const shown = (friends || []).slice(0, limit);
      const key = JSON.stringify(shown.map((f) => [f.member_id, f.member_name, f.created_at, f.automatic_owner === true]));
      if (!force && key === fingerprint && Date.now() - renderedAt < PROFILE_CACHE_MS) return;
      const version = ++renderVersion;
      list.setAttribute('aria-busy', 'true');
      // Show working links immediately. Slow or missing photos must never
      // delay every friend card or leave the list blank.
      const cards = shown.map(friendCard);
      list.replaceChildren(...cards.map(card => card.item));
      list.setAttribute('aria-busy', 'false');
      fingerprint = key;
      renderedAt = Date.now();
      for (let start = 0; start < shown.length; start += 4) {
        const resolved = await Promise.all(shown.slice(start, start + 4).map(getProfile));
        if (version !== renderVersion) return;
        resolved.forEach((profile, offset) => cards[start + offset].hydrate(profile));
      }
    }
    function schedule() {
      clearTimeout(timer);
      if (!paused && !document.hidden && navigator.onLine !== false && validTarget) {
        timer = setTimeout(() => void load(), Math.min(REFRESH_MS * (2 ** failures), 60000));
      }
    }
    async function load() {
      if (loadPromise || !validTarget) return loadPromise;
      clearTimeout(timer);
      loadPromise = (async () => {
        try {
          const data = await request(`/api/friends?target_id=${encodeURIComponent(target)}`);
          setCount(data.count);
          const seen = new Set();
          friends = Array.isArray(data.friends) ? data.friends.filter((f) => {
            if (!f || typeof f.member_id !== 'string' || !(f.member_id === 'owner' || MEMBER_ID.test(f.member_id))) return false;
            const key = f.member_id.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }) : null;
          renderRelationship(data.relationship);
          loadStatus.hidden = true;
          retry.hidden = true;
          failures = 0;
          await renderFriends();
        } catch {
          failures += 1;
          loadStatus.textContent = total === null ? 'The roster could not load. Try again.' : 'Showing the last loaded roster size. Reconnecting…';
          loadStatus.hidden = false;
          retry.hidden = false;
          if (total === null) summary.textContent = 'Roster size unavailable right now.';
        } finally {
          loadPromise = null;
          schedule();
        }
      })();
      return loadPromise;
    }

    viewAll.addEventListener('click', () => {
      expanded = !expanded;
      limit = expanded ? PAGE_SIZE : PREVIEW_SIZE;
      void renderFriends(true);
    });
    more.addEventListener('click', () => { limit += PAGE_SIZE; void renderFriends(true); });
    retry.addEventListener('click', () => void load());
    button?.addEventListener('click', async () => {
      if (adding || !validTarget) return;
      adding = true;
      button.disabled = true;
      status.textContent = 'Sending roster request…';
      const intent = window.JWhiteFriendSession?.remember(target);
      try {
        // Allow any earlier read to finish before applying the new count.
        if (loadPromise) await loadPromise;
          const data = await request(`/api/friends/add?target_id=${encodeURIComponent(target)}`, { method: 'POST' });
          setCount(data.count);
          window.JWhiteFriendSession?.forget(intent);
          renderRelationship({target_id:target,state:data.state,automatic_owner:data.automatic_owner});
          if (typeof data.message === 'string' && data.message) status.textContent = data.message;
        if (data.state === 'incoming') {
          const link = document.createElement('a'); link.href = '/members.html#friend-requests';
          link.textContent = ' Open Roster Requests'; status.append(link);
        }
        window.dispatchEvent(new CustomEvent('jwhite:requests-changed'));
        await load();
      } catch (error) {
        status.replaceChildren();
        if (error.status === 401 || error.status === 403) {
          const link = document.createElement('a');
          link.href = `/members.html?add_friend=${encodeURIComponent(target)}`;
          link.textContent = 'Log in or start your roster to send a roster request.';
          status.append(link);
          if (intent) window.location.assign(link.href);
        } else status.textContent = 'Your roster request could not be sent. Try again.';
        button.disabled = false;
      } finally { adding = false; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(timer);
      else void load();
    });
    window.addEventListener('jwhite:friends-changed', event => { if (event.detail?.target === target) void load(); });
    window.addEventListener('online', () => void load());
    window.addEventListener('pagehide', () => { paused = true; clearTimeout(timer); });
    window.addEventListener('pageshow', () => { paused = false; schedule(); });
    window.addEventListener('jwhite:requests-changed', () => void load());
    if (validTarget) void load();
    else {
      if (button) button.disabled = true;
      summary.textContent = 'Choose a valid profile to see their roster.';
    }
  });
})();
