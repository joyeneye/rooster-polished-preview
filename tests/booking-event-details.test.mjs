import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {BOOKING_PRESETS} from '../booking-offerings.mjs';
import {bookingEventPreset,updateBookingDraft,bookingClientPayload,bookingEventLocation} from '../booking-event-details.mjs';

const serviceCategories=BOOKING_PRESETS.map((preset,index)=>({id:index+1,slug:preset.categorySlug,name:preset.title}));
const provider={category:{id:40,slug:'barbers'},serviceCategories,business:{name:'Real provider',currency:'usd',timezone:'UTC',addressLine1:'Business address'},staff:[],assignments:[]};
const service={id:20,categoryId:2,name:'An original interview title',durationMinutes:60,priceCents:5000,depositType:'none',depositValue:0};
const draft={name:'Pat',email:'pat@example.com',phone:'555-0100',eventName:'Our podcast',eventFormat:'online',eventLocation:'Host will share the call details',notes:'Talk about the new project.'};

test('event forms match actual service categories, with business fallback only for uncategorized services',()=>{
 for(const category of serviceCategories)assert.equal(bookingEventPreset(provider,{...service,categoryId:category.id}).categorySlug,category.slug);
 assert.equal(bookingEventPreset(provider,{...service,categoryId:99,name:'Podcast interview'}),null);
 assert.equal(bookingEventPreset(provider,{...service,categoryId:null,name:'Live show'}),null);
 const eventBusiness={...provider,category:serviceCategories[1]};
 assert.equal(bookingEventPreset(eventBusiness,{...service,categoryId:null}).categorySlug,'podcast-interviews');
 assert.equal(bookingEventPreset(eventBusiness,{...service,categoryId:40}),null,'an explicit non-event category does not inherit event fields');
});

test('event details become bounded existing notes without changing contact or payment fields',()=>{
 const payload=bookingClientPayload({...draft,priceCents:1,staffId:99},true);
 assert.deepEqual(Object.keys(payload),['name','email','phone','notes']);
 assert.equal(payload.notes,'Event / show: Our podcast\nFormat: Online\nVenue / call arrangements: Host will share the call details\nNotes: Talk about the new project.');
 assert.equal(bookingClientPayload(draft,false).notes,draft.notes);
 assert.equal(bookingClientPayload({...draft,eventName:'',eventFormat:'',eventLocation:'',notes:'x'.repeat(1000)},true).notes.length,1000);
 assert.throws(()=>bookingClientPayload({...draft,notes:'x'.repeat(1000)},true),/1,000 characters/);
 assert.throws(()=>bookingClientPayload({...draft,eventFormat:'automatic-meeting'},true),/Choose in person/);
 assert.match(bookingEventLocation(draft),/^Online · Host will share/);
 assert.match(bookingEventLocation({}),/to arrange/);
});

test('draft updates retain previous details for Back and retries without duplicating the event summary',()=>{
 const first=updateBookingDraft({},draft);
 const changed=updateBookingDraft(first,{notes:'Revised topic'});
 assert.equal(changed.eventName,'Our podcast');assert.equal(changed.email,draft.email);
 const one=bookingClientPayload(changed,true),two=bookingClientPayload(changed,true);
 assert.deepEqual(one,two);assert.equal(one.notes.match(/Event \/ show:/g).length,1);
 assert.equal(changed.notes,'Revised topic');assert.equal(first.notes,draft.notes);
});

function browserEnvironment(){
 const nodes={},handlers={};
 const node=selector=>nodes[selector] ||= {innerHTML:'',textContent:'',classList:{toggle(){},remove(){}},addEventListener:(name,handler)=>{handlers[name]=handler;},querySelectorAll:()=>[]};
 const document={querySelector:selector=>selector==='#client-form'?null:node(selector),querySelectorAll:()=>[]};
 const source=readFileSync(new URL('../booking-provider.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace(/init\(\);\s*$/,'');
 const context={document,location:{pathname:'/book/real-provider'},window:{},URL,URLSearchParams,Intl,Date,Object,bookingEventPreset,updateBookingDraft,bookingClientPayload,bookingEventLocation,
  FormData:class{constructor(form){this.values=form.values;}*[Symbol.iterator](){yield* Object.entries(this.values);}}};
 vm.runInNewContext(source+';globalThis.binding={state,renderDetailsStep,renderReviewStep,calendarUrl};',context);
 const state=context.binding.state;
 state.provider={...provider,services:[service]};state.service=service;state.slot={startsAt:'2026-10-20T13:00:00.000Z',endsAt:'2026-10-20T14:00:00.000Z',staffId:3,staffName:'Host'};
 return {...context.binding,nodes,handlers};
}

test('real provider form retains values when returning from review and keeps event locations off the business address',()=>{
 const e=browserEnvironment();e.renderDetailsStep();
 assert.match(e.nodes['#booking-content'].innerHTML,/name="eventName"/);
 e.renderReviewStep({values:{...draft,eventName:'A <great> podcast'}});
 assert.equal(e.state.step,5);assert.match(e.nodes['#booking-content'].innerHTML,/A &lt;great&gt; podcast/);
 const payload=JSON.stringify(e.state.client);
 e.handlers.click({target:{closest:selector=>selector==='[data-back]'?{dataset:{back:'details'}}:null}});
 assert.equal(e.state.step,4);assert.match(e.nodes['#booking-content'].innerHTML,/value="A &lt;great&gt; podcast"/);
 assert.match(e.nodes['#booking-content'].innerHTML,/Talk about the new project\./);
 e.renderReviewStep({values:{...draft,eventName:'A <great> podcast'}});assert.equal(JSON.stringify(e.state.client),payload);
 assert.match(new URL(e.calendarUrl()).searchParams.get('location'),/^Online/);
 e.state.service={...service,id:21,categoryId:null};e.renderDetailsStep();
 assert(!e.nodes['#booking-content'].innerHTML.includes('name="eventName"'));
 assert(!e.nodes['#booking-content'].innerHTML.includes('A &lt;great&gt; podcast'));
 assert.equal(new URL(e.calendarUrl()).searchParams.get('location'),'Business address');
});

test('combined note overflow stays on the details step so the client can correct it',()=>{
 const e=browserEnvironment();e.renderDetailsStep();e.renderReviewStep({values:{...draft,notes:'x'.repeat(1000)}});
 assert.equal(e.state.step,4);assert.equal(e.state.client,null);
 assert.match(e.nodes['#client-details-error'].innerHTML,/1,000 characters/);
});
