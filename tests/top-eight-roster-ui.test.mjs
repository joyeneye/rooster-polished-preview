import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../top-eight-roster.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const people = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Alysa Jordan', photo_url: '/alysa.jpg' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Crisp by J. Malone', photo_url: '/barber.jpg' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Reallyfe Jeffn', photo_url: '/jeffn.jpg' },
];

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this._value = undefined;
    this.classList = {
      add: name => { this.className = [...new Set([...this.className.split(' '), name])].filter(Boolean).join(' '); },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, on) => { if (on ?? !this.classList.contains(name)) this.classList.add(name); else this.classList.remove(name); },
    };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') return this.children.find(child => child.selected)?.value ?? this.children[0]?.value ?? '';
    return '';
  }
  set value(value) { this._value = String(value); }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(value) {
    if (value !== '') throw new Error('This harness expects safe DOM construction, not HTML parsing.');
    this.replaceChildren();
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(child) {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(typeof child === 'string' ? Object.assign(new Element('text'), { textContent: child }) : child)); }
  prepend(...children) {
    children.forEach(child => child.remove());
    children.forEach(child => { child.parentNode = this; });
    this.children.unshift(...children);
  }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this._text = '';
    this.append(...children);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) {
      const value = attribute[1].startsWith('data-') ? this.dataset[attribute[1].slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] : this.getAttribute(attribute[1]);
      return value !== undefined && value !== null && (attribute[2] === undefined || value === attribute[2]);
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback]);
  }
  dispatch(type) {
    if (type === 'click' && this.disabled) return;
    const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  click() { this.dispatch('click'); }
  focus() {}
}

async function mount({ members = people.slice(0, 2), available = people, editable = true, mode = 'community', saveError = null } = {}) {
  const host = new Element('section');
  host.dataset = { topEightRoster: '', target: 'self', editable: String(editable) };
  const element = (name, tag = 'div') => {
    const node = new Element(tag);
    node.setAttribute(`data-top-eight-${name}`, '');
    return node;
  };
  const list = element('list'), status = element('status', 'p'), edit = element('edit', 'button');
  const actions = element('actions'), save = element('save', 'button'), cancel = element('cancel', 'button');
  list.append(status);
  actions.append(cancel, save);
  host.append(edit, list, actions);
  const document = {
    readyState: 'complete',
    createElement: tag => new Element(tag),
    querySelectorAll: selector => selector === '[data-top-eight-roster]' ? [host] : [],
    addEventListener() {},
  };
  const writes = [];
  const fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      writes.push({ url, options, body });
      if (saveError) return { ok: false, json: async () => ({ error: saveError }) };
      const savedMembers = body.order.map(id => available.find(person => person.id === id)).filter(Boolean);
      return { ok: true, json: async () => ({ members: savedMembers, available_members: available, editable, mode: 'custom', target_id: 'self' }) };
    }
    return { ok: true, json: async () => ({ members, available_members: available, editable, mode, target_id: 'self' }) };
  };
  vm.runInNewContext(script, { document, location: { search: '' }, URLSearchParams, fetch, console, setTimeout, clearTimeout });
  await flush();
  return { host, list, status, edit, actions, save, cancel, writes };
}

test('Top 8 renders real member names and clickable profile links without global UUID helpers', async () => {
  const ui = await mount();
  const links = ui.list.querySelectorAll('a');
  assert.equal(links.length, 2);
  assert.deepEqual(links.map(link => link.href), people.slice(0, 2).map(person => `/profile.html?id=${person.id}`));
  assert.deepEqual(links.map(link => link.querySelector('strong').textContent), people.slice(0, 2).map(person => person.name));
  assert.equal(ui.edit.hidden, false);
});

test('editing shows eight simple person selectors populated with actual available members', async () => {
  const ui = await mount();
  ui.edit.click();
  const selectors = ui.list.querySelectorAll('select');
  assert.equal(selectors.length, 8);
  assert.deepEqual(selectors.map(select => select.getAttribute('aria-label')), Array.from({ length: 8 }, (_, i) => `Person for Top 8 spot ${i + 1}`));
  assert.equal(selectors[0].value, people[0].id);
  assert.equal(selectors[1].value, people[1].id);
  assert.equal(selectors[7].value, '');
  assert.ok(selectors[7].options.some(option => option.value === people[2].id && option.textContent.includes(people[2].name)));
  assert.equal(ui.actions.hidden, false);
});

test('Clear Top 8 saves an explicit empty custom selection and keeps the empty status visible', async () => {
  const ui = await mount();
  ui.edit.click();
  const clear = ui.host.querySelector('[data-top-eight-clear]');
  assert.ok(clear);
  clear.click();
  assert.ok(ui.list.querySelectorAll('select').every(select => select.value === ''));
  ui.save.click();
  await flush();
  assert.equal(ui.writes.length, 1);
  assert.deepEqual(ui.writes[0].body.order, []);
  assert.equal(ui.writes[0].options.credentials, 'same-origin');
  assert.equal(ui.list.querySelectorAll('a').length, 0);
  assert.ok(ui.host.querySelector('[data-top-eight-status]'));
  assert.ok(ui.status.textContent.length > 0);
});

test('Cancel discards changed people and restores the original Top 8 without saving', async () => {
  const ui = await mount();
  ui.edit.click();
  const select = ui.list.querySelectorAll('select')[0];
  select.value = people[2].id;
  select.dispatch('change');
  ui.cancel.click();
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(ui.list.querySelectorAll('a').map(link => link.href), people.slice(0, 2).map(person => `/profile.html?id=${person.id}`));
  assert.equal(ui.list.querySelectorAll('select').length, 0);
  assert.equal(ui.actions.hidden, true);
});

test('a viewer cannot open another member’s Top 8 editor', async () => {
  const ui = await mount({ editable: false });
  assert.equal(ui.edit.hidden, true);
  ui.edit.click();
  assert.equal(ui.list.querySelectorAll('select').length, 0);
  assert.equal(ui.writes.length, 0);
});

test('choosing new people saves their exact order once and renders the saved members', async () => {
  const ui = await mount();
  ui.edit.click();
  const first = ui.list.querySelectorAll('select')[0];
  first.value = people[2].id;
  first.dispatch('change');
  ui.save.click();
  ui.save.click();
  await flush();
  assert.equal(ui.writes.length, 1);
  assert.deepEqual(ui.writes[0].body.order, [people[2].id, people[1].id]);
  assert.deepEqual(ui.list.querySelectorAll('a').map(link => link.href), [people[2], people[1]].map(person => `/profile.html?id=${person.id}`));
  assert.equal(ui.actions.hidden, true);
});

test('failed saves keep the member’s selected people editable and show the actual error', async () => {
  const ui = await mount({ saveError: 'Please try again. Your connection was interrupted.' });
  ui.edit.click();
  const first = ui.list.querySelectorAll('select')[0];
  first.value = people[2].id;
  first.dispatch('change');
  ui.save.click();
  await flush();
  assert.equal(ui.actions.hidden, false);
  assert.equal(ui.save.disabled, false);
  assert.equal(ui.cancel.disabled, false);
  assert.equal(ui.list.querySelectorAll('select')[0].value, people[2].id);
  assert.ok(ui.list.querySelectorAll('select').every(select => !select.disabled));
  assert.equal(ui.status.textContent, 'Please try again. Your connection was interrupted.');
});
