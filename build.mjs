import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import './patch-identity.mjs';
import sharp from 'sharp';
import {verifyEditorPackaging} from './scripts/verify-editor-packaging.mjs';
// Fail during the build if the deployed photo-processing binary cannot load.
await sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).jpeg().toBuffer();
const files = ['community-home.css','community-home.js','booking.css','booking-marketplace.html','booking-marketplace.js','booking-provider.html','booking-provider.js','booking-dashboard.html','booking-manage.html','booking-manage.js','booking-admin.html','review-room.html','reviews.html','review-room.css','reviews.js','media-menu.js','media-manage.css','opportunities.html','opportunities.css','opportunities.js','apply.html','apply-client.js','visitors.css','visitors.js','top25.html','top25.js','roster-week.js','photo-filters.css','my-profile.html','my-profile.js','member-photos.html','people.html','community.css','community.js','chat-glow.js','roster-connect.css','about.html','morespace.html','morespace-search.js','news.js','portal-community.js','emoji-picker.js','friend-requests.js','community-updates.css','wall-interactions.js','profile-album.js','release.json', 'friend-session.js', 'index.html', 'style.css', 'script.js', 'music.css', 'music.js', 'radio.html', 'radio.css', 'radio.js', 'wall.js', 'photos.js', 'photos.html', 'members.html', 'members.css', 'profile.html', 'profile.css', 'profile.js', 'profile-wall.js', 'profile-actions.js', 'profile-owner.js', 'friend-widget.js', 'friend-widget.css', 'member-chat.js', 'edit-profile.html', 'owner-editor.css', 'jwhite-world.png', 'profile.jpg', 'comment-received.html',
  // ROOSTER brand assets: the mark, its light variant for dark red
  // surfaces, the favicon, the app icons and the brand stylesheet.
  // The invite-only door, gate and admin styling.
  'roster-access.css',
  // ROOSTER LIVE: the live voice page and the styling for its rooms and
  // the bar that keeps a room while a member moves around ROOSTER.
  'live.html', 'roster-live.css',
  // RCM is the music-business command center linked from every More menu.
  'rcm.html', 'rcm.css', 'rcm.js', 'rcm-money.mjs',
  'roster-brand.css', 'roster-mark.svg', 'roster-mark-light.svg', 'favicon.svg',
  'apple-touch-icon.png', 'roster-icon-192.png', 'roster-icon-512.png', 'site.webmanifest'];
