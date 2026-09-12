import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../community-home.js', import.meta.url), 'utf8');
const narrationSource = source.slice(source.indexOf('const promoSpeech ='), source.indexOf('\nfunction stagePauseAll('));
const voice = (name, lang = 'en-US', extras = {}) => ({ name, lang, voiceURI: name, ...extras });

function setup(initialVoices = []) {
  let available = initialVoices;
  const listeners = new Set();
  const spoken = [];
  const synth = {
    cancelled: 0,
    getVoices: () => available,
    addEventListener: (_, handler) => listeners.add(handler),
    removeEventListener: (_, handler) => listeners.delete(handler),
    cancel() { this.cancelled++; },
    speak(line) { spoken.push(line); },
  };
  const context = {
    stage: { active: null }, state: { sound: true },
    document: { visibilityState: 'visible' },
    speechSynthesis: synth,
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    setTimeout, clearTimeout,
  };
  vm.runInNewContext(`${narrationSource}\nglobalThis.api = { selectPromoVoice, speakPromo, stopPromoNarration };`, context);
  const panel = id => {
    const button = { textContent: 'Hear Mona', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
    return { id, button, node: { dataset: { narration: 'Find your people on ROOSTER. Tune into ORBIT.' }, querySelector: () => button } };
  };
  return { ...context, synth, spoken, listeners, panel, setVoices(voices) { available = voices; for (const handler of [...listeners]) handler(); } };
}

test('prefers a natural feminine English voice over the device default', () => {
  const env = setup();
  const samantha = voice('Samantha (Enhanced)');
  const candidates = [voice('Daniel', 'en-GB', { default: true }), voice('Microsoft Guy Online (Natural)'), voice('Google US English'), samantha];
  assert.equal(env.api.selectPromoVoice(candidates), samantha);
  const jenny = voice('Microsoft Jenny Online (Natural)');
  assert.equal(env.api.selectPromoVoice([voice('Microsoft David', 'en-US', { default: true }), jenny]), jenny);
  assert.equal(env.api.selectPromoVoice([voice('Amelie', 'fr-FR')]), null);
});

test('uses conversational pacing and keeps the selected voice at its natural pitch', () => {
  const samantha = voice('Samantha (Enhanced)');
  const env = setup([samantha]);
  const panel = env.panel('hair');
  env.stage.active = panel;
  assert.equal(env.api.speakPromo(panel), true);
  assert.equal(env.spoken.length, 1);
  assert.equal(env.spoken[0].voice, samantha);
  assert.equal(env.spoken[0].pitch, 1);
  assert.equal(env.spoken[0].rate, 1.02);
  assert.equal(env.spoken[0].text, 'Find your people on Rooster. Tune into Orbit.');
  assert.equal(panel.button.textContent, 'Loading Mona…');
  env.spoken[0].onstart();
  assert.equal(panel.button.textContent, 'Stop Mona');
  env.spoken[0].onend();
  assert.equal(panel.button.textContent, 'Replay Mona');
  env.api.speakPromo(panel);
  assert.equal(env.spoken.length, 1, 'looping a promo does not repeat its narration');
  env.api.stopPromoNarration();
});

test('waits for asynchronous voices and removes the pending callback when leaving', () => {
  const env = setup();
  const panel = env.panel('barber');
  env.stage.active = panel;
  env.api.speakPromo(panel);
  assert.equal(env.spoken.length, 0);
  assert.equal(env.listeners.size, 1);
  const ava = voice('Ava (Premium)');
  env.setVoices([ava]);
  assert.equal(env.spoken[0].voice, ava);
  assert.equal(env.listeners.size, 0);
  env.api.stopPromoNarration();

  env.setVoices([]);
  env.api.speakPromo(panel);
  env.api.stopPromoNarration();
  env.stage.active = null;
  env.setVoices([ava]);
  assert.equal(env.spoken.length, 1, 'voices arriving after leaving cannot start narration');
  assert.equal(panel.button.textContent, 'Hear Mona');
  assert.equal(env.listeners.size, 0);
});

test('late callbacks from a cancelled voice cannot change the new narration', () => {
  const env = setup([voice('Google US English')]);
  const first = env.panel('hair'), next = env.panel('fashion');
  env.stage.active = first;
  env.api.speakPromo(first);
  const oldLine = env.spoken[0];
  env.stage.active = next;
  env.api.speakPromo(next);
  env.spoken[1].onstart();
  oldLine.onerror();
  oldLine.onend();
  assert.equal(env.stage.spokenId, 'fashion');
  assert.equal(next.button.textContent, 'Stop Mona');
  assert.equal(first.button.textContent, 'Hear Mona');
  env.api.stopPromoNarration();
});

test('sound off, hidden pages, and offscreen panels do not start a voice', () => {
  const env = setup([voice('Google US English')]);
  const panel = env.panel('hair');
  assert.equal(env.api.speakPromo(panel), false);
  env.stage.active = panel;
  env.state.sound = false;
  assert.equal(env.api.speakPromo(panel), false);
  env.state.sound = true;
  env.document.visibilityState = 'hidden';
  assert.equal(env.api.speakPromo(panel), false);
  assert.equal(env.spoken.length, 0);
});

test('speech failures show a retry action instead of claiming the voice is playing', () => {
  const env = setup([voice('Google US English')]);
  const panel = env.panel('hair');
  env.stage.active = panel;
  env.api.speakPromo(panel);
  env.spoken[0].onerror();
  assert.equal(panel.button.textContent, 'Tap to retry Mona');
  assert.equal(env.stage.spokenId, null);
  env.api.stopPromoNarration();
});
