(() => {
  const byId = (id) => document.getElementById(id);
  const status = byId('public-profile-status');
  const retry = byId('public-profile-retry');
  const profile = byId('public-profile');
  const signIn = byId('public-profile-sign-in');
  const photo = byId('public-profile-photo');
  const id = new URLSearchParams(window.location.search).get('id')?.toLowerCase() || '';
  const validId = id === 'owner' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  let loading = false;
  let renderedMember = null;
  let refreshEpoch = 0;
  let refreshController = null;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function validMember(member) {
    return member && (UUID.test(member.id || '') || member.id === 'owner') &&
      typeof member.name === 'string' && member.name.length <= 60 &&
      typeof member.status === 'string' && member.status.length <= 160 &&
      (member.about_me === undefined || typeof member.about_me === 'string' && member.about_me.length <= 600) &&
      (member.title_lines === undefined || typeof member.title_lines === 'string' && member.title_lines.length <= 180);
  }
  function cancelRefresh() {
    refreshEpoch += 1;
    refreshController?.abort();
    refreshController = null;
  }
  function safePhoto(value) {
    try {
      if (!value || typeof value !== 'string') return null;
      const url = new URL(value, window.location.origin);
      return url.origin === window.location.origin && ['http:','https:'].includes(url.protocol) ? url.href : null;
    } catch {return null;}
  }
  // Membership badges only arrive once the new membership system is live, so
  // nothing is shown here for a badge that is not real yet.
  function renderMembership(target, membership) {
    if (!target) return;
    const names = [];
    if (membership?.early_member === true) names.push('Early Member');
    if (membership?.founding_member === true) names.push('Founding Member');
    if (membership?.approved_creator === true) names.push('Approved Creator');
    target.replaceChildren(...names.map((name) => {
      const badge = document.createElement('span');
      badge.className = 'member-membership-badge';
      badge.textContent = name;
      return badge;
    }));
    target.hidden = names.length === 0;
  }
  function renderBusinessShowcase(member, image, websiteHref) {
    const section = byId('profile-business-showcase');
    if (!section) return;
    const presentation = window.RoosterProfileProfession?.describe(member) || {};
    const {alysa, crisp, reallyfe, mrWilliams} = presentation;
    const profession = presentation.profession || member.profession;
    const beauty = profession === 'beauty_products';
    const service = profession === 'hairstylist' || profession === 'barber';
    const media = profession === 'journalist' || profession === 'podcaster';
    const professional = ['speaker','ministry','logistics'].includes(profession);
    if (!beauty && !service && !media && !professional && profession !== 'business') { section.hidden = true; return; }
    section.dataset.businessKind = beauty ? 'beauty' : service ? 'service' : media ? 'media' : professional ? profession : 'business';
    byId('profile-business-kicker').textContent = beauty ? 'HAIR • BEAUTY • LIFESTYLE' : crisp ? 'CUTS • FADES • LINEUPS' : service ? 'BOOK • CONNECT • CREATE' : media ? 'PODCAST • INTERVIEWS • CULTURE' : professional ? presentation.kicker : 'ROOSTER BUSINESS';
    byId('profile-business-title').textContent = mrWilliams ? presentation.title : alysa ? 'ALYSA.JORDANN HAIR' : crisp ? 'CRISPBYJMALONE BARBERING' : reallyfe ? 'REALLYFE STREETSTARS' : beauty ? `${member.name || 'This brand'} Beauty` : service ? `Book ${member.name || 'this professional'}` : media ? member.name || 'Media & Stories' : professional ? member.name || 'Meet this professional' : member.name || 'Shop this brand';
    byId('profile-business-description').textContent = beauty
      ? 'Hair products, healthy-hair inspiration and beauty—all together in one easy place.'
      : crisp ? 'Fresh cuts, sharp fades and clean lineups. See the work, check the location and book your chair.'
      : service ? 'See the work, check the location and use the main link to book.'
      : media ? 'Real conversations, interviews and stories from the culture. Watch, listen and follow the latest episode.'
      : professional ? presentation.description
      : 'Discover this member’s products, services and latest work.';
    const action = byId('profile-business-action');
    action.textContent = beauty ? 'Shop Products' : service ? 'Book Now' : media ? 'Watch / Listen' : professional ? 'Visit main link' : 'Visit Business';
    action.hidden = !websiteHref;
    if (websiteHref) action.href = websiteHref; else action.removeAttribute('href');
    const message = byId('profile-business-message');
    message.textContent = alysa ? 'Collaborate' : beauty ? 'Message to Order' : service ? 'Message' : media ? 'Send a Story' : professional ? presentation.inquiry : 'Ask a Question';
    message.href = `/members.html?to=${encodeURIComponent(member.id)}&name=${encodeURIComponent(member.name || 'Member')}#member-mail`;
    const art = byId('profile-business-image');
    if (image) { art.src = image; art.hidden = false; } else { art.removeAttribute('src'); art.hidden = true; }
    section.hidden = false;
  }
  function renderProfile(member) {
    const newMember = byId('public-profile-new-member');
    if (newMember) newMember.hidden = member.profile_pending !== true;
    byId('public-profile-name').textContent = member.name || 'Member';
    const badge = byId('public-profile-verified');
    const gold = member.verified_owner === true;
    badge.hidden = !gold && member.verified !== true;
    badge.className = gold ? 'official-gold-badge' : 'member-verified-badge';
    badge.setAttribute('aria-label', gold ? 'Official ROOSTER profile' : 'Verified on the ROOSTER');
    badge.title = gold ? 'Official ROOSTER profile' : 'Verified on the ROOSTER';
    renderMembership(byId('public-profile-membership'), member.membership);
    byId('public-profile-tagline').textContent = member.status;
    const role = byId('public-profile-title-lines');
    const roleText = window.RoosterProfileProfession?.describe(member).label || (typeof member.title_lines === 'string' ? member.title_lines.trim() : '');
    if (role) { role.textContent = roleText; role.hidden = !roleText; }
    const location = byId('public-profile-location');
    const locationText = typeof member.location === 'string' ? member.location.trim().replace(/\s*\n\s*/g, ', ') : '';
    if (location) { location.textContent = locationText ? `⌖ ${locationText}` : ''; location.hidden = !locationText; }
    const website = byId('public-profile-website');
    let websiteHref = '';
    if (website) {
      try { const candidate = new URL(member.website_url); if (candidate.protocol === 'https:' && !candidate.username && !candidate.password) websiteHref = candidate.href; } catch {}
      website.hidden = !websiteHref;
      if (websiteHref) website.href = websiteHref; else website.removeAttribute('href');
    }
    const aboutSection = byId('public-profile-about-section');
    const aboutText = typeof member.about_me === 'string' ? member.about_me.trim() : '';
    byId('public-profile-about').textContent = aboutText || "This page hasn't added a bio yet.";
    aboutSection.hidden = false;
    byId('public-profile-initial').textContent = [...(member.name || 'M')][0].toUpperCase();
    document.title = `${member.name || 'Member'} | ROOSTER`;
    const image = safePhoto(member.photo_url);
    if (image) {photo.src = image;photo.alt = `${member.name || 'Member'}'s profile picture`;photo.hidden = false;}
    else {photo.removeAttribute('src');photo.hidden = true;}
    renderBusinessShowcase(member, image, websiteHref);
    profile.hidden = false;
    status.textContent = '';
    renderedMember = member;
    window.JWhitePublicProfile = member;
    if (typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('jwhite:profile-ready', {detail:member}));
  }
  // Only a verified read of the signed-in member can update an open profile.
  // Keep the active tab and scroll position under the existing page controller.
  async function updateOwnProfile(member) {
    if (!validMember(member) || !UUID.test(member.id || '') ||
        !renderedMember || renderedMember.id.toLowerCase() !== member.id.toLowerCase()) return false;
    cancelRefresh();
    const epoch = refreshEpoch;
    const before = renderedMember;
    const controller = new AbortController();
    refreshController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/profile/me', {credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if (!response.ok) return false;
      const data = await response.json();
      if (epoch !== refreshEpoch || before !== renderedMember || !validMember(data.profile) ||
          !UUID.test(data.profile.id || '') || data.profile.id.toLowerCase() !== member.id.toLowerCase()) return false;
      renderProfile(data.profile);
      return true;
    } catch { return false; }
    finally {
      clearTimeout(timeout);
      if (refreshController === controller) refreshController = null;
    }
  }
  window.RoosterProfileRenderer = Object.freeze({update:updateOwnProfile});
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('jwhite:session-changed', cancelRefresh);
    window.addEventListener('storage', event => { if (!event.key || event.key === 'gotrue.user') cancelRefresh(); });
    window.addEventListener('pagehide', cancelRefresh);
  }
  async function load() {
    if (!validId) {
      status.textContent = "That profile link doesn't look right. Open Members to get back to the space.";
      retry.hidden = true;
      if (signIn) signIn.hidden = true;
      return;
    }
    if (loading) return;
    loading = true;
    retry.hidden = true;
    if (signIn) signIn.hidden = true;
    status.textContent = 'Loading this ROOSTER profile…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // ROOSTER is invite only, so /api/profile now answers only an approved
      // member. The session cookie has to ride along or every member page
      // reads as "could not load" to somebody who is signed in.
      const response = await fetch(`/api/profile?id=${encodeURIComponent(id)}`, {credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const error = new Error('Profile unavailable');error.status = response.status;
        error.detail = typeof body?.error === 'string' ? body.error.slice(0, 300) : '';
        throw error;
      }
      const data = await response.json();
      if (!data.profile || typeof data.profile.name !== 'string' || typeof data.profile.status !== 'string' || (typeof data.profile.about_me !== 'string' && typeof data.profile.about_me !== 'undefined')) throw new Error('Invalid profile');
      const member = data.profile;
      if ((id !== 'owner' && member.id?.toLowerCase() !== id) || !validMember(member)) throw new Error('Invalid profile');
      renderProfile(member);
    } catch (error) {
      profile.hidden = true;
      // 401 and 403 are the invite-only door, not a broken page. Retrying
      // cannot fix either one, so send the person where they can act instead.
      const gated = error.status === 401 || error.status === 403;
      status.textContent = error.status === 401
        ? 'Log in with your approved ROOSTER account to open member pages.'
        : error.status === 403
          ? (error.detail || 'ROOSTER is invite only. Enter your invite code or request an invite to open member pages.')
          : error.status === 404
            ? "This ROOSTER profile is unavailable right now. Try again or open Discover."
            : "This profile couldn't load just now. Try again in a moment.";
      if (signIn) signIn.hidden = !gated;
      retry.hidden = gated;
    } finally {
      clearTimeout(timeout);
      loading = false;
    }
  }
  photo.addEventListener('error', () => {photo.hidden = true;});
  retry.addEventListener('click', () => void load());
  void load();
})();
