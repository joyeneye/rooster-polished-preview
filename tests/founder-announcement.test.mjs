import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deliverFounderAnnouncement, founderAnnouncementMessageId, getMemberMessages} from '../netlify/functions/_shared/member-messages.mts';
import {
  announcementAccess, announcementAudienceLabel, announcementFailure, AUDIENCE_KINDS,
  FOUNDER_NAME, FOUNDER_TITLE, LAUNCH_ANNOUNCEMENT, LAUNCH_SLUG,
  newAnnouncementSlug, readAnnouncementDraft, readAnnouncementRequest, requireAnnouncer,
} from '../netlify/functions/_shared/founder-announcements.mts';
import {MEMBERSHIP_LEVELS, isMembershipLevel} from '../netlify/functions/_shared/roster-membership.mts';

const founder = {id:'11111111-1111-4111-8111-111111111111',name:'J.White Did It',isOwner:true};
const member = {id:'22222222-2222-4222-8222-222222222222',name:'Early Member'};
const other = {id:'33333333-3333-4333-8333-333333333333',name:'Another Member',isOwner:false};
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

function store(){const records=new Map();return {records,failPrefix:null,
  async get(key){return structuredClone(records.get(key)??null);},
  async setJSON(key,value,{onlyIfNew=false}={}){if(this.failPrefix&&key.startsWith(this.failPrefix))throw new Error('simulated storage failure');if(onlyIfNew&&records.has(key))return {modified:false};records.set(key,structuredClone(value));return {modified:true};},
  async delete(key){records.delete(key);},
  async *list({prefix}){yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
};}
function stores(){return {directory:store(),messages:store(),friends:store(),walls:store()};}
function profiles(binding=founder.id){const value=store();if(binding!==null)value.records.set('owner-binding',{id:binding});return value;}
function draft(overrides={}){return {subject:'A message from J.White Did It, Founder of ROSTER',body:'Yo, I wanted to personally say thank you for being here early.',audience:{kind:'early_members'},surfaces:{message:true,notification:true,homepage:true},...overrides};}
async function inbox(bag,user){const response=await getMemberMessages(new Request('https://jwhitedidit.net/api/member-messages'),bag,async()=>user);assert.equal(response.status,200);return response.json();}

test('the Early Member announcement is J.White’s message word for word, and says invitations are coming', () => {
  assert.equal(LAUNCH_ANNOUNCEMENT.slug, LAUNCH_SLUG);
  assert.equal(LAUNCH_ANNOUNCEMENT.subject, 'A message from J.White Did It, Founder of ROSTER');
  const body = LAUNCH_ANNOUNCEMENT.body;
  for (const line of [
    'Yo, I wanted to personally say thank you for being here early.',
    'ROSTER is becoming an approval and invite based community',
    'you’re part of the early ROSTER community',
    'Your account isn’t going anywhere and you don’t have to apply again.',
    'You’ll see an Early Member badge added to your profile.',
    'Some early members will also become Founding Members',
    'Real artists.\nReal producers.\nReal writers.\nEngineers.\nDJs.\nExecutives.\nCreatives.',
    'People looking for real relationships and opportunities.',
    'This isn’t about followers.',
    'It’s about who’s in the room.',
    'We’re still early.',
    'Let’s build this right.',
    'J.White Did It\nFounder of ROSTER',
  ]) assert(body.includes(line), line);
  // Invitations are described as coming later, not as available now.
  assert.match(body, /Eventually you’ll also be able to invite certain people/);
  assert(!/invite people now|start inviting today/i.test(body));
  assert(body.length <= 3000 && LAUNCH_ANNOUNCEMENT.subject.length <= 100);
  assert.deepEqual(LAUNCH_ANNOUNCEMENT.surfaces, {message:true,notification:true,homepage:true});
  assert.equal(LAUNCH_ANNOUNCEMENT.audience.kind, 'early_members');
  // The draft the dashboard prefills has to survive the server's own checks.
  const prepared = readAnnouncementDraft({...LAUNCH_ANNOUNCEMENT, audience:{...LAUNCH_ANNOUNCEMENT.audience}});
  assert.equal(prepared.slug, LAUNCH_SLUG);
  assert.equal(prepared.body, LAUNCH_ANNOUNCEMENT.body);
});

test('a repeated deployment, a double send and a refresh leave exactly one copy in a member’s messages', async () => {
  const bag = stores();
  const results = await Promise.all(Array.from({length: 25}, () =>
    deliverFounderAnnouncement(member, {id: founder.id, name: FOUNDER_NAME}, LAUNCH_ANNOUNCEMENT, bag)));
  assert.equal(results.filter(result => result.status === 'sent').length, 1);
  assert(results.every(result => ['sent','already_sent'].includes(result.status)));
  const first = await inbox(bag, member);
  assert.equal(first.inbox.length, 1);
  assert.equal(first.inbox[0].sender_name, FOUNDER_NAME);
  assert.equal(first.inbox[0].subject, LAUNCH_ANNOUNCEMENT.subject);
  assert.match(first.inbox[0].body, /It’s about who’s in the room\./);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await deliverFounderAnnouncement(member, {id: founder.id, name: FOUNDER_NAME}, LAUNCH_ANNOUNCEMENT, bag)).status, 'already_sent');
  }
  const again = await inbox(bag, member);
  assert.equal(again.inbox.length, 1);
  assert.deepEqual(again.inbox[0], first.inbox[0]);
  assert.equal([...bag.messages.records.keys()].filter(key => key.startsWith('messages/')).length, 1);
  // The Founder's own copy is in Sent, and it is nobody else's message.
  assert.equal((await inbox(bag, {id: founder.id, name: FOUNDER_NAME})).sent.length, 1);
  assert.equal((await inbox(bag, other)).inbox.length, 0);
});

