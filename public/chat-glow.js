// The Chat Room tab reflects who is actually inside the room. The count and
// the owner flag come from the server; this file only paints them. Being
// signed in or reading a profile is not being in the room.
(() => {
 'use strict';
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const SELECTOR='.nav-chat,.mobile-nav-chat,.member-chat-link,[data-chat-glow]';
 const READ_MS=20_000;
 let status=null,inside=false,me=null,readBusy=false,pulseBusy=false,heartbeat=null,reader=null;
 function sessionId(){let id;try{id=sessionStorage.getItem('jspace-chat-room-session-v1');}catch{}if(!UUID.test(id||'')){id=crypto.randomUUID();try{sessionStorage.setItem('jspace-chat-room-session-v1',id);}catch{}}return id;}
 const session=sessionId();

 function label(state){
  if(state==='gold')return{full:'J.White is in the chat',short:'J.White',sentence:'J.White is in the chat'};
  if(state==='green'){const n=status.inside;return{full:`${n} inside`,short:String(n),sentence:`${n} ${n===1?'person':'people'} inside`};}
  if(state==='quiet')return{full:'',short:'',sentence:'nobody inside right now'};
  return{full:'',short:'',sentence:'room status unavailable'};
 }
 // Gold outranks green while the owner is present, and only the server's own
 // owner record can produce it.
 function glowState(){
  if(!status)return'unknown';
  if(status.owner_inside===true&&status.owner_identified===true)return'gold';
  return Number.isSafeInteger(status.inside)&&status.inside>0?'green':'quiet';
 }
 function baseName(node){
  if(!node.dataset.chatGlowName){
   // Captured before the badge is added so the label never accumulates.
   const text=(node.textContent||'').replace(/\s+/g,' ').replace(/^[^\p{L}\p{N}]+/u,'').trim();
   node.dataset.chatGlowName=text||'Chat Room';
  }
  return node.dataset.chatGlowName;
 }
 function paint(){
  const state=glowState(),text=label(state);
  for(const node of document.querySelectorAll(SELECTOR)){
   const name=baseName(node);
   let badge=node.querySelector('.chat-glow-state');
   if(!badge){
    badge=document.createElement('span');badge.className='chat-glow-state';badge.setAttribute('aria-hidden','true');
    const full=document.createElement('span');full.className='chat-glow-full';
    const short=document.createElement('span');short.className='chat-glow-short';
    badge.append(full,short);node.append(badge);
   }
   badge.querySelector('.chat-glow-full').textContent=text.full?`\u00b7 ${text.full}`:'';
   badge.querySelector('.chat-glow-short').textContent=text.short;
   badge.hidden=!text.full;
   node.dataset.chatGlow=state;
   node.setAttribute('aria-label',`${name}, ${text.sentence}`);
  }
 }
 async function read(){
  if(readBusy||document.visibilityState==='hidden')return;
  readBusy=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000);
  try{
   const response=await fetch('/api/chat-room-presence',{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
   const data=await response.json().catch(()=>null);
   if(!response.ok||!data||!Number.isSafeInteger(data.inside)||data.inside<0)return;
   status={inside:data.inside,owner_inside:data.owner_inside===true,owner_identified:data.owner_identified===true};
   paint();
  }catch{/* Keep the last known room status through a brief connection problem. */}
  finally{clearTimeout(timer);readBusy=false;}
 }
 async function pulse(state){
  if(!me||pulseBusy)return;
  pulseBusy=true;
  try{await fetch('/api/chat-room-presence',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,state})});}
  catch{/* The seat expires on its own if this never lands. */}
  finally{pulseBusy=false;if(state==='inside')void read();}
 }
 function stopHeartbeat(){clearInterval(heartbeat);heartbeat=null;}
 function enter(){
  if(!me||inside)return;
  inside=true;void pulse('inside');
  if(heartbeat===null)heartbeat=setInterval(()=>{if(inside&&document.visibilityState!=='hidden')void pulse('inside');},15_000);
 }
 function leave(){
  if(!inside)return;
  inside=false;stopHeartbeat();void pulse('left');
 }
 function setUser(next){
  const id=next?.id;
  if(!UUID.test(id||'')){if(me&&inside)leave();me=null;return;}
  me={id:id.toLowerCase()};
 }
 function start(){
  paint();
  window.RosterChatGlow={setUser,enter,leave,refresh:read,state:glowState};
  document.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='hidden'){if(inside)void pulse('left');}
   else{if(inside)void pulse('inside');void read();}
  });
  // A closed page must not keep glowing; the sweep also expires the seat.
  window.addEventListener('pagehide',()=>{
   stopHeartbeat();
   if(me&&inside)void fetch('/api/chat-room-presence',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:session,state:'left'})}).catch(()=>{});
   inside=false;
  });
  reader=setInterval(()=>void read(),READ_MS);
  void read();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
