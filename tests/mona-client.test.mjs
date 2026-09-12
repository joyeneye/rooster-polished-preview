import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import * as model from '../mona-model.mjs';

const source = fs.readFileSync(new URL('../mona.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function createMonaWorkspace','function createMonaWorkspace').replace("if (typeof document !== 'undefined') createMonaWorkspace();",'this.client = createMonaWorkspace({document,window,fetch});');
const memberId = 'f099f8c6-12fe-4159-bab8-ee5de849349d', otherId = '98ce8da4-4112-4c99-b1a2-d4aaf6027b14';
const prefs = {profession:'Hair creator',location:'Atlanta, Georgia',offering:'Hair tutorials and product videos',goal:'brand-deals'};
const lead = {id:'abc123',title:'Summer creator program',organization:'Creative Beauty',type:'creator-program',location:'United States',summary:'Accepting creator applications.',whyItFits:'Your hair tutorials may fit the brief.',nextStep:'Read the application requirements.',sourceUrl:'https://brand.beauty/creators',sourceTitle:'Brand creator program',deadline:null,compensation:'Not stated',checkedAt:'2026-09-11T14:00:00.000Z'};
const paymentPrefs = {payoutFrequency:null,weeklyPayoutDay:'monday',taxReservePercent:null,taxReminder:'off'};
const workspace = (leads = [], extras = {}) => ({memberId,revision:1,preferences:prefs,leads,paymentPreferences:{...paymentPrefs},taxReviewedAt:null,updatedAt:'2026-09-11T14:00:00.000Z',...extras});
const savedLead = {...lead,status:'saved',notes:'Remember a portfolio link.',savedAt:lead.checkedAt,updatedAt:lead.checkedAt};
const summary = {memberId,businesses:[{id:4,name:'Hair Studio',slug:'hair-studio',published:true,bookingUrl:'/book/hair-studio',servicesCount:2}],upcoming:[],upcomingCount:0,pendingCount:0,recordedPayments:[{currency:'USD',amountCents:12000}],bookedValue:[{currency:'USD',amountCents:8000}],period:{from:'2026-09-11T00:00:00Z',to:'2026-10-11T00:00:00Z'},paymentPeriod:{from:'2026-09-01T00:00:00Z',to:'2026-10-01T00:00:00Z'}};
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for(let i = 0; i < 8; i++) await tick(); };

