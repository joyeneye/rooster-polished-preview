import test from 'node:test';
import assert from 'node:assert/strict';
import {readAccessMember} from '../netlify/functions/_shared/roster-access.mts';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerEmail = 'founder@example.com';
const confirmed = {
  id, email:ownerEmail, name:'Submitted Owner Name',
  confirmedAt:'2026-01-01T00:00:00.000Z', createdAt:'2025-01-01T00:00:00.000Z',
};

test('verified owner resolves approved without touching the unavailable access database', async () => {
  const previous = process.env.SITE_OWNER_EMAIL;
  process.env.SITE_OWNER_EMAIL = ownerEmail;
  try {
    const member = await readAccessMember(async () => confirmed);
    assert.equal(member.id, id);
    assert.equal(member.name, 'J.White Did It');
    assert.equal(member.isOwner, true);
    assert.equal(member.access.approved, true);
  } finally {
    if (previous === undefined) delete process.env.SITE_OWNER_EMAIL;
    else process.env.SITE_OWNER_EMAIL = previous;
  }
});

test('a different verified email cannot use the owner database bypass', async () => {
  const previous = process.env.SITE_OWNER_EMAIL;
  process.env.SITE_OWNER_EMAIL = ownerEmail;
  try {
    await assert.rejects(
      readAccessMember(async () => ({...confirmed, email:'somebody@example.com'})),
      /database is unavailable/i,
    );
  } finally {
    if (previous === undefined) delete process.env.SITE_OWNER_EMAIL;
    else process.env.SITE_OWNER_EMAIL = previous;
  }
});

test('an unconfirmed matching email is not accepted as the owner', async () => {
  const previous = process.env.SITE_OWNER_EMAIL;
  process.env.SITE_OWNER_EMAIL = ownerEmail;
  try {
    await assert.rejects(
      readAccessMember(async () => ({...confirmed, confirmedAt:undefined})),
      error => error?.status === 403,
    );
  } finally {
    if (previous === undefined) delete process.env.SITE_OWNER_EMAIL;
    else process.env.SITE_OWNER_EMAIL = previous;
  }
});
