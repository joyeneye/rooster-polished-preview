import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {manageMonaWorkspace} from '../netlify/functions/_shared/mona-workspace.mts';
import {MemberError} from '../netlify/functions/_shared/member-auth.mts';
import {defaultPaymentPreferences} from '../netlify/functions/_shared/mona-payment-beta.mts';

const ID='11111111-1111-4111-8111-111111111111', OTHER='22222222-2222-4222-8222-222222222222';
const now=new Date('2026-09-11T16:00:00.000Z');
const preferences={profession:'Hair specialist',location:'Dallas',offering:'Product demonstrations and hair tutorials',goal:'brand-deals'};
function lead(overrides={}) {
  const sourceUrl='https://www.rooster-fixture-source.com/creator-program';
  return {id:createHash('sha256').update(sourceUrl).digest('hex').slice(0,24),title:'Creator call',organization:'Fixture organization',type:'creator-program',location:'United States',summary:'Applications for demonstrations.',whyItFits:'May fit product tutorials.',nextStep:'Review the application at the source.',sourceUrl,sourceTitle:'Creator program',deadline:null,compensation:'Not stated',checkedAt:now.toISOString(),sourceUpdatedAt:null,...overrides};
}
function memory() {
  const data=new Map(), reads=[], writes=[];
  let seq=0, conflict=false;
  return {data,reads,writes,conflict(){conflict=true;},
    async get(key){reads.push(key);return structuredClone(data.get(key)?.data??null);},
    async getWithMetadata(key){reads.push(key);return structuredClone(data.get(key)??null);},
    async setJSON(key,value,options={}){writes.push({key,value:structuredClone(value),options});const old=data.get(key);if(conflict||options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return{modified:false};data.set(key,{data:structuredClone(value),etag:String(++seq)});return{modified:true};},
    seed(key,value){data.set(key,{data:structuredClone(value),etag:String(++seq)});},
  };
}
const req=(body,headers={})=>new Request('https://jwhitedidit.net/api/mona/workspace',body===undefined?{}:{method:'POST',headers:{origin:'https://jwhitedidit.net','content-type':'application/json',...headers},body:JSON.stringify(body)});
const deps=(id=ID)=>({resolveMember:async()=>({id,name:'Test member'}),now:()=>now});
const run=(store,body,id=ID)=>manageMonaWorkspace(req(body),store,deps(id));
function cache(store,item=lead(),id=ID){store.seed(`scouts/${id}`,{checkedAt:item.checkedAt,leads:[item]});return item;}

test('new workspace stays private, scoped to verified member and does not write on GET',async()=>{
  const store=memory(),response=await run(store);
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(await response.json(),{memberId:ID,revision:0,preferences:{profession:'',location:'',offering:'',goal:'clients'},leads:[],paymentPreferences:defaultPaymentPreferences(),taxReviewedAt:null,updatedAt:null});
  assert.deepEqual(store.reads,[`workspaces/${ID}`]);assert.equal(store.writes.length,0);
});
test('unapproved and signed-out requests fail before reading any private store',async()=>{
  for(const status of [401,403]){const store=memory();const response=await manageMonaWorkspace(req(),store,{resolveMember:async()=>{throw new MemberError(status,'Access required');}});assert.equal(response.status,status);assert.equal(store.reads.length,0);}
});
test('cross-site mutations cannot save anything',async()=>{
  const store=memory(),response=await manageMonaWorkspace(req({action:'preferences',revision:0,preferences},{origin:'https://evil.com'}),store,deps());
  assert.equal(response.status,403);assert.equal(store.reads.length,0);assert.equal(store.writes.length,0);
});
test('preferences and revisions persist with atomic preconditions',async()=>{
  const store=memory();let response=await run(store,{action:'preferences',revision:0,preferences});assert.equal(response.status,200);
  assert.equal((await response.json()).revision,1);assert.deepEqual(store.writes[0].options,{onlyIfNew:true});
  response=await run(store,{action:'preferences',revision:1,preferences:{...preferences,location:'Austin'}});assert.equal(response.status,200);
  assert.equal((await response.json()).preferences.location,'Austin');assert.ok(store.writes[1].options.onlyIfMatch);
  response=await run(store,{action:'preferences',revision:1,preferences});assert.equal(response.status,409);assert.equal(store.writes.length,2);
});
test('simultaneous initial creation loses cleanly instead of overwriting',async()=>{
  const store=memory();store.conflict();const response=await run(store,{action:'preferences',revision:0,preferences});assert.equal(response.status,409);assert.equal(store.data.size,0);
});
test('saves only a lead from this members verified scout cache and projects known fields',async()=>{
  const store=memory(),item=cache(store,{...lead(),privateProviderField:'not included'});let response=await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt});assert.equal(response.status,200);
  const saved=(await response.json()).leads[0];assert.equal(saved.sourceUrl,item.sourceUrl);assert.equal(saved.status,'saved');assert.equal(saved.notes,'');assert.equal(saved.privateProviderField,undefined);
  response=await run(store,{action:'save',revision:1,leadId:item.id,checkedAt:item.checkedAt});assert.equal(response.status,200);assert.equal((await response.json()).revision,1);assert.equal(store.writes.length,1);
});
test('another member cannot save, update or delete this members opportunities',async()=>{
  const store=memory(),item=cache(store);await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt});
  assert.equal((await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt},OTHER)).status,409);
  assert.equal((await run(store,{action:'update',revision:0,leadId:item.id,status:'booked',notes:'mine'},OTHER)).status,404);
  assert.equal((await run(store,{action:'remove',revision:0,leadId:item.id},OTHER)).status,404);
  assert.equal((await(await run(store)).json()).leads.length,1);
  assert.equal(store.reads.filter(k=>k===`scouts/${OTHER}`).length,1);
});
test('forged body cards, member IDs, and unsupported progress values are rejected',async()=>{
  const store=memory(),item=cache(store);assert.equal((await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt,lead:item})).status,400);
  assert.equal((await run(store,{action:'preferences',revision:0,preferences,memberId:OTHER})).status,400);
  await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt});
  assert.equal((await run(store,{action:'update',revision:1,leadId:item.id,status:'paid',notes:''})).status,400);
});
test('old, expired, mismatched and unsafe source caches cannot be saved',async()=>{
  for(const overrides of [{checkedAt:'2026-09-01T00:00:00.000Z'},{deadline:'2026-09-10'},{sourceUrl:'javascript:alert(1)'},{id:'a'.repeat(24)}]){
    const store=memory(),item=cache(store,lead(overrides));assert.equal((await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt})).status,409);assert.equal(store.writes.length,0);
  }
  const store=memory(),item=lead();store.seed(`scouts/${ID}`,{checkedAt:'2026-09-11T15:00:00.000Z',leads:[item]});assert.equal((await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt})).status,409);
});
test('saved progress and notes remain personal and can be removed',async()=>{
  const store=memory(),item=cache(store);await run(store,{action:'save',revision:0,leadId:item.id,checkedAt:item.checkedAt});
  let response=await run(store,{action:'update',revision:1,leadId:item.id,status:'booked',notes:'  Discussed a demo next week.  '});assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.leads[0].notes,'Discussed a demo next week.');assert.equal(value.leads[0].status,'booked');assert.equal(value.recordedPayments,undefined);
  response=await run(store,{action:'remove',revision:2,leadId:item.id});assert.equal(response.status,200);assert.deepEqual((await response.json()).leads,[]);
});
test('corrupt or wrong-owner saved record fails closed without overwrite',async()=>{
  const store=memory();store.seed(`workspaces/${ID}`,{memberId:OTHER,revision:1,preferences,leads:[],updatedAt:now.toISOString()});
  const response=await run(store,{action:'preferences',revision:0,preferences});assert.equal(response.status,503);assert.equal(store.writes.length,0);
});
test('bounded request reader rejects oversized chunked JSON without writing',async()=>{
  const store=memory();const response=await run(store,{action:'preferences',revision:0,preferences:{...preferences,offering:'a'.repeat(14000)}});assert.equal(response.status,413);assert.equal(store.writes.length,0);
});
test('a second search cannot silently replace the card clicked in another tab',async()=>{
  const store=memory(),first=lead();cache(store,lead({checkedAt:'2026-09-11T16:00:01.000Z',title:'Changed opportunity'}));
  const response=await run(store,{action:'save',revision:0,leadId:first.id,checkedAt:first.checkedAt});
  assert.equal(response.status,409);assert.equal(store.writes.length,0);
});
test('existing null blobs are corrupt records, not a new workspace',async()=>{
  const store=memory();store.seed(`workspaces/${ID}`,null);
  const response=await run(store,{action:'preferences',revision:0,preferences});
  assert.equal(response.status,503);assert.equal(store.writes.length,0);
});
test('beta payout and tax preferences stay private and survive unrelated lead changes',async()=>{
  const store=memory(),paymentPreferences={payoutFrequency:'weekly',weeklyPayoutDay:'friday',taxReservePercent:18.5,taxReminder:'quarterly'};
  let response=await run(store,{action:'payment-preferences',revision:0,paymentPreferences});assert.equal(response.status,200);assert.deepEqual((await response.json()).paymentPreferences,paymentPreferences);
  const item=cache(store);response=await run(store,{action:'save',revision:1,leadId:item.id,checkedAt:item.checkedAt});assert.equal(response.status,200);assert.deepEqual((await response.json()).paymentPreferences,paymentPreferences);
  response=await run(store,undefined,OTHER);assert.deepEqual((await response.json()).paymentPreferences,defaultPaymentPreferences());
  assert.ok(store.writes.every(write=>write.key===`workspaces/${ID}`));
});
test('review records records the server time without accepting tax payment or payout claims',async()=>{
  const store=memory();let response=await run(store,{action:'tax-review',revision:0});assert.equal(response.status,200);const data=await response.json();assert.equal(data.taxReviewedAt,now.toISOString());assert.equal(data.taxesPaid,undefined);
  response=await run(store,{action:'tax-review',revision:1,taxesPaid:true});assert.equal(response.status,400);
  response=await run(store,{action:'payment-preferences',revision:1,paymentPreferences:{...defaultPaymentPreferences(),payoutsActivated:true}});assert.equal(response.status,400);
});
test('earlier saved lead workspaces gain unset payment preferences without losing content',async()=>{
  const store=memory();store.seed(`workspaces/${ID}`,{memberId:ID,revision:7,preferences,leads:[],updatedAt:now.toISOString()});
  const response=await run(store);assert.equal(response.status,200);const data=await response.json();assert.equal(data.revision,7);assert.deepEqual(data.paymentPreferences,defaultPaymentPreferences());assert.deepEqual(data.preferences,preferences);assert.equal(store.writes.length,0);
});