function environment({initial = workspace(), profile = {id:memberId,name:'Alysa',profession:'beauty_products',location:'Atlanta'}, booking = summary, handler} = {}) {
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ''; this._text = ''; this.parentNode = null; this.className = ''; }
    set textContent(text) { this._text = String(text); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    get firstChild() { return this.children[0]; }
    append(...nodes) { for(const node of nodes) { node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); }
    remove() { if(this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
    setAttribute(name,value) { this.attributes[name] = String(value); }
    addEventListener(name,fn) { (this.listeners[name] ||= []).push(fn); }
    removeEventListener(name,fn) { this.listeners[name] = (this.listeners[name] || []).filter(value => value !== fn); }
    async fire(name,event = {}) { await Promise.all((this.listeners[name] || []).map(fn => fn({preventDefault(){},target:this,currentTarget:this,...event}))); await settle(); }
    all() { return this.children.flatMap(node => [node,...node.all()]); }
    querySelectorAll(selector) {
      return this.all().filter(node => {
        if(selector === '[data-mona-tab]') return Boolean(node.dataset.monaTab);
        if(selector === '[data-mona-panel]') return Boolean(node.dataset.monaPanel);
        if(selector === 'input,textarea,select,button:not([data-mona-tab])') return ['INPUT','TEXTAREA','SELECT'].includes(node.tagName) || node.tagName === 'BUTTON' && !node.dataset.monaTab;
        if(selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
        return node.tagName === selector.toUpperCase();
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    reset() { for(const node of this.all()) if(['INPUT','TEXTAREA','SELECT'].includes(node.tagName)) node.value = ''; }
    reportValidity() { return true; }
  }
  const elements = {}, root = new Element('main');
  const add = (id,tag,parent = root) => { const node = new Element(tag); node.id = id; elements[id] = node; parent.append(node); return node; };
  elements['mona-root'] = root;
  add('mona-gate','div'); const app = add('mona-app','section'); app.hidden = true;
  for(const name of ['find','leads','bookings']) { const tab = add(`tab-${name}`,'button',app); tab.dataset.monaTab = name; const panel = add(`mona-${name}`,'section',app); panel.dataset.monaPanel = name; }
  add('mona-notice','div',app); add('mona-lead-count','span',app);
  const form = add('mona-find-form','form',elements['mona-find']);
  for(const field of ['profession','location','offering','goal']) add(`mona-${field}`,field === 'offering' ? 'textarea' : field === 'goal' ? 'select' : 'input',form);
  add('mona-find-button','button',form); add('mona-search-status','div',elements['mona-find']); add('mona-results','div',elements['mona-find']);
  add('mona-lead-filter','select',elements['mona-leads']).value = 'active'; add('mona-saved','div',elements['mona-leads']);
  add('mona-booking-status','div',elements['mona-bookings']); add('mona-booking-content','div',elements['mona-bookings']);
  const document = {getElementById:id => elements[id],createElement:tag => new Element(tag),createTextNode:text => { const node = new Element('text'); node.textContent = text; return node; }};
  const window = new Element('window'); window.location = {origin:'https://jwhitedidit.net'}; const copied = [];
  window.navigator = {clipboard:{writeText:async text => copied.push(text)}};
  window.RoosterProfileProfession = {describe:() => ({label:'Influencer · Hair Specialist'})};
  const calls = [];
  const fetch = async (path,options) => {
    calls.push({path,options,body:options.body ? JSON.parse(options.body) : null});
    let answer = await handler?.(path,options,calls);
    if(answer === undefined) answer = path === '/api/mona/workspace' ? [initial,200] : path === '/api/profile/me' ? [{profile},200] : path === '/api/mona/bookings' ? [booking,200] : [{error:'Unexpected request'},500];
    const [data,status = 200] = answer;
    return {ok:status >= 200 && status < 300,status,json:async () => data};
  };
  const context = vm.createContext({document,window,fetch,...model,URL,AbortController,setTimeout,clearTimeout}); vm.runInContext(source,context);
  const nodes = () => [root,...root.all()];
  const byText = text => nodes().find(node => node.tagName === 'BUTTON' && node.textContent === text);
  return {client:context.client,elements,root,window,calls,copied,nodes,byText};
}

test('Mona never searches automatically and separates real payments from future booked value',async () => {
  const e = environment(); await e.client.ready;
  assert.deepEqual(e.calls.map(call => call.path),['/api/mona/workspace','/api/profile/me','/api/mona/bookings']);
  assert.equal(e.elements['mona-app'].hidden,false);
  assert.match(e.elements['mona-booking-content'].textContent,/Recorded payments\$120\.00/);
  assert.match(e.elements['mona-booking-content'].textContent,/Booked value\$80\.00/);
  assert.match(e.elements['mona-booking-content'].textContent,/Not received income/);
  assert.equal(e.elements['mona-offering'].value,prefs.offering);
  assert.equal(e.copied.length,0);
});

test('an explicit search saves preferences first, displays sourced cards and saves only the shown source identity',async () => {
  const e = environment({handler(path,options) {
    if(path === '/api/mona/scout') return [{memberId,status:'ready',summary:'Possible opportunities.',leads:[lead]},200];
    if(path === '/api/mona/workspace' && options.method === 'POST') { const data = JSON.parse(options.body); return [workspace(data.action === 'save' ? [savedLead] : [],{revision:data.revision+1}),200]; }
  }}); await e.client.ready;
  await e.elements['mona-find-form'].fire('submit');
  assert.deepEqual(e.calls.filter(call => call.options.method === 'POST').map(call => call.path),['/api/mona/workspace','/api/mona/scout']);
  assert.match(e.elements['mona-results'].textContent,/Summer creator program/);
  await e.byText('Save lead').fire('click');
  const save = e.calls.find(call => call.body?.action === 'save');
  assert.deepEqual(save.body,{action:'save',leadId:lead.id,checkedAt:lead.checkedAt,revision:2});
  assert.match(e.elements['mona-saved'].textContent,/Summer creator program/);
  assert.equal(e.elements['mona-lead-count'].textContent,'1');
});

test('private content clears on session changes and late search results cannot restore it',async () => {
  let release, loggedOut = false;
  const e = environment({initial:workspace([savedLead]),handler(path,options) {
    if(loggedOut) return [{error:'Log in'},401];
    if(path === '/api/mona/workspace' && options.method === 'POST') return [workspace([savedLead],{revision:2}),200];
    if(path === '/api/mona/scout') return new Promise(resolve => { release = resolve; });
  }}); await e.client.ready;
  const pending = e.elements['mona-find-form'].fire('submit'); await settle();
  assert.ok(release);
  loggedOut = true; await e.window.fire('jwhite:session-changed');
  release([{memberId,status:'ready',leads:[lead]},200]); await pending;
  assert.equal(e.elements['mona-app'].hidden,true);
  assert.equal(e.elements['mona-saved'].textContent,'');
  assert.equal(e.elements['mona-results'].textContent,'');
  assert.equal(e.elements['mona-offering'].value,'');
  const login = e.nodes().find(node => node.tagName === 'A' && node.textContent === 'Log in to Mona');
  assert.equal(login.href,'/members?next=%2Fmona');
});

test('a different account in a private response clears all member data',async () => {
  const e = environment({initial:workspace([savedLead]),booking:{...summary,memberId:otherId}}); await e.client.ready;
  assert.equal(e.elements['mona-app'].hidden,true);
  assert.equal(e.elements['mona-saved'].textContent,'');
  assert.match(e.elements['mona-gate'].textContent,/session changed/);
});

test('conflicted updates require an explicit refresh instead of overwriting another tab',async () => {
  let postCount = 0;
  const e = environment({initial:workspace([savedLead]),handler(path,options) {
    if(path === '/api/mona/workspace' && options.method === 'POST') { postCount++; return [{error:'Changed in another tab'},409]; }
  }}); await e.client.ready;
  await e.byText('Save update').fire('click');
  await e.byText('Save update').fire('click');
  assert.equal(postCount,1);
  assert.ok(e.byText('Refresh my leads'));
  assert.match(e.elements['mona-saved'].textContent,/Summer creator program/);
  await e.byText('Refresh my leads').fire('click');
  await e.byText('Save update').fire('click');
  assert.equal(postCount,2);
});

test('unavailable search preserves saved leads and never presents an empty calendar as zero earnings',async () => {
  const e = environment({initial:workspace([savedLead]),handler(path,options) {
    if(path === '/api/mona/bookings') return [{error:'Bookings are unavailable.'},503];
    if(path === '/api/mona/scout') return [{status:'unavailable',error:'Live search is not connected.'},503];
    if(path === '/api/mona/workspace' && options.method === 'POST') return [workspace([savedLead],{revision:2}),200];
  }}); await e.client.ready;
  await e.elements['mona-find-form'].fire('submit');
  assert.match(e.elements['mona-search-status'].textContent,/not connected/);
  assert.match(e.elements['mona-saved'].textContent,/Summer creator program/);
  assert.equal(e.elements['mona-booking-content'].textContent,'');
  assert.match(e.elements['mona-booking-status'].textContent,/unavailable/);
  assert.ok(e.byText('Retry bookings'));
});

test('reply preparation stays local, preserves editing and only adds a published own booking link by choice',async () => {
  const e = environment({initial:workspace([savedLead])}); await e.client.ready;
  const count = e.calls.length;
  await e.byText('Prepare a reply').fire('click');
  const draft = e.nodes().find(node => node.id === `mona-draft-${lead.id}`);
  assert.match(draft.value,/Here’s what I offer/);
  assert.doesNotMatch(draft.value,/\/book\//);
  draft.value = 'My personal reply.';
  const select = e.nodes().find(node => node.attributes['aria-label'] === 'Choose a booking page to add');
  select.value = 'https://jwhitedidit.net/book/hair-studio'; await select.fire('change');
  assert.match(draft.value,/^My personal reply\./);
  assert.match(draft.value,/\/book\/hair-studio/);
  await e.byText('Copy reply').fire('click');
  assert.equal(e.copied[0],draft.value);
  assert.equal(e.calls.length,count,'drafting and copying never contact a prospect or AI service');
});

test('untrusted titles remain text and malicious source links are never opened',async () => {
  const malicious = {...savedLead,title:'<img src=x onerror=alert(1)>',sourceUrl:'javascript:alert(1)'};
  const e = environment({initial:workspace([malicious])}); await e.client.ready;
  assert.match(e.elements['mona-saved'].textContent,/<img src=x onerror=alert\(1\)>/);
  assert.equal(e.nodes().filter(node => node.tagName === 'IMG').length,0);
  assert.equal(e.nodes().filter(node => node.href?.startsWith('javascript:')).length,0);
});

test('money and source helpers reject false or unsafe displays while keeping currencies separate',() => {
  for(const value of ['javascript:alert(1)','http://brand.beauty','https://user:pass@brand.beauty','https://127.0.0.1','https://intranet.local']) assert.equal(model.sourceURL(value),null);
  assert.equal(model.bookingURL('//other.site/book/test','https://jwhitedidit.net'),null);
  assert.equal(model.bookingURL('/book/studio?secret=1','https://jwhitedidit.net'),null);
  assert.equal(model.money(NaN),'Unavailable');
  assert.equal(model.moneyGroups(undefined),'Unavailable');
  assert.equal(model.moneyGroups([]),'None recorded');
  assert.match(model.moneyGroups([{currency:'USD',amountCents:1000},{currency:'EUR',amountCents:1000}]),/10\.00.*10\.00/);
  assert.equal(model.matchingLeads([savedLead,{...savedLead,status:'archived'}],'active').length,1);
});

test('payment beta only saves chosen preferences, preserves the open panel and uses actual fee configuration',async () => {
  const e = environment({booking:{...summary,businesses:summary.businesses.map(value => ({...value,paymentStatus:'setup_pending'})),paymentInfo:{feeConfigured:true,feeBasisPoints:75,feeAppliesTo:'connected_booking_charge'}},handler(path,options) {
    if(path === '/api/mona/workspace' && options.method === 'POST') { const body = JSON.parse(options.body); return [workspace([],{revision:body.revision+1,paymentPreferences:body.paymentPreferences}),200]; }
  }}); await e.client.ready;
  const node = id => e.nodes().find(value => value.id === id);
  const panel = e.nodes().find(value => value.className === 'mona-payment-beta'); panel.open = true;
  assert.match(panel.textContent,/0\.75% of connected booking charges/);
  assert.match(panel.textContent,/setup is pending/);
  assert.equal(node('mona-payout-frequency').value,'');
  assert.equal(node('mona-tax-reserve').value,'');
  node('mona-payout-frequency').value = 'weekly'; await node('mona-payout-frequency').fire('change');
  assert.equal(node('mona-payout-day').parentNode.hidden,false);
  node('mona-payout-day').value = 'friday'; node('mona-tax-reserve').value = '18.25'; node('mona-tax-reminder').value = 'monthly';
  await node('mona-tax-reserve').fire('input');
  assert.match(e.elements['mona-booking-content'].textContent,/\$21\.90 at 18\.25%/);
  assert.equal(e.calls.filter(call => call.options.method === 'POST').length,0,'local estimates never transfer funds');
  await e.byText('Save preferences').parentNode.parentNode.fire('submit');
  const posts = e.calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length,1); assert.equal(posts[0].path,'/api/mona/workspace');
  assert.deepEqual(posts[0].body,{action:'payment-preferences',revision:1,paymentPreferences:{payoutFrequency:'weekly',weeklyPayoutDay:'friday',taxReservePercent:18.25,taxReminder:'monthly'}});
  assert.equal(e.nodes().find(value => value.className === 'mona-payment-beta').open,true);
  assert.match(e.elements['mona-notice'].textContent,/no transfers were changed/);
  assert.match(e.elements['mona-booking-content'].textContent,/Review your records to start monthly check-ins/);
});

test('payment estimates keep currencies separate and do not turn missing records into earnings',async () => {
  const e = environment({initial:workspace([],{paymentPreferences:{...paymentPrefs,taxReservePercent:20}}),booking:{...summary,recordedPayments:[{currency:'USD',amountCents:12345},{currency:'EUR',amountCents:9876}],paymentInfo:{feeConfigured:false,feeBasisPoints:0}}}); await e.client.ready;
  const estimate = e.nodes().find(node => node.className === 'mona-reserve-estimate mona-wide');
  assert.match(estimate.textContent,/\$24\.69/); assert.match(estimate.textContent,/19\.75/);
  assert.match(estimate.textContent,/not money set aside or your tax bill/);
  assert.match(e.elements['mona-booking-content'].textContent,/No ROOSTER platform fee is configured/);
  assert.equal(model.reserveEstimate(undefined,20),null);
  assert.equal(model.reserveEstimate([{currency:'USD',amountCents:-1}],20),null);
  assert.equal(model.reserveEstimate([{currency:'USD',amountCents:NaN}],20),null);
  assert.equal(model.reserveEstimate([{currency:'USD',amountCents:200}],101),null);
  assert.deepEqual(model.reserveEstimate([{currency:'USD',amountCents:200}],0),[{currency:'USD',amountCents:0}]);
  assert.deepEqual(model.reserveEstimate([],20),[]);
  assert.match(model.platformFeeLabel({feeConfigured:true,feeBasisPoints:75,feeAppliesTo:'all_income'}),/unavailable/);
});

test('record reviews persist a server date, with no claim that taxes were filed or paid',async () => {
  const reviewed = '2026-09-11T20:00:00.000Z';
  const e = environment({initial:workspace([],{paymentPreferences:{...paymentPrefs,taxReminder:'quarterly'}}),handler(path,options) {
    if(path === '/api/mona/workspace' && options.method === 'POST') return [workspace([],{revision:2,paymentPreferences:{...paymentPrefs,taxReminder:'quarterly'},taxReviewedAt:reviewed}),200];
  }}); await e.client.ready;
  await e.byText('I reviewed my records').fire('click');
  const post = e.calls.find(call => call.options.method === 'POST');
  assert.deepEqual(post.body,{action:'tax-review',revision:1},'the browser cannot write a review timestamp');
  assert.match(e.elements['mona-booking-content'].textContent,/last marked your records reviewed/);
  assert.match(e.elements['mona-notice'].textContent,/does not confirm a tax filing or payment/);
  const taxLink = e.nodes().find(node => node.tagName === 'A' && node.textContent === 'U.S. estimated tax guidance ↗');
  assert.equal(taxLink.href,'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes');
});

test('records check-ins use calendar months, clamp month ends and are never postponed by lead updates',() => {
  const settings = {paymentPreferences:{...paymentPrefs,taxReminder:'monthly'},taxReviewedAt:'2026-01-31T22:00:00Z',updatedAt:'2026-09-11T12:00:00Z'};
  assert.deepEqual(model.taxCheckIn(settings,new Date('2026-02-27T12:00:00Z')),{nextReviewAt:'2026-02-28T00:00:00.000Z',due:false});
  assert.equal(model.taxCheckIn(settings,new Date('2026-03-01T12:00:00Z')).due,true);
  assert.equal(model.taxCheckIn({...settings,taxReviewedAt:'2028-01-31T22:00:00Z'},new Date('2028-02-01T12:00:00Z')).nextReviewAt,'2028-02-29T00:00:00.000Z');
  assert.equal(model.taxCheckIn({...settings,paymentPreferences:{...paymentPrefs,taxReminder:'quarterly'}},new Date('2026-02-01T12:00:00Z')).nextReviewAt,'2026-04-30T00:00:00.000Z');
  assert.deepEqual(model.taxCheckIn({...settings,taxReviewedAt:null},new Date('2026-09-12T12:00:00Z')),{nextReviewAt:null,due:true,firstReview:true});
  assert.equal(model.taxCheckIn({...settings,paymentPreferences:paymentPrefs}),null);
});

test('private payment controls clear on logout and a late preference response cannot bring them back',async () => {
  let release, loggedOut = false;
  const e = environment({handler(path,options) {
    if(loggedOut) return [{error:'Log in'},401];
    if(path === '/api/mona/workspace' && options.method === 'POST') return new Promise(resolve => { release = resolve; });
  }}); await e.client.ready;
  const settings = e.byText('Save preferences').parentNode.parentNode;
  const pending = settings.fire('submit'); await settle(); assert.ok(release);
  loggedOut = true; await e.window.fire('jwhite:session-changed');
  release([workspace([],{revision:2,paymentPreferences:{...paymentPrefs,payoutFrequency:'daily'}}),200]); await pending;
  assert.equal(e.elements['mona-app'].hidden,true);
  assert.equal(e.elements['mona-booking-content'].textContent,'');
  assert.equal(e.byText('Save preferences'),undefined);
});
