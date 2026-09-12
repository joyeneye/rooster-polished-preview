import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {cameraCoverCrop, cameraPreviewFilter} from '../roster-camera.js';
import {LIVE_FILTERS, livePreviewFilter} from '../roster-live.js';

const source = name => readFile(new URL('../' + name, import.meta.url), 'utf8');

test('selfie and LIVE cameras expose the same twenty-five original ROOSTER looks', () => {
  assert.equal(cameraPreviewFilter('original'), 'none');
  assert.match(cameraPreviewFilter('noir'), /grayscale/);
  assert.equal(cameraPreviewFilter('url(javascript:bad)'), 'none');
  assert.equal(LIVE_FILTERS.length, 25);
  assert.match(cameraPreviewFilter('main-character'), /contrast/);
  assert.match(livePreviewFilter('juno'), /saturate/);
  assert.match(livePreviewFilter('golden'), /sepia/);
  assert.equal(livePreviewFilter('anything-else'), 'none');
});

test('camera crop centers square selfies and 4:5 album pictures', () => {
  assert.deepEqual(cameraCoverCrop(1920, 1080, 1), {x: 420, y: 0, width: 1080, height: 1080});
  assert.deepEqual(cameraCoverCrop(1080, 1920, 4 / 5), {x: 0, y: 285, width: 1080, height: 1350});
  assert.deepEqual(cameraCoverCrop(1000, 1000, 1), {x: 0, y: 0, width: 1000, height: 1000});
});

test('photo camera is visible before file upload and never asks for a microphone', async () => {
  const [camera, members, owner, album, profile, build] = await Promise.all([
    source('roster-camera.js'), source('members.html'), source('edit-profile.html'),
    source('member-album.js'), source('member-profile.js'), source('build.mjs'),
  ]);
  assert.match(camera, /audio: false/);
  assert.match(camera, /stopCamera\(\);[\s\S]{0,180}getCamera/);
  assert.match(camera, /facing === 'user'/);
  assert.match(members, /id="member-profile-camera"[^>]*>Take a Selfie</);
  assert.match(members, /id="member-album-camera"[^>]*>Take a Photo</);
  assert.match(owner, /id="member-profile-camera"[^>]*>Take a Selfie</);
  assert.match(album, /openRosterCamera/);
  assert.match(profile, /openRosterCamera/);
  assert.match(build, /roster-camera\.js/);
  assert.match(build, /roster-camera\.css/);
});

test('LIVE filters are visible, go out on a canvas track and survive early ICE', async () => {
  const [client, html, css] = await Promise.all([source('roster-live.js'), source('live.html'), source('roster-live.css')]);
  assert.match(html, /id="live-filter-panel"/);
  assert.equal((html.match(/data-live-filter="original"/g) || []).length, 2);
  assert.match(client, /canvas\.captureStream\(30\)/);
  assert.match(client, /filteredStream = new Stream/);
  assert.match(client, /pendingCandidates: \[\]/);
  assert.match(client, /if \(!pc\.remoteDescription\?\.type\) peer\.pendingCandidates\.push/);
  assert.match(client, /schedulePeerRetry/);
  assert.match(css, /\.live-preview\[data-facing="user"\] video/);
  assert.doesNotMatch(css, /\.live-preview video[^}]*scaleX/s);
});
