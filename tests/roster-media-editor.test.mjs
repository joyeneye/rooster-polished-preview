import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PHOTO_FILTERS,filterPhotoPixels} from '../photo-effects.js';
import {validVideoTrim} from '../roster-video-editor.js';

const source=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('ROOSTER Looks expose the required original photo treatments with real intensity math',()=>{
  assert.deepEqual(PHOTO_FILTERS.map(item=>item.name),['Original','ROOSTER CLEAN','MAIN CHARACTER','RICH','GOLDEN','SOFT GLOW','STUDIO','SPOTLIGHT','AFTER DARK','VIRAL POP','BEAUTY CLEAN','BARBER FRESH','HAIR GLOW','PRODUCT POP','STREET LUXE','FOOD HEAT','35MM','DISPOSABLE','VINTAGE FADE','CINEMA','NOIR','CHROME','DREAM','VHS','PRISM']);
  const pixels=new Uint8ClampedArray([80,120,160,255]);
  assert.deepEqual([...filterPhotoPixels(pixels,{filter:'juno',strength:0})],[...pixels]);
  assert.notDeepEqual([...filterPhotoPixels(pixels,{filter:'juno',strength:1})],[...pixels]);
});

test('video trim validation enforces a useful frame and the existing 30 second clip limit',()=>{
  assert.equal(validVideoTrim(0,0.49),false);
  assert.equal(validVideoTrim(1,1.5),true);
  assert.equal(validVideoTrim(0,30),true);
  assert.equal(validVideoTrim(0,30.01),false);
});

test('profile and SLOTS media actions enter the authenticated editor upload flows',async()=>{
  const [index,profile,members]=await Promise.all([source('index.html'),source('profile.html'),source('members.html')]);
  assert.match(index,/data-slots-camera/);
  assert.match(index,/members\.html\?editor=video#member-clips-root/);
  assert.match(profile,/members\.html\?editor=photo#member-photo-album/);
  assert.match(members,/roster-media-editor\.css/);
});

test('photo selection opens the editor and keeps the original when canceled',async()=>{
  const [album,profile]=await Promise.all([source('member-album.js'),source('member-profile.js')]);
  assert.match(album,/Opening the ROOSTER media editor/);
  assert.match(album,/queueMicrotask\(\(\)=>selection\.querySelector/);
  assert.match(profile,/openPhotoFilterEditor\(file/);
  assert.match(profile,/edited\?'Edited picture ready[^']*':'Original picture kept/);
});

test('video selection and capture both edit before existing upload confirmation',async()=>{
  const [clips,helper]=await Promise.all([source('member-clips.js'),source('video-helper.js')]);
  assert.match(clips,/openRosterVideoEditor\(file/);
  assert.match(clips,/openRosterVideoEditor\(captured/);
  assert.match(clips,/selectPhoneVideo\(edited\?\.file \|\| file\)/);
  assert.match(clips,/selected = edited\?\.file \|\| captured/);
  assert.match(clips,/Camera starts in \$\{remaining\}/);
  assert.match(clips,/Use rear camera/);
  assert.match(helper,/facingMode:\{ideal:facingMode === 'environment'/);
});

test('editor exports derivatives, offers reset and cancel, and has keyboard-safe dialogs',async()=>{
  const [photo,video,css,build]=await Promise.all([source('photo-filter-editor.js'),source('roster-video-editor.js'),source('roster-media-editor.css'),source('build.mjs')]);
  assert.match(photo,/roster-edited-\$\{Date\.now\(\)\}\.jpg/);
  assert.match(video,/roster-edited-\$\{Date\.now\(\)\}\.webm/);
  assert.match(photo,/dialog\.addEventListener\('cancel'/);
  assert.match(video,/dialog\.addEventListener\('cancel'/);
  assert.match(photo,/Reset/);assert.match(video,/Reset/);
  assert.match(photo,/Selected overlay size/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(build,/roster-media-editor\.css/);
});
