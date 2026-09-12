const root = document.getElementById('rr-public-reviews');
const escapeHTML = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const slug = new URLSearchParams(location.search).get('room');
if (!slug) {
  root.innerHTML = '<p class="rr-public-loading">Add a Review Room code to this link to see its published reviews.</p>';
} else {
  fetch(`/api/review-room/public?room=${encodeURIComponent(slug)}`)
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
    .then(data => {
      document.title = `${data.workspace.name} | Reviews`;
      document.getElementById('rr-public-name').textContent = data.workspace.name;
      document.getElementById('rr-public-bio').textContent = data.workspace.bio || 'Honest notes. Clear scores. Music worth talking about.';
      document.getElementById('rr-public-submit').href = `/review-room.html?room=${encodeURIComponent(data.workspace.slug)}&view=submit`;
      root.innerHTML = data.reviews.length ? data.reviews.map(review => `<article class="rr-public-review ${review.featured ? 'featured' : ''}"><span class="rr-public-score">${review.overall_score}</span><small>/ 10</small><h2>${escapeHTML(review.title)}</h2><p class="byline">${escapeHTML(review.artist_name)} · ${escapeHTML(review.genre)} · reviewed by ${escapeHTML(review.reviewer_name)}</p><blockquote>${escapeHTML(review.feedback)}</blockquote></article>`).join('') : '<p class="rr-public-loading">No public reviews have been published in this room yet.</p>';
    })
    .catch(error => { root.innerHTML = `<p class="rr-public-loading">${escapeHTML(error.message || 'Review Room not found.')}</p>`; });
}
