// Only display media paths returned by this site's clips API.
export function validClip(clip) {
  return Boolean(clip && typeof clip === 'object'
    && /^[a-f0-9]{64}$/.test(clip.id)
    && typeof clip.member_id === 'string' && clip.member_id.length > 0 && clip.member_id.length <= 200
    && typeof clip.name === 'string' && clip.name.trim() && clip.name.length <= 120
    && typeof clip.caption === 'string' && clip.caption.length <= 300
    && typeof clip.created_at === 'string' && Number.isFinite(Date.parse(clip.created_at))
    && clip.video_url === `/api/clip-video/${clip.id}`
    && Number.isFinite(clip.duration) && clip.duration > 0 && clip.duration <= 30
    && Number.isInteger(clip.width) && clip.width > 0 && clip.width <= 8192
    && Number.isInteger(clip.height) && clip.height > 0 && clip.height <= 8192);
}

export function clipList(data) {
  if (!data || !Array.isArray(data.clips) || data.clips.length > 100 || !data.clips.every(validClip)) {
    throw new Error('The video list could not be read.');
  }
  return [...new Map(data.clips.map(clip => [clip.id, clip])).values()];
}

export function clipCard(clip) {
  const card = document.createElement('article');
  card.className = 'short-clip-card';
  card.dataset.clipId = clip.id;
  const heading = document.createElement('h4');
  heading.textContent = clip.name;
  const video = document.createElement('video');
  video.className = 'short-clip-video';
  video.controls = true;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'metadata';
  video.setAttribute('aria-label', `Video by ${clip.name}`);
  const caption = document.createElement('p');
  caption.className = 'short-clip-caption';
  caption.textContent = clip.caption;
  caption.hidden = !clip.caption;
  const time = document.createElement('time');
  time.dateTime = clip.created_at;
  time.textContent = new Date(clip.created_at).toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  card.append(heading, video, caption, time);
  return {card, video};
}

export function releaseVideo(video) {
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
}