test('each member gets their own message and an interrupted delivery retries without duplicating', async () => {
  const bag = stores();
  const mine = founderAnnouncementMessageId(LAUNCH_SLUG, member.id);
  assert.equal(mine, founderAnnouncementMessageId(LAUNCH_SLUG, member.id.toUpperCase()));
  assert.notEqual(mine, founderAnnouncementMessageId(LAUNCH_SLUG, other.id));
  assert.notEqual(mine, founderAnnouncementMessageId('founder-second-announcement', member.id));
  bag.messages.failPrefix = `inbox/${member.id}/`;
  await assert.rejects(deliverFounderAnnouncement(member, {id: founder.id, name: FOUNDER_NAME}, LAUNCH_ANNOUNCEMENT, bag));
  assert.equal((await inbox(bag, member)).inbox.length, 0);
  bag.messages.failPrefix = null;
  assert.equal((await deliverFounderAnnouncement(member, {id: founder.id, name: FOUNDER_NAME}, LAUNCH_ANNOUNCEMENT, bag)).status, 'already_sent');
  const page = await inbox(bag, member);
  assert.equal(page.inbox.length, 1);
  assert.equal(page.inbox[0].id, mine);
  assert.equal((await deliverFounderAnnouncement({id: founder.id, name: FOUNDER_NAME}, {id: founder.id, name: FOUNDER_NAME}, LAUNCH_ANNOUNCEMENT, bag)).status, 'author');
});

test('only J.White and an administrator he authorized can send, and a withdrawn grant stops working', async () => {
  const owned = profiles();
  const access = await announcementAccess(founder, owned);
  assert.deepEqual({...access}, {founderId: founder.id, isFounder: true, canSend: true, canManageTeam: true});
  assert.equal(requireAnnouncer(access), founder.id);

  const regular = await announcementAccess(other, owned);
  assert.equal(regular.canSend, false);
  assert.equal(regular.canManageTeam, false);
  assert.throws(() => requireAnnouncer(regular), error => error.status === 403);

  owned.records.set(`announcement-team/${other.id}`, {id: other.id, can_announce: true, granted_by: founder.id});
  const authorized = await announcementAccess(other, owned);
  assert.equal(authorized.canSend, true);
  // An authorized administrator still cannot authorize anybody else.
  assert.equal(authorized.canManageTeam, false);
  assert.equal(requireAnnouncer(authorized), founder.id);

  owned.records.set(`announcement-team/${other.id}`, {id: other.id, can_announce: false, granted_by: founder.id});
  assert.equal((await announcementAccess(other, owned)).canSend, false);

  // A member who claims to be the owner without the binding cannot send.
  const impostor = await announcementAccess({...other, isOwner: true}, owned);
  assert.equal(impostor.canSend, false);
  await assert.rejects(announcementAccess(founder, profiles('not-a-real-id')));
});

