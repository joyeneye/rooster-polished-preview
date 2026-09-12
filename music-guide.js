// Keep this help aligned with the optional YouTube and community music tools.
export const MUSIC_GUIDE = Object.freeze({
  heading: 'Put your music on your page',
  steps: Object.freeze([
    'Music is optional for every profession. Log in and choose Music in your account.',
    'Love someone’s song? Open their Profile Music, choose a track, then tap Add to my Profile Music.',
    'To add a YouTube song, pick one of your three song spots. Enter its title and YouTube link. Press Add song, or Replace song to change an existing choice.',
    'Open your Profile Music and press Play to listen. In music settings, Remove song or Remove from my page takes a choice off your profile.',
  ]),
  notes: Object.freeze([
    'Choose up to 3 YouTube songs and 3 community favorites. Featured songs keep their original creator’s credit and play counts.',
    'Music waits for Play. Save your profile once before adding music; songs you previously uploaded stay available.',
  ]),
});

/** Builds the guide as a collapsible block so it can sit beside the signup form
 * and inside the music editor without pushing either one down the page. */
export function musicGuideElement({open = false, summary = MUSIC_GUIDE.heading} = {}) {
  const details = document.createElement('details');
  details.className = 'music-guide';
  details.open = open;
  const title = document.createElement('summary');
  title.textContent = summary;
  const steps = document.createElement('ol');
  steps.className = 'music-guide-steps';
  for (const step of MUSIC_GUIDE.steps) {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  }
  const notes = document.createElement('ul');
  notes.className = 'music-guide-notes';
  for (const note of MUSIC_GUIDE.notes) {
    const item = document.createElement('li');
    item.textContent = note;
    notes.append(item);
  }
  details.append(title, steps, notes);
  return details;
}

export function renderMusicGuide(target, options = {}) {
  if (!target) return null;
  const guide = musicGuideElement(options);
  target.replaceChildren(guide);
  return guide;
}
