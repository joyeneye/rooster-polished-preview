import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const oldSiteName = /j\.?\s*white['’]s\s+space/gi;

function titleOf(html, name) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
  assert.ok(title, `${name} is missing its document title`);
  return title;
}

function wordmarkOf(html, name) {
  const wordmark = html.match(/<a\b[^>]*class="[^"]*(?:\bwordmark\b|\bcommunity-brand\b|\bprofile-wordmark\b)[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '';
  assert.ok(wordmark, `${name} is missing its site wordmark`);
  // The O is its own element so it can wear the orange, so tags are dropped
  // without inserting a space — otherwise the mark reads as "R O STER".
  return wordmark.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

test('ROOSTER replaces only the old community site name across hand-authored pages and dynamic profile titles', async () => {
  const htmlNames = [
    'index.html',
    'members.html',
    'people.html',
    'profile.html',
    'member-photos.html',
    'my-profile.html',
    'edit-profile.html',
    'photos.html',
  ];
  const jsNames = ['profile.js', 'profile-album.js'];
  const entries = await Promise.all(
    [...htmlNames, ...jsNames].map(async (name) => [name, await source(name)]),
  );

  for (const [name, text] of entries) {
    oldSiteName.lastIndex = 0;
    assert.doesNotMatch(text, oldSiteName, `${name} still contains an old J.White's Space site-name variant`);
  }

  for (const name of htmlNames) {
    const html = entries.find(([entryName]) => entryName === name)[1];
    assert.ok(titleOf(html, name).includes('ROOSTER'), `${name} title must carry the ROOSTER brand`);
  }

  for (const name of ['index.html', 'members.html', 'people.html', 'profile.html', 'member-photos.html', 'edit-profile.html', 'photos.html']) {
    const html = entries.find(([entryName]) => entryName === name)[1];
    assert.ok(wordmarkOf(html, name).includes('ROOSTER'), `${name} wordmark must say ROOSTER`);
  }

  for (const name of jsNames) {
    const js = entries.find(([entryName]) => entryName === name)[1];
    assert.match(js, /document\.title\s*=\s*[^;\n]*\| ROOSTER/, `${name} must put ROOSTER in dynamic profile titles`);
  }
});

test('the artist identity and ROOSTER PLAYER use the modern ROOSTER look', async () => {
  const [artistRoute, photos, memberSongs, profileSongs] = await Promise.all([
    source('jwhite.html'),
    source('photos.html'),
    source('member-songs.js'),
    source('profile-songs.js'),
  ]);

  assert.match(artistRoute, /J\.White Did It/, 'the artist name J.White Did It must remain on the owner profile route');
  assert.match(artistRoute, /profile\.html\?id=owner/, 'the retired artist page must forward to the modern owner profile');
  assert.match(titleOf(photos, 'photos.html'), /J\.White['’]s Photos/, "the artist's J.White's Photos title must remain");
  assert.match(photos, /<h1>J\.White['’]s Photos<\/h1>/, "the artist's J.White's Photos heading must remain");
  assert.match(memberSongs, /ROOSTER PLAYER/, 'the requested player name must be ROOSTER PLAYER');
  assert.match(memberSongs, /modern ROOSTER PLAYER/, 'the player help must describe the current design');
  assert.doesNotMatch(memberSongs, /MySpace/, 'the retired player concept must be gone');
  assert.match(profileSongs, /ROOSTER PLAYER/, 'the public player must use the ROOSTER PLAYER name');
  assert.match(profileSongs, /ROOSTER Audio/, 'uploaded tracks must use the ROOSTER Audio label');
  assert.doesNotMatch(profileSongs, /MySpace Music/, 'the retired provider label must be gone');
});

test('the front door keeps one clear invite path while the signed-in account has one Requests tab', async () => {
  const html = await source('members.html');
  const topActions = html.match(/<p class="roster-door-actions">([\s\S]*?)<\/p>/)?.[1] || '';
  assert.ok(topActions, 'members.html is missing its top invite actions');
  assert.equal((topActions.match(/data-member-go="request"/g) || []).length, 1, 'the top actions need one Request an Invite choice');
  assert.match(topActions, />Request an Invite<\/button>/, 'the top request choice must use plain language');
  assert.equal((topActions.match(/data-member-go="invite"/g) || []).length, 1, 'the top actions need one Enter Invite Code choice');
  assert.match(topActions, />Enter Invite Code<\/button>/, 'members with a code need one obvious login path');

  const accountStart = html.indexOf('id="member-account"');
  const accountEnd = html.indexOf('<noscript', accountStart);
  assert.ok(accountStart >= 0 && accountEnd > accountStart, 'members.html is missing the signed-in account region');
  const account = html.slice(accountStart, accountEnd);
  const launcher = account.match(/<nav\b[^>]*id="member-account-launcher"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
  assert.ok(launcher, 'the signed-in account launcher is missing');

  assert.equal((launcher.match(/data-account-go="friends"/g) || []).length, 1, 'the account launcher must have exactly one Requests tab');
  assert.match(launcher, /data-account-go="friends"[^>]*href="#friend-requests"[^>]*>Requests<\/a>/, 'the one requests tab must open connection requests');
  assert.doesNotMatch(account, /Invite to the Roster|id="invite-people"|id="invite-(?:share|copy|email|link)"/, 'the removed member invite-sharing panel must stay gone');
  assert.match(account, /<section\b[^>]*id="roster-access-admin"[^>]*data-account-panel="friends"/, 'owner membership approvals must be folded into Requests');
  assert.match(account, /<section\b[^>]*id="friend-requests"[^>]*data-account-panel="friends"/, 'connection requests must use the same Requests panel');

  const loginStart = html.indexOf('id="member-login"');
  const loginEnd = html.indexOf('id="member-signup"', loginStart);
  assert.ok(loginStart >= 0 && loginEnd > loginStart, 'members.html is missing the member login region');
  const login = html.slice(loginStart, loginEnd);
  assert.match(login, /id="login-password"[^>]*type="password"|type="password"[^>]*id="login-password"/, 'login must keep a masked password input by default');
  assert.match(login, /data-toggle-password="login-password"/, 'login needs a control targeting its password input');
  assert.match(login, /aria-controls="login-password"/, 'the show-password control must expose its target accessibly');
  assert.match(login, />\s*Show password\s*<\/button>/i, 'login needs a visible Show password control');
});

test('removed member invite sharing stays gone and password visibility stays accessible', async () => {
  const js = await source('members.js');

  assert.doesNotMatch(js, /navigator\.share\s*\(|navigator\.clipboard(?:\?\.|\.)writeText\s*\(|invite-(?:share|copy|email|link)/, 'members.js must not retain the removed invite-sharing controls');
  assert.match(js, /\[data-toggle-password\]/, 'password visibility controls must be discovered by their shared hook');
  assert.match(js, /\.type\s*=\s*[^;\n]*(?:['"]text['"]|['"]password['"])/, 'password visibility must toggle the input type');
  assert.match(js, /setAttribute\(['"]aria-pressed['"]/, 'password visibility must announce its pressed state');
});
