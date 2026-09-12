import test from 'node:test';
import assert from 'node:assert/strict';
import { config as getConfig } from '../netlify/functions/chat-get.mts';
import { config as postConfig } from '../netlify/functions/chat-post.mts';

test('chat reads allow one-second polling for members sharing an IP', () => {
  assert.equal(getConfig.path, '/api/member-chat');
  assert.equal(getConfig.method, 'GET');
  assert.deepEqual(getConfig.rateLimit, {
    windowLimit: 600,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  });
  const membersOnSharedWifi = 5;
  const oneSecondPollsPerWindow = membersOnSharedWifi * getConfig.rateLimit.windowSize;
  assert.ok(oneSecondPollsPerWindow < getConfig.rateLimit.windowLimit,
    'Shared WiFi polling must retain capacity for initial loads and refreshes');
});

test('faster chat reads preserve the separate send route and its moderation rate limit', () => {
  assert.equal(postConfig.path, '/api/member-chat/send');
  assert.equal(postConfig.method, 'POST');
  assert.notEqual(postConfig.path, getConfig.path);
  assert.deepEqual(postConfig.rateLimit, {
    windowLimit: 10,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  });
});