test('an announcement draft is checked before anything is counted or sent', () => {
  const good = readAnnouncementDraft(draft());
  assert.equal(good.audience.kind, 'early_members');
  assert.deepEqual(good.audience.levels, []);
  assert.deepEqual(good.audience.member_ids, []);
  assert.match(good.slug, /^founder-[a-z0-9]+-[a-f0-9]{8}$/);
  assert.equal(readAnnouncementDraft(draft({slug: LAUNCH_SLUG})).slug, LAUNCH_SLUG);
  assert.notEqual(newAnnouncementSlug(), newAnnouncementSlug());

  const levels = readAnnouncementDraft(draft({audience: {kind: 'levels', levels: ['founding_member','approved_creator']}}));
  assert.deepEqual(levels.audience.levels, ['founding_member','approved_creator']);
  const people = readAnnouncementDraft(draft({audience: {kind: 'members', member_ids: [member.id.toUpperCase(), member.id]}}));
  assert.deepEqual(people.audience.member_ids, [member.id]);

  for (const bad of [
    null, 'text', [], {},
    draft({subject: ''}), draft({subject: 'x'.repeat(101)}), draft({subject: `Badsubject`}),
    draft({body: '   '}), draft({body: 'x'.repeat(3001)}), draft({body: `Bad body`}),
    draft({audience: {kind: 'the-whole-internet'}}), draft({audience: {kind: 'levels', levels: []}}),
    draft({audience: {kind: 'levels', levels: ['founding_member','not_a_level']}}),
    draft({audience: {kind: 'members', member_ids: []}}), draft({audience: {kind: 'members', member_ids: ['nope']}}),
    draft({audience: {kind: 'members', member_ids: Array.from({length: 201}, (_, index) => `${index.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`)}}),
    draft({surfaces: {}}), draft({surfaces: {message: false, notification: false, homepage: false}}),
  ]) assert.throws(() => readAnnouncementDraft(bad), error => error.status === 400, JSON.stringify(bad));

  // Every surface the Founder can choose, including all three at once.
  for (const surfaces of [{message: true}, {notification: true}, {homepage: true}, {message: true, notification: true, homepage: true}]) {
    const chosen = readAnnouncementDraft(draft({surfaces})).surfaces;
    assert.deepEqual(chosen, {message: surfaces.message === true, notification: surfaces.notification === true, homepage: surfaces.homepage === true});
  }
});

test('the audience choices and their labels are the ones the Founder was promised', () => {
  assert.deepEqual(AUDIENCE_KINDS.map(entry => entry.value),
    ['everyone','early_members','founding_members','approved_creators','levels','members']);
  assert.deepEqual(MEMBERSHIP_LEVELS.map(entry => entry.value), ['member','early_member','founding_member','approved_creator']);
  assert(MEMBERSHIP_LEVELS.every(entry => isMembershipLevel(entry.value)));
  assert(!isMembershipLevel('vip'));
  assert.equal(announcementAudienceLabel({kind: 'everyone', levels: [], member_ids: []}), 'Everyone');
  assert.equal(announcementAudienceLabel({kind: 'early_members', levels: [], member_ids: []}), 'Early Members');
  assert.equal(announcementAudienceLabel({kind: 'founding_members', levels: [], member_ids: []}), 'Founding Members');
  assert.equal(announcementAudienceLabel({kind: 'approved_creators', levels: [], member_ids: []}), 'Approved Creators');
  assert.equal(announcementAudienceLabel({kind: 'levels', levels: ['founding_member'], member_ids: []}), 'Founding Member');
  assert.equal(announcementAudienceLabel({kind: 'members', levels: [], member_ids: [member.id]}), '1 selected member');
  assert.equal(FOUNDER_TITLE, 'Founder of ROSTER');
  assert.equal(FOUNDER_NAME, 'J.White Did It');
});

test('announcement requests are bounded and failures never leak internals', async () => {
  const url = 'https://jwhitedidit.net/api/founder/announcements/send';
  const json = (body, headers = {'Content-Type': 'application/json'}) => new Request(url, {method: 'POST', headers, body});
  assert.deepEqual(await readAnnouncementRequest(json(JSON.stringify(draft()))), draft());
  await assert.rejects(readAnnouncementRequest(json('{}', {'Content-Type': 'text/plain'})), error => error.status === 415);
  await assert.rejects(readAnnouncementRequest(json('{oops')), error => error.status === 400);
  await assert.rejects(readAnnouncementRequest(json('[1,2]')), error => error.status === 400);
  await assert.rejects(readAnnouncementRequest(json(JSON.stringify({body: 'x'.repeat(30000)}))), error => error.status === 413);

  let denied;
  try {requireAnnouncer({canSend: false, founderId: null});} catch (error) {denied = error;}
  const forbidden = announcementFailure(denied);
  assert.equal(forbidden.status, 403);
  assert.match((await forbidden.json()).error, /Only J\.White and an administrator he authorizes/);
  const broken = announcementFailure(new Error('a database detail nobody should read'));
  assert.equal(broken.status, 503);
  assert.equal((await broken.json()).error, 'ROSTER announcements could not load. Please try again in a moment.');
});