files.push('_redirects');
files.push('jwhite.html');
files.push('profile-profession.js');
files.push('rooster-polish.css', 'rooster-polish.js');
files.push('people-connections.js');
// /mona is a compatibility redirect to the one persistent MONA panel.
files.push('profile-inline-editor.js', 'profile-bookings.js', 'photo-helper.js', 'booking-offerings.mjs', 'booking-event-details.mjs');
files.push('profile-message.js', 'profile-message.css');
// The shared light design foundation, the community home layer, the light
// startup screen and the single-player media coordinator.
files.push('roster-light.css', 'roster-theme.css', 'roster-home.css', 'roster-type.css', 'roster-type-enforcement.css', 'roster-startup.js', 'roster-media-bus.js');
files.push('roster-utility.css', 'roster-utility.js');
files.push('roster-guide.css', 'roster-guide.js', 'roster-promo-radio.mp4', 'roster-promo-create.mp4', 'roster-promo-book.mp4', 'photo-catalog.json');
files.push('slots-promos.mjs', 'roster-first-use.mjs', 'slots-mix.mjs', 'slots.css', 'roster-player.js', 'top-eight-roster.js', 'profile-experience.css', 'profile-experience.js', 'roster-media-editor.css', 'roster-camera.css');
// These source modules are also public browser entry points. Keep the complete
// relative-import graph available even though members.js bundles the same code.
files.push('photo-filter-editor.js', 'roster-video-editor.js', 'photo-effects.js', 'roster-camera.js', 'album-photo-helper.js', 'video-helper.js', 'phone-video.js');
await mkdir(new URL('./public/assets/', import.meta.url), {recursive:true});
await mkdir(new URL('./public/', import.meta.url), {recursive:true});
await cp(new URL('./assets/slots-ads/', import.meta.url), new URL('./public/assets/slots-ads/', import.meta.url), {recursive:true});
await cp(new URL('./assets/fonts/', import.meta.url), new URL('./public/assets/fonts/', import.meta.url), {recursive:true});
await copyFile(new URL('./assets/rooster-logo.webp', import.meta.url), new URL('./public/assets/roster-logo.webp', import.meta.url));
await copyFile(new URL('./top-eight-editor.css', import.meta.url), new URL('./public/top-eight-editor.css', import.meta.url));
for (const file of files) {
  const source = new URL(file, import.meta.url);
  const destination = new URL(`public/${file}`, import.meta.url);
  if (file.endsWith('.html')) {
    // Install renewal before any page makes its first API call. Keeping this
    // here covers profiles, rooms, radio and future pages in the same build.
    const rawHtml = await readFile(source, 'utf8');
    // Shared navigation and feed styles must update on every page together.
    const html = rawHtml.replace(/((?:src|href)=["']\/?(?:community\.js|community\.css|slots\.css|roster-guide\.js|roster-guide\.css|roster-startup\.js))(?:\?[^"']*)?(["'])/g, '$1?v=20260912-shell-links-v3$2')
      .replace(/(src=["']\/?(?:members|roster-live|owner-editor|owner-access|short-clips|profile-songs|review-room|booking-dashboard|booking-admin)\.js)(?:\?[^"']*)?(["'])/g, '$1?v=20260911-session-restoration-v2$2')
      .replace(/(src=["']\/?members\.js)(?:\?[^"']*)?(["'])/g, '$1?v=20260911-text-messages-v4$2');
    if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error(`Missing head in ${file}`);
    const polished = html.replace('</head>', '<link rel="stylesheet" href="/roster-type.css"><link rel="stylesheet" href="/rooster-polish.css?v=1"><script src="/rooster-polish.js?v=1" defer></script></head>')
      .replace(/<body([^>]*?)class="([^"]*)"/, '<body$1class="$2 rooster-polished"');
    await writeFile(destination, polished.replace(/<head(?:\s[^>]*)?>/i, '$&\n<script src="/roster-session.js?v=20260911-session-restoration-v2"></script>'));
  } else await copyFile(source, destination);
}
await build({entryPoints:[new URL('./roster-session.js',import.meta.url).pathname],outfile:new URL('./public/roster-session.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'iife',target:['es2020']});
await cp(new URL('./photos/', import.meta.url), new URL('./public/photos/', import.meta.url), {recursive:true});
await copyFile(new URL('./clips.css', import.meta.url), new URL('./public/clips.css', import.meta.url));
await copyFile(new URL('./songs.css', import.meta.url), new URL('./public/songs.css', import.meta.url));
await build({
  entryPoints: [new URL('./members.js', import.meta.url).pathname],
  outfile: new URL('./public/members.js', import.meta.url).pathname,
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  target: ['es2020'],
});
await build({entryPoints:[new URL('./roster-live.js',import.meta.url).pathname],outfile:new URL('./public/roster-live.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await build({entryPoints:[new URL('./owner-editor.js',import.meta.url).pathname],outfile:new URL('./public/owner-editor.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await build({entryPoints:[new URL('./owner-access.js',import.meta.url).pathname],outfile:new URL('./public/owner-access.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await build({entryPoints:[new URL('./short-clips.js',import.meta.url).pathname],outfile:new URL('./public/short-clips.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await build({entryPoints:[new URL('./profile-songs.js',import.meta.url).pathname],outfile:new URL('./public/profile-songs.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await build({entryPoints:[new URL('./review-room.js',import.meta.url).pathname],outfile:new URL('./public/review-room.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await build({entryPoints:[new URL('./booking-dashboard.js',import.meta.url).pathname],outfile:new URL('./public/booking-dashboard.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
// Parse the exact emitted dashboard, not only its source module. This keeps a
// damaged or partially written bundle from shipping an endless loading shell.
await transform(await readFile(new URL('./public/booking-dashboard.js',import.meta.url),'utf8'),{loader:'js',format:'esm',target:'es2020'});
await build({entryPoints:[new URL('./booking-admin.js',import.meta.url).pathname],outfile:new URL('./public/booking-admin.js',import.meta.url).pathname,bundle:true,minify:true,platform:'browser',format:'esm',target:['es2020']});
await verifyEditorPackaging(new URL('./public/', import.meta.url));
console.log('Public site files prepared.');
