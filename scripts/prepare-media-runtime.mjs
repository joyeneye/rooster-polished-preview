// Main application's lockfile is unchanged. Install the pinned converter in
// an isolated build directory, then bundle only its Linux binary and license.
import { mkdir, writeFile, copyFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This production package must be built on Linux x64, such as the Netlify build environment. Do not deploy a Mac or Windows converter to Netlify.');
}
const root = new URL('../', import.meta.url);
const install = new URL('.media-build/', root);
const output = new URL('media-runtime/', root);
await mkdir(install, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(new URL('package.json', install), JSON.stringify({ private: true, dependencies: { 'ffmpeg-static': '5.3.0' } }, null, 2));
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: install, stdio: 'inherit', timeout: 240000 });
const require = createRequire(new URL('package.json', install));
const binary = require('ffmpeg-static');
if (!binary) throw new Error('No media converter for this deployment platform.');
await copyFile(binary, new URL('ffmpeg', output));
await chmod(new URL('ffmpeg', output), 0o755);
await copyFile(new URL('node_modules/ffmpeg-static/LICENSE', install), new URL('FFMPEG-LICENSE', output));
const version = execFileSync(binary, ['-version'], { encoding: 'utf8' }).split('\n')[0];
const encoders = execFileSync(binary, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
for (const encoder of ['libx264', 'aac', 'libmp3lame']) if (!encoders.includes(encoder)) throw new Error(`Missing media encoder: ${encoder}`);
await writeFile(new URL('version.json', output), JSON.stringify({ package: 'ffmpeg-static', packageVersion: '5.3.0', version }, null, 2));
console.log('Media converter installed and encoder checks passed:', version);
// Gate publication on the same real-media and isolated storage tests, using
// the exact binary that will be bundled with the background function.
execFileSync(process.execPath, [
  '--experimental-strip-types', '--loader', './tests/offline-platform-loader.mjs', '--test',
  'tests/upload-repair-jobs.test.mjs', 'tests/upload-repair-real-media.test.mjs',
  'tests/video-moderation.test.mjs', 'tests/member-songs-server.test.mjs',
  'tests/member-music-plays-server.test.mjs', 'tests/member-clips-server.test.mjs',
  'tests/inbox-server.test.mjs', 'tests/member-inbox-client.test.mjs',
  'tests/roster-simple-mobile-ui.test.mjs',
  'tests/music-player-client.test.mjs', 'tests/profile-songs-client.test.mjs',
  'tests/member-songs-client.test.mjs', 'tests/roster-media-editor.test.mjs',
  'tests/roster-typography-enforcement.test.mjs',
  'tests/people-directory-client.test.mjs',
], { cwd: root, stdio: 'inherit', timeout: 240000, env: { ...process.env, FFMPEG_TEST_BINARY: new URL('ffmpeg', output).pathname } });
