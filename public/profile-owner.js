(() => {
  'use strict';
  const status = document.querySelector('.profile-tagline');
  const portraits = [...document.querySelectorAll('[data-owner-photo]')];
  const topEight = document.querySelector('.top-eight-grid');
  const about = document.querySelector('[data-owner-about]') || document.querySelector('#owner-about-me');
  const textFields = [
    {element:about, field:'about_me', limit:600},
    {element:document.querySelector('#owner-title-lines'), field:'title_lines', limit:180},
    {element:document.querySelector('#owner-credentials'), field:'credentials', limit:240},
    {element:document.querySelector('#owner-location'), field:'location', limit:140},
  ].filter(item => item.element).map(item => ({...item, originalHTML:item.element.innerHTML}));
  if (!status && !portraits.length && !textFields.length && !topEight) return;
  let request = null;
  let lastCheck = 0;
  const allowedPhoto = path => typeof path === 'string' &&
    (path === '/profile.jpg' || /^\/api\/profile-photo\/[a-f0-9]{64}$/.test(path));
  async function refresh() {
    if (document.hidden || Date.now() - lastCheck < 5000) return;
    lastCheck = Date.now();
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/profile?id=owner', {cache:'no-store',signal:controller.signal});
      if (!response.ok) return;
      const {profile} = await response.json();
      if (controller.signal.aborted || !profile || typeof profile.status !== 'string' || profile.status.length > 160) return;
      if (status) status.textContent = profile.status;
      if (topEight && Array.isArray(profile.top_eight_order) && profile.top_eight_order.length === 8 && new Set(profile.top_eight_order).size === 8) {
        const tracks = new Map([...topEight.querySelectorAll('.top-eight-person[data-track]')].map(node => [node.getAttribute('data-track'), node]));
        if (tracks.size === 8 && profile.top_eight_order.every(id => typeof id === 'string' && tracks.has(id))) {
          // Move the existing links so artwork and music-player handlers stay.
          topEight.replaceChildren(...profile.top_eight_order.map(id => tracks.get(id)));
        }
      }
      for (const {element, field, limit, originalHTML} of textFields) {
        const value = profile[field];
        if (typeof value === 'string' && value.length <= limit) {
          if (value.trim()) {
            element.textContent = value;
            element.style.whiteSpace = 'pre-line';
          } else {
            element.innerHTML = originalHTML;
            element.style.whiteSpace = '';
          }
        } else if (value === undefined || value === null) {
          element.innerHTML = originalHTML;
          element.style.whiteSpace = '';
        }
      }
      if (allowedPhoto(profile.photo_url)) {
        for (const portrait of portraits) {
          if (portrait.getAttribute('src') === profile.photo_url) continue;
          const previous = portrait.getAttribute('src');
          portrait.addEventListener('error', () => { portrait.src = previous || '/profile.jpg'; }, {once:true});
          portrait.src = profile.photo_url;
        }
      }
    } catch {
      // Keep the existing public profile if a refresh is unavailable.
    } finally { clearTimeout(timeout); }
  }
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  void refresh();
})();
