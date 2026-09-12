(() => {
 'use strict';
 const list=document.querySelector('[data-chart-list]');if(!list)return;
 const status=document.getElementById('top25-status'),retry=document.getElementById('top25-retry');
 const empty=document.querySelector('[data-chart-empty]'),week=document.querySelector('[data-chart-week]');
 const fill=document.querySelector('[data-chart-fill]');
 const winnerCard=document.querySelector('[data-fill-winner]'),winnerBody=document.querySelector('[data-fill-winner-body]');
 const newCard=document.querySelector('[data-fill-new]'),newList=document.querySelector('[data-fill-new-list]');
 const weekStart=document.querySelector('[data-chart-week-start]'),ranked=document.querySelector('[data-chart-ranked]'),updated=document.querySelector('[data-chart-updated]');
 const MOVES={up:'up',down:'down',new:'new',same:'same'};
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
 const count=value=>Number.isSafeInteger(value)&&value>0?value.toLocaleString():'0';
 function day(value){
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(String(value))?new Date(`${value}T12:00:00Z`):null;
  if(!parsed||Number.isNaN(parsed.getTime()))return String(value||'—');
  return parsed.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',day:'numeric',year:'numeric'});
 }
 function photo(entry){
  const frame=el('span',null,'top25-photo');
  if(entry.photo_url){const img=el('img');img.src=entry.photo_url;img.alt=`${entry.name||'Member'} profile picture`;img.loading='lazy';img.width=46;img.height=46;frame.append(img);}
  else frame.append(el('span',(entry.name||'M').trim().charAt(0).toUpperCase()||'M'));
  return frame;
 }
 function row(entry){
  const item=document.createElement('li'),link=el('a',null,'top25-entry');
  link.href=entry.profile_url||'/people.html';
  const move=entry.movement&&MOVES[entry.movement.kind]?entry.movement:{kind:'same',label:'SAME'};
  link.setAttribute('aria-label',`Number ${entry.position}, ${entry.name||'Member'}, ${count(entry.visitors)} visitors this week, ${move.label==='NEW'?'new on the chart':move.label==='SAME'?'no change':move.kind==='up'?`up ${move.places}`:`down ${move.places}`}`);
  const name=el('span',null,'top25-name');
  name.append(el('strong',entry.name||'Somebody on the ROOSTER'),el('em',`${count(entry.visitors)} visitor${entry.visitors===1?'':'s'} this week`));
  const meta=el('span',null,'top25-meta'),badge=el('span',move.label,'top25-move');
  badge.setAttribute('data-move',MOVES[move.kind]);
  meta.append(badge);
  if(Number.isSafeInteger(entry.last_week_position)&&entry.last_week_position>0)meta.append(el('em',`Last week #${entry.last_week_position}`,'top25-name'));
  link.append(el('span',String(entry.position).padStart(2,'0'),'top25-position'),photo(entry),name,meta);
  item.append(link);return item;
 }
 // When fewer than a full chart of profiles is ranked, the leftover room carries real
 // ROOSTER activity instead of blank page. Every panel is loaded live, never written in.
 function fillLink(entry,note){
  const link=el('a',null,'top25-fill-entry');
  link.href=entry.profile_url||'/people.html';
  const name=el('span',null,'top25-name');
  name.append(el('strong',entry.name||'Somebody on the ROOSTER'));
  if(note)name.append(el('em',note));
  link.append(photo(entry),name);
  return link;
 }
 async function paintWinner(){
  if(!winnerCard||!winnerBody)return;
  winnerCard.hidden=true;
  try{
   const answer=await fetch('/api/visitors/featured',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
   if(!answer.ok)return;
   const data=await answer.json();
   const winner=data&&data.featured;
   if(!winner||typeof winner.name!=='string')return;
   winnerBody.replaceChildren(fillLink(winner,`${count(winner.visitors)} visitor${winner.visitors===1?'':'s'} the week of ${day(data.featured_week_start)}`));
   winnerCard.hidden=false;
  }catch{/* the chart itself is what matters, so a missing panel just stays hidden */}
 }
 async function paintNewest(){
  if(!newCard||!newList)return;
  newCard.hidden=true;
  try{
   const answer=await fetch('/api/members?limit=6&offset=0',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
   if(!answer.ok)return;
   const data=await answer.json();
   const members=Array.isArray(data&&data.members)?data.members.filter(member=>member&&member.profile_url!=='/#home').slice(0,5):[];
   if(!members.length)return;
   newList.replaceChildren(...members.map(member=>{const item=document.createElement('li');item.append(fillLink(member,member.online?'Online now':''));return item;}));
   newCard.hidden=false;
  }catch{/* same here: the panel is extra, not the page */}
 }
 function paintFill(chart){
  if(!fill)return;
  const size=Number.isSafeInteger(chart.chart_size)&&chart.chart_size>0?chart.chart_size:25;
  const ranked=Number.isSafeInteger(chart.ranked)&&chart.ranked>0?chart.ranked:0;
  if(ranked>=size){fill.hidden=true;return;}
  fill.hidden=false;
  void paintWinner();
  void paintNewest();
 }
 function paint(chart){
  const entries=Array.isArray(chart.entries)?chart.entries:[];
  if(weekStart)weekStart.textContent=day(chart.week_start);
  if(ranked)ranked.textContent=entries.length?`${count(entries.length)} of ${count(chart.ranked)} ranked profile${chart.ranked===1?'':'s'}`:'';
  if(updated&&chart.updated_at){const at=new Date(chart.updated_at);updated.textContent=Number.isNaN(at.getTime())?'':`Counted ${at.toLocaleString()}`;}
  if(week)week.hidden=false;
  list.replaceChildren(...entries.map(row));
  list.hidden=entries.length===0;
  if(empty)empty.hidden=entries.length>0;
  status.textContent=entries.length?`This week’s top ${count(entries.length)} most visited pages on the ROOSTER. Tap a name to open their page.`:'';
  status.hidden=entries.length===0;
  if(retry)retry.hidden=true;
  paintFill(chart);
 }
 async function load(){
  status.hidden=false;status.textContent='Counting up this week’s visitors…';
  if(retry)retry.hidden=true;
  const stop=new AbortController(),cut=setTimeout(()=>stop.abort(),15000);
  try{
   const answer=await fetch('/api/top25',{cache:'no-store',credentials:'same-origin',signal:stop.signal});
   const data=await answer.json().catch(()=>null);
   if(!answer.ok||!data)throw new Error('chart');
   paint(data);
  }catch{
   status.textContent='The chart could not load right now. Nothing has been lost — try again.';
   list.hidden=true;if(empty)empty.hidden=true;if(fill)fill.hidden=true;if(retry)retry.hidden=false;
  }finally{clearTimeout(cut);}
 }
 if(retry)retry.addEventListener('click',()=>void load());
 void load();
})();
