import test from 'node:test';
import assert from 'node:assert/strict';
import {BOOKING_PRESETS,bookingPresetDraft,bookingPresetForCategory,bookingServicePayload} from '../booking-offerings.mjs';
const categories=BOOKING_PRESETS.map((preset,index)=>({id:index+20,slug:preset.categorySlug}));
function form(overrides={}){
 const result=new FormData();
 for(const [key,value] of Object.entries({name:'My show',description:'Live performance',bookingPreset:'show',price:'250.50',durationMinutes:'180',bufferBeforeMinutes:'30',bufferAfterMinutes:'15',depositType:'none',depositValue:'0',staffIds:'7',...overrides}))result.set(key,value);
 return result;
}
test('each event starting point creates a real editable service with a database category and no preset price',()=>{
 for(const item of BOOKING_PRESETS){
  const draft=bookingPresetDraft(item.id,categories);
  assert.equal(draft.price,undefined);assert.equal(draft.priceCents,undefined);
  const payload=bookingServicePayload(form({bookingPreset:item.id,name:'My '+item.title,durationMinutes:String(item.durationMinutes)}),3,categories);
  assert.equal(payload.name,'My '+item.title);assert.equal(payload.categoryId,draft.categoryId);
  assert.equal(payload.businessId,3);assert.equal(payload.priceCents,25050);
  assert.deepEqual(payload.staffIds,[7]);assert.equal(payload.depositType,'none');
  assert.equal(payload.bufferBeforeMinutes,30);assert.equal(payload.bufferAfterMinutes,15);
  assert.equal(bookingPresetForCategory(item.categorySlug).id,item.id);
 }
});
test('custom appointments stay untyped and owners can set a longer event length or an explicitly free booking',()=>{
 const result=bookingServicePayload(form({bookingPreset:'',price:'0',durationMinutes:'480',name:'Full-day session'}),3,categories);
 assert.equal(result.categoryId,null);assert.equal(result.priceCents,0);assert.equal(result.durationMinutes,480);
 assert.equal(bookingPresetForCategory('barbers'),null);assert.equal(bookingPresetForCategory('My podcast title'),null);
});
test('missing category, blank price and impossible timing cannot produce a service submission',()=>{
 assert.throws(()=>bookingServicePayload(form(),3,[]),/category could not load/);
 for(const price of ['', '-2','12.345','100001'])assert.throws(()=>bookingServicePayload(form({price}),3,categories));
 for(const durationMinutes of ['0','1441','15.5'])assert.throws(()=>bookingServicePayload(form({durationMinutes}),3,categories),/Length/);
 assert.throws(()=>bookingServicePayload(form({bufferBeforeMinutes:'241'}),3,categories),/Setup/);
 const empty=form();empty.delete('staffIds');assert.throws(()=>bookingServicePayload(empty,3,categories),/Choose who/);
});
test('a provider-selected deposit remains within the chosen price or percentage',()=>{
 const fixed=bookingServicePayload(form({depositType:'fixed',depositValue:'50.25'}),3,categories);
 assert.equal(fixed.depositValue,5025);assert.equal(fixed.depositType,'fixed');
 const percent=bookingServicePayload(form({depositType:'percent',depositValue:'25'}),3,categories);
 assert.equal(percent.depositValue,25);assert.equal(percent.depositType,'percent');
 assert.throws(()=>bookingServicePayload(form({depositType:'fixed',depositValue:'251'}),3,categories),/total price/);
 assert.throws(()=>bookingServicePayload(form({depositType:'percent',depositValue:'101'}),3,categories),/percentage/);
});
