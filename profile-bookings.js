(() => {
  'use strict';
  const root = document.getElementById('profile-bookings');
  if (!root) return;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const BOOKING_URL = /^\/book\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
  let profileId = '', epoch = 0, controller = null;

  function clear() {
    epoch += 1;
    controller?.abort();
    controller = null;
    root.hidden = true;
    root.replaceChildren();
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function render(data) {
    if (data?.profileId !== profileId || !Array.isArray(data.businesses) ||
        typeof data.canManage !== 'boolean' || data.businesses.length > 20) return;
    const businesses = data.businesses.filter(business => business &&
      typeof business.name === 'string' && business.name.trim() && business.name.length <= 120 &&
      typeof business.bookingUrl === 'string' && business.bookingUrl.length <= 86 && BOOKING_URL.test(business.bookingUrl) &&
      Number.isSafeInteger(business.servicesCount) && business.servicesCount > 0);
    if (!businesses.length && !data.canManage) return;
    const copy = element('div', 'profile-bookings-copy');
    copy.append(element('h2', '', businesses.length ? 'Book a service' : 'Let people book you'));
    copy.append(element('p', '', businesses.length
      ? 'Choose a service and see available times.'
      : 'Add your services and available times. Your booking link will appear right here when you publish.'));
    root.append(copy);
    if (businesses.length) {
      const links = element('div', 'profile-bookings-links');
      businesses.forEach(business => {
        const link = element('a', 'profile-booking-link');
        link.href = business.bookingUrl;
        link.append(element('strong', '', business.name));
        link.append(element('span', '', `${business.servicesCount} ${business.servicesCount === 1 ? 'service' : 'services'} · See times →`));
        links.append(link);
      });
      root.append(links);
    }
    if (data.canManage) {
      const manage = element('a', 'profile-bookings-manage', businesses.length ? 'Manage my bookings' : 'Add booking to my page');
      manage.href = '/booking/dashboard';
      root.append(manage);
    }
    root.hidden = false;
  }
  async function load() {
    clear();
    if (!UUID.test(profileId)) return;
    const expectedId = profileId, expectedEpoch = epoch;
    const requestController = new AbortController();
    controller = requestController;
    const timeout = setTimeout(() => requestController.abort(), 15000);
    try {
      const response = await fetch(`/api/profile-bookings?id=${encodeURIComponent(expectedId)}`, {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: requestController.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      if (expectedEpoch !== epoch || expectedId !== profileId || requestController.signal.aborted) return;
      render(data);
    } catch { /* The profile remains usable when optional booking links cannot load. */ }
    finally {
      clearTimeout(timeout);
      if (controller === requestController) controller = null;
    }
  }
  function ready(profile) {
    profileId = UUID.test(profile?.id || '') ? profile.id.toLowerCase() : '';
    void load();
  }
  window.addEventListener('jwhite:profile-ready', event => ready(event.detail));
  window.addEventListener('jwhite:session-changed', () => void load());
  window.addEventListener('storage', event => { if (!event.key || event.key === 'gotrue.user') void load(); });
  window.addEventListener('pagehide', clear);
  window.addEventListener('pageshow', event => { if (event.persisted) void load(); });
  window.addEventListener('focus', () => { if (!document.hidden) void load(); });
  if (window.JWhitePublicProfile) ready(window.JWhitePublicProfile);
})();
