(() => {
  const album = document.getElementById('profile-photos');
  if (!album || typeof album.showModal !== 'function') return;

  const overview = document.getElementById('photos-overview');
  const detail = document.getElementById('photos-detail');
  const image = document.getElementById('photos-image');
  const caption = document.getElementById('photos-caption');
  const position = document.getElementById('photos-position');
  const previous = document.getElementById('photos-prev');
  const next = document.getElementById('photos-next');
  const back = document.getElementById('photos-back');
  const error = document.getElementById('photos-error');
  const original = document.getElementById('photos-original');
  const photos = Array.from(album.querySelectorAll('a[data-photo-index]'));
  if (!overview || !detail || !image || !caption || !position || !previous ||
      !next || !back || !error || !original || !photos.length) return;

  let opener = null;
  let current = 0;

  const primaryClick = event => !event.defaultPrevented && event.button === 0 &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

  const showOverview = restoreFocus => {
    overview.hidden = false;
    detail.hidden = true;
    if (restoreFocus) photos[current].focus();
  };

  const showPhoto = (index, moveFocus = false) => {
    current = (index + photos.length) % photos.length;
    const photo = photos[current];
    overview.hidden = true;
    detail.hidden = false;
    error.hidden = true;
    image.hidden = false;
    image.alt = photo.dataset.alt || photo.dataset.caption || 'J.White photo';
    ['width', 'height'].forEach(dimension => {
      const value = Number(photo.dataset[dimension]);
      if (Number.isInteger(value) && value > 0) image.setAttribute(dimension, value);
      else image.removeAttribute(dimension);
    });
    caption.textContent = photo.dataset.caption || '';
    position.textContent = `Photo ${current + 1} of ${photos.length}`;
    original.href = photo.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    image.src = photo.href;
    previous.disabled = next.disabled = photos.length < 2;
    if (moveFocus) back.focus();
  };

  image.addEventListener('error', () => {
    error.hidden = false;
    image.hidden = true;
  });

  image.addEventListener('load', () => {
    error.hidden = true;
    image.hidden = false;
  });

  document.querySelectorAll('a[data-open-photos]').forEach(link => {
    link.addEventListener('click', event => {
      if (!primaryClick(event)) return;
      try {
        showOverview(false);
        album.showModal();
        opener = link;
        event.preventDefault();
      } catch {
        // Keep the original link usable if the dialog cannot open.
      }
    });
  });

  photos.forEach((photo, index) => {
    photo.addEventListener('click', event => {
      if (!album.open || !primaryClick(event)) return;
      showPhoto(index, true);
      event.preventDefault();
    });
  });

  previous.addEventListener('click', () => showPhoto(current - 1));
  next.addEventListener('click', () => showPhoto(current + 1));
  back.addEventListener('click', () => showOverview(true));

  album.addEventListener('keydown', event => {
    if (!album.open || detail.hidden || event.defaultPrevented || event.altKey ||
        event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showPhoto(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });

  album.querySelectorAll('[data-close-photos]').forEach(button => {
    button.addEventListener('click', () => album.close());
  });

  album.addEventListener('click', event => {
    if (event.target !== album) return;
    const bounds = album.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) album.close();
  });

  album.addEventListener('close', () => {
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  });
})();