test('the announcement endpoints are wired to their own paths and methods', async () => {
  const routes = {
    'announcements-mine': ['/api/announcements/mine', 'GET'],
    'announcements-read': ['/api/announcements/read', 'POST'],
    'founder-announcements': ['/api/founder/announcements', 'GET'],
    'founder-announcement-preview': ['/api/founder/announcements/preview', 'POST'],
    'founder-announcement-send': ['/api/founder/announcements/send', 'POST'],
    'founder-membership': ['/api/founder/membership', 'POST'],
  };
  for (const [file, [path, method]] of Object.entries(routes)) {
    const {config} = await import(`../netlify/functions/${file}.mts`);
    assert.equal(config.path, path, file);
    assert.equal(config.method, method, file);
    assert(config.rateLimit.windowLimit > 0 && config.rateLimit.windowSize > 0, file);
  }
  // Every authenticated member request is a chance to deliver a waiting
  // announcement, so the next login finds it in their messages.
  for (const file of ['inbox-get','profile-me','announcements-mine']) {
    assert.match(read(`netlify/functions/${file}.mts`), /catchUpMembership|deliverPendingAnnouncements/, file);
  }
  assert.match(read('netlify/functions/_shared/member-profiles.mts'), /membershipBadgesOrNone/);
});

test('the member home page carries the announcement and only the Founder gets the send panel', () => {
  const html = read('members.html');
  assert.match(html, /id="member-announcement"[^>]*hidden/);
  assert.match(html, /id="member-announcement-open"/);
  assert.match(html, /id="member-announcement-new"/);
  // The banner sits at the top of the member home page, above the greeting.
  assert(html.indexOf('id="member-announcement"') < html.indexOf('id="member-greeting"'));
  assert.match(html, /id="founder-announcements"[^>]*data-account-panel="founder"[^>]*hidden/);
  assert.match(html, /id="founder-announcements-link"[^>]*hidden/);
  assert.match(html, /id="founder-announcement-send"[^>]*>SEND ANNOUNCEMENT</);
  for (const id of ['founder-preview-count','founder-preview-subject','founder-preview-body','founder-surface-message','founder-surface-notification','founder-surface-homepage','founder-launch-action','member-profile-membership']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(read('profile.html'), /id="public-profile-membership"/);

  const members = read('members.js');
  assert.match(members, /import \{createMemberAnnouncements\} from '\.\/member-announcements\.js'/);
  assert.match(members, /import \{createFounderAnnouncements\} from '\.\/founder-announcements\.js'/);
  // ROSTER is invite only: a confirmed email is not enough, so both loaders
  // wait on communityOpen(), which also needs the server's approval.
  assert.match(members, /announcements\.setUser\(view === 'account' && communityOpen\(\) \? currentUser : null\)/);
  assert.match(members, /founderAnnouncements\.setUser\(view === 'account' && communityOpen\(\) \? currentUser : null\)/);
  assert.match(members, /function communityOpen\(\) \{\s*return Boolean\(currentUser\?\.confirmedAt\) && access\.isApproved\(\);/);
  assert.match(members, /founder: 'founder-announcements'/);
  assert.match(members, /founder: '#founder-announcements'/);

  const client = read('member-announcements.js');
  assert.match(client, /\/api\/announcements\/mine/);
  assert.match(client, /\/api\/announcements\/read/);
  const dashboard = read('founder-announcements.js');
  for (const path of ['/api/founder/announcements', '/api/founder/announcements/preview', '/api/founder/announcements/send', '/api/founder/membership']) {
    assert(dashboard.includes(path), path);
  }
  // The panel and its link stay hidden unless the server confirms access.
  assert.match(dashboard, /if \(!access\?\.can_send\) \{\s*panel\.hidden = true;/);

  const css = read('members.css');
  for (const rule of ['.member-announcement{', '.member-membership-badge{', '.founder-announcements{']) assert(css.includes(rule), rule);
  assert(read('profile.css').includes('.member-membership-badge{'));
  assert(css.includes('[data-account-tool="founder"]>[data-account-panel="founder"]'));
});
