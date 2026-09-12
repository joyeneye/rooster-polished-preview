// Email confirmation and recovery links may return to the site root.
(() => {
  const callback = new URLSearchParams(location.hash.slice(1));
  if (['confirmation_token', 'recovery_token', 'invite_token', 'email_change_token', 'access_token'].some(key => callback.has(key))) {
    location.replace('/members.html' + location.hash);
  }
})();
// Keep music near the top on phones without duplicating the social links.
(() => {
  const social = document.querySelector('.home-page .social-panel');
  const about = document.getElementById('about');
  if (!social || !about) return;
  const desktopPosition = document.createComment('Social links desktop position');
  social.before(desktopPosition);
  const phoneLayout = window.matchMedia('(max-width: 760px)');
  const placeSocialLinks = () => {
    if (phoneLayout.matches) about.after(social);
    else desktopPosition.after(social);
  };
  phoneLayout.addEventListener('change', placeSocialLinks);
  placeSocialLinks();
})();
(() => {
  document.querySelectorAll('.top-eight-person img').forEach(img => {
    const showImage = () => { if (img.naturalWidth > 0) img.classList.add('loaded'); };
    img.addEventListener('load', showImage, {once:true});
    img.addEventListener('error', () => { img.hidden = true; }, {once:true});
    if (img.complete) showImage();
  });
  const booking = document.getElementById('booking-form');
  if (!booking) return;
  document.querySelectorAll('a[href="#booking"]').forEach(link => {
    link.addEventListener('click', () => { booking.open = true; });
  });
  const composer = document.getElementById('comment-composer');
  document.querySelectorAll('a[href="#comments"]').forEach(link => {
    link.addEventListener('click', () => { if (composer) composer.open = true; });
  });
  const followHash = () => {
    if (location.hash === '#booking') booking.open = true;
    if (location.hash === '#comments' && composer) composer.open = true;
  };
  window.addEventListener('hashchange', followHash);
  followHash();
})();
