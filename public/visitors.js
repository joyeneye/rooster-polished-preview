(() => {
 'use strict';
 const box=document.querySelector('[data-visitors-box]');if(!box)return;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const MEMBER=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const DWELL=4000,PAD=4,KEY='jspace.visitor';
 const rows=box.querySelector('[data-visitors-rows]'),note=box.querySelector('[data-visitors-note]');
 const rank=box.querySelector('[data-visitors-rank]'),place=box.querySelector('[data-visitors-position]');
 const dials={today:box.querySelector('[data-visitors-today]'),this_week:box.querySelector('[data-visitors-week]'),all_time:box.querySelector('[data-visitors-all]')};
 let subject=box.getAttribute('data-visitors-subject')||'',painted=false,sent=false,dwell=0,since=0,timer=0;

 /** A guest keeps one random id in their own browser. Nothing about the
  * device is measured or sent, so this is an estimate of a visitor. */
 function fresh(){
  if(window.crypto&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
  if(!window.crypto||typeof crypto.getRandomValues!=='function')return '';
  const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;
  const hex=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 }
 let held='';
 function visitorId(){
  if(held)return held;
  let saved='';try{saved=localStorage.getItem(KEY)||'';}catch{saved='';}
  if(!UUID.test(saved)){saved=fresh();if(UUID.test(saved)){try{localStorage.setItem(KEY,saved);}catch{}}}
  held=UUID.test(saved)?saved:'';return held;
 }

 /** Digits ride in their own wells like an old counter drum, with the unused
  * leading places dimmed instead of dropped. */
 function dial(target,value){
  if(!target)return;
  const digits=String(Math.max(0,Number.isSafeInteger(value)?value:0)).padStart(PAD,'0');
  const lead=digits.length-String(Math.max(0,Number.isSafeInteger(value)?value:0)).replace(/^0+(?=\d)/,'').length;
  const drum=document.createElement('span');drum.className='odometer';
  drum.setAttribute('role','img');drum.setAttribute('aria-label',`${Number(digits).toLocaleString()} visitors`);
  [...digits].forEach((digit,index)=>{const cell=document.createElement('b');cell.textContent=digit;if(index<lead&&digits.length>1)cell.className='is-lead';drum.append(cell);});
  const before=target.firstElementChild&&target.firstElementChild.textContent;
  target.replaceChildren(drum);
  if(painted&&before!==null&&before!==digits)  {drum.classList.add('is-counting');setTimeout(()=>drum.classList.remove('is-counting'),500);}
 }

 function paint(data){
  dial(dials.today,data.today);dial(dials.this_week,data.this_week);dial(dials.all_time,data.all_time);
  if(rank&&place){
   const spot=Number.isSafeInteger(data.position)&&data.position>0?data.position:0;
   if(spot){place.textContent=`#${spot}`;rank.href=data.chart_url||'/top25.html';rank.hidden=false;}
   else rank.hidden=true;
  }
  if(rows)rows.hidden=false;
  if(note)note.hidden=false;
  box.hidden=false;painted=true;
 }
 function stall(){
  if(rows)rows.hidden=true;if(rank)rank.hidden=true;
  if(note){note.textContent='The visitor counter is taking a break. Reload the page to try again.';note.hidden=false;}
  box.hidden=false;
 }

 async function call(path,init){
  const stop=new AbortController(),cut=setTimeout(()=>stop.abort(),15000);
  try{
   const answer=await fetch(path,{cache:'no-store',credentials:'same-origin',signal:stop.signal,...init});
   const data=await answer.json().catch(()=>null);
   if(!answer.ok||!data)throw new Error('visitors');
   return data;
  }finally{clearTimeout(cut);}
 }

 async function load(){
  try{paint(await call(`/api/visitors?id=${encodeURIComponent(subject)}`));}
  catch{if(!painted)stall();}
 }
 async function record(){
  const id=visitorId();if(!id||sent)return;sent=true;
  try{paint(await call('/api/visitors/visit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile_id:subject,visitor_id:id,dwell_ms:Math.min(3600000,Math.round(dwell))})}));}
  catch{}
 }

 /** Only time the page actually spends on screen counts towards a visit, so a
  * background tab or a bounce never sends one. */
 function tick(){
  if(document.visibilityState==='hidden'){if(since){dwell+=Date.now()-since;since=0;}return;}
  if(!since)since=Date.now();
  if(Date.now()-since+dwell>=DWELL){dwell+=Date.now()-since;since=Date.now();stopClock();void record();}
 }
 function stopClock(){if(timer){clearInterval(timer);timer=0;}}
 function startClock(){if(!timer&&!sent&&subject)timer=setInterval(tick,1000);tick();}

 function begin(id){
  if(!id||subject===id&&painted)return;
  subject=id;void load();startClock();
 }
 document.addEventListener('visibilitychange',()=>{if(sent)return;tick();});
 window.addEventListener('pagehide',stopClock);

 if(subject==='owner')begin('owner');
 else{
  const ready=profile=>{if(profile&&MEMBER.test(profile.id||''))begin(profile.id);};
  window.addEventListener('jwhite:profile-ready',event=>ready(event.detail));
  if(window.JWhitePublicProfile)ready(window.JWhitePublicProfile);
 }
})();
