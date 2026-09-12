(() => {
 'use strict';
 // The landing page cards are read from the live space: the newest members, what
 // is open on the opportunity board and this week's TOP 25. Nothing here is
 // written into the page by hand, and a panel that cannot load just stays hidden
 // behind the copy and the links that are already in the markup.
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const PHOTO=/^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/;
 const memberStrip=document.querySelector('[data-portal-members]');
 const board=document.querySelector('[data-portal-opportunities]');
 const chart=document.querySelector('[data-portal-top25]');
 if(!memberStrip&&!board&&!chart)return;
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(cls)node.className=cls;return node;};
 const count=value=>Number.isSafeInteger(value)&&value>0?value.toLocaleString('en-US'):'0';
 async function read(path){
  const stop=new AbortController(),cut=setTimeout(()=>stop.abort(),12_000);
  try{
   const answer=await fetch(path,{cache:'no-store',credentials:'same-origin',signal:stop.signal,headers:{Accept:'application/json'}});
   return answer.ok?await answer.json():null;
  }catch{return null;}finally{clearTimeout(cut);}
 }
 // A member's own picture, or the first letter of their name when they have not put one up.
 function avatar(entry){
  const frame=el('span',null,'portal-member-avatar');
  const initial=()=>el('span',(entry.name||'M').trim().charAt(0).toUpperCase()||'M');
  if(typeof entry.photo_url==='string'&&PHOTO.test(entry.photo_url)){
   const img=el('img');img.src=entry.photo_url;img.alt='';img.loading='lazy';img.width=44;img.height=44;
   img.addEventListener('error',()=>frame.replaceChildren(initial()),{once:true});
   frame.append(img);
  }else frame.append(initial());
  return frame;
 }
 async function paintMembers(){
  if(!memberStrip)return;
  const data=await read('/api/members?limit=8&offset=0');
  // The owner's page is not a community member card, so it never fills this strip.
  const list=Array.isArray(data?.members)
   ? data.members.filter(member=>UUID.test(member?.id||'')&&typeof member.name==='string'&&member.profile_url!=='/#home').slice(0,5)
   : [];
  if(!list.length)return;
  memberStrip.replaceChildren(...list.map(member=>{
   const item=document.createElement('li'),link=el('a',null,'portal-member-card');
   link.href=`/profile.html?id=${encodeURIComponent(member.id)}`;
   link.setAttribute('aria-label',`Open ${member.name}'s ROOSTER page`);
   link.append(avatar(member),el('span',member.name,'portal-member-name'));
   item.append(link);return item;
  }));
  memberStrip.hidden=false;
 }
 async function paintBoard(){
  if(!board)return;
  const data=await read('/api/opportunities?sort=newest');
  const list=Array.isArray(data?.opportunities)
   ? data.opportunities.filter(item=>typeof item?.title==='string'&&typeof item?.slug==='string').slice(0,3)
   : [];
  if(!list.length)return;
  board.replaceChildren(...list.map(item=>{
   const row=document.createElement('li'),link=el('a',null,'portal-opportunity-link');
   link.href=`/apply.html?opportunity=${encodeURIComponent(item.slug)}`;
   link.append(el('strong',item.title));
   const note=[
    typeof item.posted_by_name==='string'&&item.posted_by_name?`Posted by ${item.posted_by_name}`:'',
    Number.isSafeInteger(item.application_count)&&item.application_count>0?`${count(item.application_count)} applied`:'',
   ].filter(Boolean).join(' · ');
   if(note)link.append(el('em',note));
   row.append(link);return row;
  }));
  board.hidden=false;
 }
 async function paintChart(){
  if(!chart)return;
  const data=await read('/api/top25');
  const list=Array.isArray(data?.entries)
   ? data.entries.filter(entry=>Number.isSafeInteger(entry?.position)&&entry.position>0).slice(0,3)
   : [];
  if(!list.length)return;
  chart.replaceChildren(...list.map(entry=>{
   const row=document.createElement('li'),link=el('a',null,'portal-chart-link');
   link.href=entry.profile_url||'/top25.html';
   const name=el('span',null,'portal-chart-name');
   name.append(el('strong',entry.name||'Somebody on the ROOSTER'),el('em',`${count(entry.visitors)} visitor${entry.visitors===1?'':'s'} this week`));
   link.append(el('b',`#${entry.position}`,'portal-chart-position'),avatar(entry),name);
   row.append(link);return row;
  }));
  chart.hidden=false;
 }
 function start(){void paintMembers();void paintBoard();void paintChart();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
