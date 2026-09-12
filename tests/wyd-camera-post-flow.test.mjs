import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);const read=path=>readFile(new URL(path,root),'utf8');

test('camera modal is centered and mobile-safe with stable contained previews',async()=>{
  const css=await read('roster-camera.css');
  assert.match(css,/\.roster-camera\{[^}]*inset:0[^}]*margin:auto[^}]*width:min\(720px/);
  assert.match(css,/object-fit:contain;object-position:center center/);
  assert.match(css,/height:100dvh/);assert.match(css,/safe-area-inset-top/);assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/min-height:44px/);assert.match(css,/prefers-reduced-motion:reduce/);
});

test('front camera mirror stays preview-only and saved capture remains unmirrored',async()=>{
  const [camera,css]=await Promise.all([read('roster-camera.js'),read('roster-camera.css')]);
  const live=camera.slice(camera.indexOf('function paintLivePreview'),camera.indexOf('function paintActualThumbnails'));
  const saved=camera.slice(camera.indexOf('function drawCapture'),camera.indexOf('async function renderStill'));
  assert.match(live,/facing === 'user'[\s\S]*scale\(-1,1\)/);
  assert.doesNotMatch(saved,/scale\(-1,\s*1\)|translate\(canvas\.width/);
  assert.match(css,/\.roster-camera-stage\[data-facing="user"\] video\{transform:scaleX\(-1\)\}/);
});

test('WYD camera has one capture-preview-caption-location-share state flow',async()=>{
  const [camera,home]=await Promise.all([read('roster-camera.js'),read('community-home.js')]);
  for(const label of ['Close','Switch Camera','Take Photo','Retake','Next','Share','Try Share Again','Add location (optional)'])assert.ok(camera.includes(label),label);
  assert.match(camera,/if\(busy\)return/);assert.match(camera,/dialog\.setAttribute\('aria-busy','true'\)/);
  assert.match(camera,/caption\.value\.trim\(\),location:location\.value\.trim\(\)/);
  assert.match(camera,/removeLocation[^\n]+location\.value=''/);
  assert.match(camera,/Your caption and location are still here/);
  assert.match(home,/postComposer:true,onShare/);
  assert.equal((home.match(/openRosterCamera\(\{title: 'New photo post'/g)||[]).length,1);
});

test('permissions begin only after an explicit camera action',async()=>{
  const [camera,home]=await Promise.all([read('roster-camera.js'),read('community-home.js')]);
  assert.match(home,/const camera = event\.target\.closest\('\[data-slots-camera\]'\)[^\n]+takeSlotsPhoto/);
  assert.match(home,/params\.get\('camera'\)[\s\S]*Tap Take a Pic when you’re ready/);
  assert.doesNotMatch(home,/params\.get\('camera'\)[\s\S]{0,220}takeSlotsPhoto\(cameraButton\)/);
  assert.match(camera,/navigator\.mediaDevices[\s\S]*getUserMedia/);
  assert.doesNotMatch(camera,/geolocation|getCurrentPosition|audio:\s*true/);
});

test('location persists as scoped structured metadata and renders outside caption',async()=>{
  const [client,feed,albums]=await Promise.all([read('community-home.js'),read('netlify/functions/_shared/social-feed.mts'),read('netlify/functions/_shared/member-albums.mts')]);
  assert.match(client,/metadata:\{location:draft\.location,album_photo:/);
  assert.match(client,/roster-post-location/);
  assert.match(feed,/const location=text\(metadata\.location\|\|"",100,"Location"\)/);
  assert.match(feed,/Use a city or place name instead of coordinates/);
  assert.match(feed,/\["location","album_photo","photo_request_id"\]/);
  assert.match(feed,/resolveAlbumPhoto\(member\.id,photoId\)/);
  assert.match(feed,/socialPostMedia/);assert.match(feed,/photo_request_id/);
  assert.match(albums,/findAlbumPhoto\(store:any,memberId:string,photoId:string\)/);
});

test('camera restores background scroll and trigger focus on close',async()=>{
  const camera=await read('roster-camera.js');
  assert.match(camera,/document\.body\.style\.overflow='hidden'/);
  assert.match(camera,/document\.body\.style\.overflow=previousOverflow/);
  assert.match(camera,/window\.scrollTo\(0,pageScroll\)/);
  assert.match(camera,/before\?\.isConnected[^\n]+before\.focus/);
});
