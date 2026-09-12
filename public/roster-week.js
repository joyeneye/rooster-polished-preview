(() => {
 'use strict';
 const featured=document.querySelector('[data-featured-profile]'),recap=document.querySelector('[data-visitor-recap]');
 if(!featured&&!recap)return;
 const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined&&text!==null)node.textContent=text;if(className)node.className=className;return node;};
 const count=value=>Number.isSafeInteger(value)&&value>0?value.toLocaleString():'0';
 function day(value){
  const parsed=/^\d{4}-\d{2}-\d{2}$/.test(String(value))?new Date(`${value}T12:00:00Z`):null;
  if(!parsed||Number.isNaN(parsed.getTime()))return '';
  return parsed.toLocaleDateString(undefined,{timeZone:'UTC',month:'long',day:'numeric'});
 }
 async function call(path){
  const stop=new AbortController(),cut=setTimeout(()=>stop.abort(),15000);
  try{
   const answer=await fetch(path,{cache:'no-store',credentials:'same-origin',signal:stop.signal});
   const data=await answer.json().catch(()=>null);
   if(!answer.ok||!data)throw new Error(String(answer.status));
   return data;
  }finally{clearTimeout(cut);}
 }

 /** Last week's number one holds the feature for the whole of this week. */
 async function showFeatured(){
  if(!featured)return;
  const body=featured.querySelector('[data-featured-body]'),blank=featured.querySelector('[data-featured-empty]');
  let data=null;
  try{data=await call('/api/visitors/featured');}catch{featured.hidden=true;return;}
  const winner=data.featured&&typeof data.featured==='object'?data.featured:null;
  if(!winner){if(body)body.hidden=true;if(blank)blank.hidden=false;featured.hidden=false;return;}
  const frame=featured.querySelector('[data-featured-photo]');
  if(frame){
   if(winner.photo_url){const img=el('img');img.src=winner.photo_url;img.alt=`${winner.name||'Member'} profile picture`;img.loading='lazy';img.width=88;img.height=88;frame.replaceChildren(img);}
   else frame.replaceChildren(el('span',(winner.name||'M').trim().charAt(0).toUpperCase()||'M'));
  }
  const name=featured.querySelector('[data-featured-name]');if(name)name.textContent=winner.name||'Somebody on the ROOSTER';
  const when=featured.querySelector('[data-featured-week]');
  if(when){const start=day(data.featured_week_start);when.textContent=start?`Had the top roster for the week of ${start}.`:'Had the top roster last week.';}
  const total=featured.querySelector('[data-featured-count]');
  if(total)total.textContent=`${count(winner.visitors)} visitor${winner.visitors===1?'':'s'} that week`;
  const link=featured.querySelector('[data-featured-link]');
  if(link){link.href=winner.profile_url||'/people.html';link.textContent='View Their Page';}
  const chart=featured.querySelector('[data-featured-chart]');if(chart)chart.href=data.chart_url||'/top25.html';
  if(blank)blank.hidden=true;if(body)body.hidden=false;
  featured.hidden=false;
 }

 /** Private to the member reading it: their own finished week. */
 let pending=null;
 async function showRecap(){
  if(!recap)return;
  const line=recap.querySelector('[data-recap-line]'),figures=recap.querySelector('[data-recap-figures]');
  let data=null;
  try{data=await call('/api/visitors/recap');}catch{recap.hidden=true;return;}
  const start=day(data.week_start),spot=Number.isSafeInteger(data.position)&&data.position>0?data.position:0;
  if(line){
   line.replaceChildren();
   const visitors=`${count(data.visitors)} visitor${data.visitors===1?'':'s'}`;
   line.append(`Last week${start?` (from ${start})`:''} your page counted `,el('strong',visitors),'. ');
   if(data.made_chart&&spot){const to=el('a',`You finished #${spot} on the Top Rosters.`);to.href=data.chart_url||'/top25.html';line.append(to);}
   else line.append(`You did not make the top ${count(data.chart_size)} that week.`);
  }
  const now=data.current&&typeof data.current==='object'?data.current:null;
  if(figures&&now){
   const set=(name,value)=>{const cell=recap.querySelector(`[data-recap-${name}]`);if(cell)cell.textContent=count(value);};
   set('today',now.today);set('week',now.this_week);set('all',now.all_time);
   figures.hidden=false;
  }else if(figures)figures.hidden=true;
  recap.hidden=false;
 }
 function queueRecap(){
  clearTimeout(pending);
  pending=setTimeout(()=>{void showRecap();},250);
 }
 void showFeatured();
 queueRecap();
 window.addEventListener('jwhite:session-changed',queueRecap);
})();
