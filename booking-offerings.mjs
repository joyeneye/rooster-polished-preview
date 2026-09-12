export const BOOKING_PRESETS = Object.freeze([
  {id:'show',title:'Show / live performance',categorySlug:'live-performances',durationMinutes:60,description:'Book a live performance. Share the event, venue, audience and any setup requirements.',notesPrompt:'Event name, audience, venue and stage or sound setup.'},
  {id:'podcast',title:'Podcast interview',categorySlug:'podcast-interviews',durationMinutes:60,description:'Book time for a podcast interview. Share the show name, topic and recording format.',notesPrompt:'Podcast name, interview topic and whether the recording is online or in person.'},
  {id:'speaking',title:'Speaking engagement',categorySlug:'speaking',durationMinutes:60,description:'Book a speaking engagement. Share the occasion, topic and audience.',notesPrompt:'Event name, speaking topic, audience and any questions you want covered.'},
  {id:'hosting',title:'Event hosting / panel',categorySlug:'hosting-panels',durationMinutes:120,description:'Book event hosting or a panel appearance. Share the program, audience and role.',notesPrompt:'Event or panel name, hosting role, audience and run of show.'},
  {id:'community',title:'Church / community event',categorySlug:'church-community',durationMinutes:60,description:'Book time for a church or community event. Share the occasion, audience and requested role.',notesPrompt:'Event name, community or church, topic and requested role.'},
  {id:'media',title:'Radio / media interview',categorySlug:'radio-media',durationMinutes:30,description:'Book a radio or media interview. Share the outlet, topic and whether it is live or recorded.',notesPrompt:'Outlet or program, topic, and whether the interview is live or recorded.'}
].map(item=>Object.freeze(item)));

export function bookingPresetForCategory(slug) {
  return BOOKING_PRESETS.find(item=>item.categorySlug===slug) || null;
}

// These are editable starting points. Prices and deposits are always chosen by
// the provider; selecting a template never creates a service or a booking.
export function bookingPresetDraft(id,categories=[]) {
  const preset=BOOKING_PRESETS.find(item=>item.id===id);
  if(!preset)return null;
  const category=categories.find(item=>item.slug===preset.categorySlug);
  return {...preset,categoryId:Number.isInteger(category?.id)?category.id:null};
}

export function bookingServicePayload(form,businessId,categories=[]) {
  const read=name=>String(form.get(name)||'').trim();
  const whole=(name,min,max,label)=>{
    const value=Number(read(name));
    if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${label} must be between ${min} and ${max}.`);
    return value;
  };
  const money=(name,label)=>{
    const value=read(name);
    if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error(`Enter ${label.toLowerCase()} with no more than two decimal places.`);
    const cents=Math.round(Number(value)*100);
    if(cents>10000000)throw new Error(`${label} is too large.`);
    return cents;
  };
  const name=read('name'),description=read('description');
  if(!name||name.length>100)throw new Error('Give this booking option a name of up to 100 characters.');
  if(description.length>1200)throw new Error('Keep the description under 1,200 characters.');
  const preset=bookingPresetDraft(read('bookingPreset'),categories);
  if(preset&&!preset.categoryId)throw new Error('This booking category could not load. Close this form and try again.');
  const priceCents=money('price','Price');
  const depositType=['fixed','percent'].includes(read('depositType'))?read('depositType'):'none';
  const depositValue=depositType==='none'?0:depositType==='fixed'?money('depositValue','Deposit'):whole('depositValue',0,100,'Deposit percentage');
  if(depositType==='fixed'&&depositValue>priceCents)throw new Error('The deposit cannot be more than the total price.');
  const staffIds=form.getAll('staffIds').map(Number);
  if(!staffIds.length||staffIds.some(id=>!Number.isInteger(id)||id<1))throw new Error('Choose who this booking is with.');
  return {
    businessId,name,description,categoryId:preset?.categoryId||null,priceCents,
    durationMinutes:whole('durationMinutes',5,1440,'Length in minutes'),
    bufferBeforeMinutes:whole('bufferBeforeMinutes',0,240,'Setup time'),
    bufferAfterMinutes:whole('bufferAfterMinutes',0,240,'Wrap-up time'),
    depositType,depositValue,staffIds
  };
}
