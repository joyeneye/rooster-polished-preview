import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../community-home.js', import.meta.url), 'utf8');
const playbackSource = source.slice(source.indexOf('function stagePause('), source.indexOf('\nfunction paintSound('));
const flush = () => new Promise(resolve => setImmediate(resolve));

class Events {
  listeners = new Map();
  addEventListener(name, handler) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(handler);
    this.listeners.set(name, listeners);
  }
  emit(name) { for (const handler of this.listeners.get(name) || []) handler({ target: this }); }
}

class Video extends Events {
  dataset = {};
  paused = true;
  _muted = true;
  playCount = 0;
  pauseCount = 0;
  get muted() { return this._muted; }
  set muted(value) {
    if (this._muted === value) return;
    this._muted = value;
    queueMicrotask(() => this.emit('volumechange'));
  }
  play() {
    this.playCount += 1;
    if (this.paused) {
      this.paused = false;
      queueMicrotask(() => this.emit('play'));
    }
    return Promise.resolve();
  }
  pause() {
    this.pauseCount += 1;
    if (!this.paused) {
      this.paused = true;
      queueMicrotask(() => this.emit('pause'));
    }
  }
}

function node(id, { promo = false, video = true } = {}) {
  const classes = new Set();
  const media = video ? new Video() : null;
  const play = video ? Object.assign(new Events(), { hidden: true }) : null;
  return {
    dataset: { postId: id }, media, play,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    hasAttribute: name => name === 'data-silent-promo' && promo,
    querySelector: selector => selector === 'video' ? media : selector === '.roster-clip-play' ? play : null,
  };
}

function setup(nodes, { sound = false, motion = true, visible = true, view = 'for_you' } = {}) {
  const stage = { panels: [], active: null, observer: null, paused: new Set(), autoPauses: new WeakSet(), resumeId: null, motion };
  const claims = [];
  const context = {
    stage,
    state: { view, sound, cursor: null, loading: false },
    document: { visibilityState: visible ? 'visible' : 'hidden' },
    window: { RosterMediaBus: { claim: video => claims.push(video) } },
    stageColumn: { querySelectorAll: () => nodes },
    paintStageControls() {}, paintSound() {}, loadStage() {},
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() {}
    },
  };
  vm.runInNewContext(`${playbackSource}\nglobalThis.playback = { stageWatch, stageActivate, stagePause, stagePauseAll };`, context);
  context.playback.stageWatch();
  return { ...context, claims, api: context.playback };
}

test('pausing an offscreen video does not become a user pause; manual pause does', async () => {
  const first = node('member-1');
  const env = setup([first]);
  env.api.stageActivate(env.stage.panels[0]);
  await flush();
  env.api.stagePause(first.media);
  await flush();
  assert.equal(env.stage.paused.has('member-1'), false);
  assert.equal(env.stage.autoPauses.has(first.media), false);
  await first.media.play();
  first.media.pause();
  await flush();
  assert.equal(env.stage.paused.has('member-1'), true);
});

test('a member-paused video remains paused when returning to its Slot', async () => {
  const first = node('member-1'), second = node('member-2');
  const env = setup([first, second]);
  env.api.stageActivate(env.stage.panels[0]);
  await flush();
  first.media.pause();
  await flush();
  env.api.stageActivate(env.stage.panels[1]);
  await flush();
  env.api.stageActivate(env.stage.panels[0]);
  await flush();
  assert.equal(first.media.playCount, 1);
  assert.equal(first.media.paused, true);
  assert.equal(first.play.hidden, false);
  assert.equal(second.media.paused, true);
});

test('original promos stay silent even when member video sound is enabled', async () => {
  const promo = node('promo-radio', { promo: true });
  const env = setup([promo], { sound: true });
  env.api.stageActivate(env.stage.panels[0]);
  await flush();
  assert.equal(promo.media.muted, true);
  assert.equal(promo.media.playCount, 1);
  assert.equal(env.claims.length, 0);
  promo.media.muted = false;
  await flush();
  assert.equal(promo.media.muted, true);
  assert.equal(env.claims.length, 0);
});

test('member sound uses the shared media bus when the member has enabled it', async () => {
  const member = node('member-1');
  const env = setup([member], { sound: true });
  env.api.stageActivate(env.stage.panels[0]);
  await flush();
  assert.equal(member.media.muted, false);
  assert.equal(env.claims.length, 1);
  assert.equal(env.claims[0], member.media);
});

test('hidden pages, Board, and paused motion never autoplay videos', async () => {
  for (const options of [{ visible: false }, { view: 'board' }, { motion: false }]) {
    const promo = node('promo-create', { promo: true });
    const env = setup([promo], options);
    env.api.stageActivate(env.stage.panels[0]);
    await flush();
    assert.equal(promo.media.playCount, 0, JSON.stringify(options));
    assert.equal(promo.media.paused, true);
  }
});

test('leaving the stage stops all motion without forgetting which Slot should resume', async () => {
  const first = node('member-1'), promo = node('promo-book', { promo: true });
  const env = setup([first, promo]);
  env.api.stageActivate(env.stage.panels[1]);
  await flush();
  env.api.stagePauseAll();
  await flush();
  assert.equal(env.stage.active, null);
  assert.equal(env.stage.resumeId, 'promo-book');
  assert.equal(promo.media.paused, true);
  assert.equal(promo.classList.contains('is-stage-active'), false);
  assert.equal(env.stage.paused.has('promo-book'), false);
});

test('a headline can be the active Slot without triggering video playback', async () => {
  const member = node('member-1'), headline = node('news-1', { video: false });
  const env = setup([member, headline]);
  env.api.stageActivate(env.stage.panels[0]);
  await flush();
  env.api.stageActivate(env.stage.panels[1]);
  await flush();
  assert.equal(member.media.paused, true);
  assert.equal(env.stage.active.node, headline);
  assert.equal(headline.classList.contains('is-stage-active'), true);
});
