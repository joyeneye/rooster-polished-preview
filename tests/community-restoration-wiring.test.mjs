import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

function includesAll(text, values, label) {
  for (const value of values) assert.ok(text.includes(value), `${label} is missing ${value}`);
}

test('member-facing pages retain people discovery, one requests entry, walls, albums, filters, and navigation', async () => {
  const [home, profile, members, people, photos] = await Promise.all([
    source('index.html'), source('profile.html'), source('members.html'), source('people.html'), source('member-photos.html'),
  ]);
  includesAll(home, [
    'href="/people.html">People</a>', 'href="/members.html#friend-requests">Requests</a>',
    'id="mobile-more-sheet"', 'community-home.js',
  ], 'home page');
  includesAll(profile, [
    'id="friend-space"', 'data-friend-widget', 'id="public-member-album"', 'id="member-wall"',
    'id="member-wall-form"', 'friend-widget.js', 'profile-wall.js', 'profile-album.js', 'profile-actions.js',
  ], 'member profile page');
  includesAll(members, [
    'id="member-account-launcher"', 'href="#friend-requests">Requests</a>',
    'id="member-discovery"', 'id="owner-discovery"', 'id="member-photo-album"',
    'id="member-profile-filters"', 'id="friend-requests"',
    'friend-requests.js', 'photo-filters.css',
  ], 'member account page');
  includesAll(people, [
    'href="/people.html">People</a>', 'href="/members.html#friend-requests">Requests</a>', 'id="friend-search"',
    'data-member-directory', 'community.js',
  ], 'people directory page');
  includesAll(photos, [
    'data-album-profile>Back to Profile</a>', 'href="/people.html">People</a>',
    'href="/members.html#friend-requests">Requests</a>', 'id="public-member-album"',
    'data-standalone-album', 'profile-album.js',
  ], 'standalone member album page');

  const sheet = home.match(/<dialog\b[^>]*\bid=["']mobile-more-sheet["'][^>]*>([\s\S]*?)<\/dialog>/i)?.[1] || '';
  assert.ok(sheet, 'home page is missing its simple More sheet');
  assert.equal((sheet.match(/>People<\/a>/g) || []).length, 1, 'the home More sheet needs one People choice');
  assert.equal((sheet.match(/>Requests<\/a>/g) || []).length, 1, 'the home More sheet needs one Requests choice');
  assert.doesNotMatch(sheet, />(?:My Roster|The Roster|Search the Roster|Roster Requests|ROOSTER Search|Request an Invite)<\/a>/i,
    'the home More sheet must not repeat old roster or invite choices');

  const launcher = members.match(/<nav\b[^>]*\bid=["']member-account-launcher["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] || '';
  assert.ok(launcher, 'member account page is missing its signed-in launcher');
  assert.equal((launcher.match(/>Requests<\/a>/g) || []).length, 1,
    'the signed-in account launcher needs exactly one Requests choice');
  assert.doesNotMatch(launcher, /invite-people|Request an Invite|Invite to (?:the )?ROOSTER/i,
    'the signed-in account launcher must not keep a duplicate invite tool');
  assert.doesNotMatch(members, /\bid=["']invite-people["']/, 'the duplicate signed-in invite panel must stay removed');
  assert.doesNotMatch(profile, /\bid=["']friend-requests["']|friend-requests\.js/i,
    'a public profile must not carry a hidden copy of the account Requests tool');
});

test('the production build keeps every restored community entry asset and bundles account-only modules', async () => {
  const [build, members] = await Promise.all([source('build.mjs'), source('members.js')]);
  includesAll(build, [
    "'people.html'", "'community.css'", "'community.js'", "'friend-requests.js'",
    "'friend-session.js'", "'friend-widget.js'", "'friend-widget.css'", "'profile-wall.js'",
    "'profile-actions.js'", "'profile-album.js'", "'member-photos.html'", "'photo-filters.css'",
    "'wall-interactions.js'", "'media-menu.js'", "'media-manage.css'",
  ], 'build copy manifest');
  includesAll(members, [
    "from './member-album.js'", "from './member-discovery.js'", 'createMemberAlbum()',
    'createMemberDiscovery({', "'#friend-requests'", "'#member-photo-album'",
    "from './member-media.js'", 'createMemberMedia()', "'#member-media-manage'",
  ], 'members bundle entry');
});

test('restored community clients still point at registered Netlify routes', async () => {
  const clients = Object.fromEntries(await Promise.all([
    'community.js', 'friend-widget.js', 'friend-session.js', 'friend-requests.js',
    'profile-wall.js', 'member-album.js', 'profile-album.js',
  ].map(async (name) => [name, await source(name)])));
  includesAll(clients['community.js'], ['/api/members', 'setupDirectory(', 'memberCard('], 'people directory client');
  includesAll(clients['friend-widget.js'], ['/api/friends?', 'data-friend-list', 'data-add-friend'], 'friends widget client');
  includesAll(clients['friend-session.js'], ['/api/friends/add?', 'jwhite:requests-changed', 'jwhite:friends-changed'], 'friend request handoff client');
  includesAll(clients['friend-requests.js'], ['/api/friend-requests', '/api/friend-requests/respond'], 'friend requests client');
  includesAll(clients['profile-wall.js'], ['/api/member-wall${suffix}?', "path('')", "path('/post')", "path('/delete')"], 'member wall client');
  includesAll(clients['member-album.js'], ['/api/member-album?', '/api/member-album/upload', '/api/member-album/caption', 'RosterMedia?.attach'], 'album manager client');
  includesAll(clients['profile-album.js'], ['/api/member-album?', '/api/profile?id='], 'public album client');
  const routes = {
    'members-list.mts': "path:'/api/members'", 'friends-get.mts': 'path: "/api/friends"',
    'friends-add.mts': 'path: "/api/friends/add"', 'friend-requests-get.mts': "path:'/api/friend-requests'",
    'friend-requests-respond.mts': "path:'/api/friend-requests/respond'", 'member-wall-get.mts': "path:'/api/member-wall'",
    'member-wall-post.mts': "path:'/api/member-wall/post'", 'member-wall-delete.mts': "path:'/api/member-wall/delete'",
    'member-album-get.mts': "path:'/api/member-album'", 'member-album-upload.mts': "path:'/api/member-album/upload'",
    'member-album-delete.mts': "path:'/api/member-album/delete'", 'member-album-caption.mts': "path:'/api/member-album/caption'",
    'member-album-photo.mts': "path:'/api/member-album-photo/:member/:slot/:hash'",
  };
  for (const [name, route] of Object.entries(routes)) {
    const handler = await source(`netlify/functions/${name}`);
    assert.ok(handler.includes(route), `${name} no longer registers ${route}`);
  }
});
