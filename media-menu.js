// The clear Delete button, the "Are you sure you want to remove this?" ask and
// the Undo offer, shared by every place a member's photos and videos show up.
// Loaded as a plain script so the classic album pages and the bundled member
// tools can both reach it through window.RosterMedia.
(() => {
 'use strict';
 if (window.RosterMedia) return;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,HASH=/^[a-f0-9]{64}$/;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const one=kind=>kind==='video'?'video':'photo';
 const label=(count,kind)=>count===1?`this ${one(kind)}`:`these ${count} items`;
 const clean=list=>(Array.isArray(list)?list:[]).filter(i=>i&&HASH.test(i.id||'')&&(i.kind==='photo'||i.kind==='video'))
  .map(i=>({kind:i.kind,id:i.id,member_id:UUID.test(i.member_id||'')?i.member_id.toLowerCase():null,name:typeof i.name==='string'?i.name:''}));
 const payload=list=>list.map(i=>i.member_id?{kind:i.kind,id:i.id,member_id:i.member_id}:{kind:i.kind,id:i.id});

 // Who is looking. Asked once per page; the server decides every removal for
 // itself, so this only chooses whether to offer the menu at all.
 let asked=null;
 function viewer() {
  if(!asked)asked=(async()=>{
   const r=await fetch('/api/profile/me',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
   if(!r.ok)return null;const d=await r.json();const id=typeof d?.profile?.id==='string'?d.profile.id.toLowerCase():'';
   return UUID.test(id)?{id,isAdmin:d?.can_edit_owner===true}:null;
  })().catch(()=>null);
  return asked;
 }
 async function mine(item) {
  const person=await viewer();
  return Boolean(person)&&(person.isAdmin||!item.member_id||item.member_id===person.id);
 }
 async function send(path,list) {
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),20000);
  try {
   const r=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',signal:c.signal,
    headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({items:payload(list)})});
   const d=await r.json().catch(()=>null);
   if(!r.ok)throw new Error(d?.error||d?.failed?.[0]?.error||'That did not go through. Please try again.');
   return d||{};
  }finally{clearTimeout(timer);}
 }

 // One menu is open at a time, closed by the next tap anywhere else.
 let openList=null,openTrigger=null;
 function shut() {if(openList){openList.hidden=true;openTrigger?.setAttribute('aria-expanded','false');openList=null;openTrigger=null;}}
 document.addEventListener('click',event=>{if(openList&&!openList.parentNode?.contains(event.target))shut();},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&openList){const t=openTrigger;shut();t?.focus();}});

 // The confirmation. One dialog is reused, so repeated deletes cannot stack up.
 let ask=null,askTitle=null,askNote=null,askDecide=null;
 function confirmDialog() {
  if(ask||typeof HTMLDialogElement==='undefined'||!document.body)return ask;
  ask=el('dialog','','media-confirm');ask.setAttribute('aria-labelledby','media-confirm-title');
  askTitle=el('h2','Are you sure you want to remove this?','media-confirm-title');askTitle.id='media-confirm-title';
  askNote=el('p','','media-confirm-note');
  const row=el('div','','media-confirm-actions'),go=el('button','Remove','media-confirm-remove'),stop=el('button','Cancel','media-confirm-cancel');
  go.type=stop.type='button';row.append(go,stop);ask.append(askTitle,askNote,row);document.body.append(ask);
  const settle=answer=>{const decide=askDecide;askDecide=null;if(ask.open)ask.close();decide?.(answer);};
  go.addEventListener('click',()=>settle(true));stop.addEventListener('click',()=>settle(false));
  ask.addEventListener('cancel',event=>{event.preventDefault();settle(false);});
  ask.addEventListener('close',()=>settle(false));
  return ask;
 }
 function confirmRemoval(list) {
  const dialog=confirmDialog();
  if(!dialog)return Promise.resolve(window.confirm('Are you sure you want to remove this?'));
  askDecide?.(false);
  askTitle.textContent=list.length===1?'Are you sure you want to remove this?':`Are you sure you want to remove these ${list.length} items?`;
  askNote.textContent=list.length===1
   ? `${one(list[0].kind)==='video'?'This video':'This photo'} comes off your profile, your photos, the wall and the video section right away.`
   : 'They come off your profile, your photos, the wall and the video section right away.';
  return new Promise(resolve=>{askDecide=resolve;dialog.showModal();
   dialog.querySelector('.media-confirm-remove')?.focus({preventScroll:true});});
 }

 // The Undo offer. The file itself is kept for a short while, so Undo puts the
 // picture or video back exactly as it was, then the file is cleared for good.
 let toast=null,toastText=null,toastUndo=null,waiting=null,countdown=null,hide=null,finish=null;
 function toastNode() {
  if(toast)return toast;
  toast=el('div','','media-toast');toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');toast.hidden=true;
  toastText=el('p','','media-toast-text');
  toastUndo=el('button','Undo','media-toast-undo');toastUndo.type='button';
  const close=el('button','Dismiss','media-toast-close');close.type='button';
  toast.append(toastText,toastUndo,close);document.body.append(toast);
  toastUndo.addEventListener('click',()=>void undo());
  close.addEventListener('click',()=>{settle();});
  return toast;
 }
 function stopTimers() {clearInterval(countdown);clearTimeout(hide);countdown=hide=null;}
 // Clears the kept files once the offer has gone. Anything whose page closed
 // first is cleared by the site's own hourly sweep instead.
 function settle() {
  stopTimers();if(toast)toast.hidden=true;
  const done=waiting;waiting=null;clearTimeout(finish);finish=null;
  if(done?.list.length)finish=setTimeout(()=>{void send('/api/media/purge',done.list).catch(()=>{});},Math.max(1,done.purgeAfter)*1000);
 }
 async function undo() {
  const held=waiting;if(!held)return;
  stopTimers();toastUndo.disabled=true;toastText.textContent='Bringing it back…';
  try {
   const d=await send('/api/media/restore',held.list);
   waiting=null;toast.hidden=true;
   const failed=Array.isArray(d.failed)?d.failed:[];
   const message=failed.length?failed[0].error||'Some items could not be brought back.':'Back in place. Nothing was lost.';
   held.notify?.(message);
   held.changed?.();
   show([],{},message);
  }catch(e){waiting=held;toastText.textContent=e.message;countdownFrom(held);}
  finally{toastUndo.disabled=false;}
 }
 function countdownFrom(held) {
  let left=held.seconds;
  toastUndo.hidden=false;toastUndo.textContent=`Undo (${left})`;
  countdown=setInterval(()=>{left-=1;toastUndo.textContent=left>0?`Undo (${left})`:'Undo';},1000);
  hide=setTimeout(()=>{settle();},held.seconds*1000);
 }
 function show(list,held,message) {
  toastNode();settle();
  toastText.textContent=message;
  if(!list.length){toastUndo.hidden=true;toast.hidden=false;hide=setTimeout(()=>{if(toast)toast.hidden=true;},6000);return;}
  waiting={...held,list};
  toast.hidden=false;countdownFrom(waiting);
 }

 function trouble(failed) {
  const first=failed[0]?.error;
  return failed.length===1?first||'That could not be removed.':`${first||'Some items could not be removed.'} ${failed.length} items were kept.`;
 }
 async function removeMedia(list,options={}) {
  const chosen=clean(list);
  if(!chosen.length)return null;
  if(!await confirmRemoval(chosen))return null;
  options.onBusy?.(true);
  options.onStatus?.(`Removing ${label(chosen.length,chosen[0].kind)}…`);
  try {
   const d=await send('/api/media/remove',chosen);
   const removed=Array.isArray(d.removed)?d.removed:[],failed=Array.isArray(d.failed)?d.failed:[];
   const kept=chosen.filter(i=>removed.some(r=>r.id===i.id&&r.kind===i.kind));
   const message=kept.length
    ? `${kept.length===1?one(kept[0].kind)==='video'?'Video removed.':'Photo removed.':`${kept.length} items removed.`}${failed.length?` ${trouble(failed)}`:''}`
    : trouble(failed);
   show(kept,{seconds:Number.isFinite(d.undo_seconds)&&d.undo_seconds>0?Math.min(60,d.undo_seconds):8,
    purgeAfter:Number.isFinite(d.purge_after_seconds)&&d.purge_after_seconds>0?Math.min(300,d.purge_after_seconds):31,
    changed:options.onChanged,notify:options.onStatus},message);
   options.onStatus?.(message);
   options.onChanged?.({removed,failed});
   return d;
  }catch(e){options.onStatus?.(e.message);show([],{},e.message);throw e;}
  finally{options.onBusy?.(false);}
 }

 /** Puts a direct, labeled Delete button on a photo or video card. It only
  * appears for the member who uploaded it, or for the site owner. */
 function attach(host,item,options={}) {
  const [entry]=clean([item]);
  if(!host||!entry)return null;
  host.querySelector(':scope > .media-menu')?.remove();
  const wrap=el('div','','media-menu');wrap.hidden=true;
  const del=el('button','Delete','media-delete-direct');del.type='button';
  del.setAttribute('aria-label',`Delete this ${one(entry.kind)}`);
  wrap.append(del);host.append(wrap);
  del.addEventListener('click',async event=>{
   event.preventDefault();event.stopPropagation();del.disabled=true;
   try{await removeMedia([entry],options);}catch{/* the message is already shown */}
   finally{del.disabled=false;}
  });
  void mine(entry).then(allowed=>{wrap.hidden=!allowed;});
  return wrap;
 }

 window.RosterMedia={attach,remove:removeMedia,confirmRemoval,viewer,canRemove:mine,
  reset(){asked=null;},
  forget(){settle();}};
})();
