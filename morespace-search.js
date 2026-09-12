// ROOSTER Search. One search box, two clear choices: ROOSTER SEARCH
// reads our own endpoint and shows members, profiles and songs on this page,
// and GOOGLE SEARCH sends the member's exact words to Google's own results
// page in a new tab. Google.com is never put in a frame, and no search API
// key is used anywhere on this page.
(() => {
 'use strict';
 const form=document.getElementById('morespace-form');
 if(!form)return;
 const input=document.getElementById('morespace-query');
 const rosterList=document.getElementById('morespace-roster-results');
 const rosterNote=document.getElementById('morespace-roster-note');
 const rosterMore=document.getElementById('morespace-roster-more');
 const googleButton=document.getElementById('morespace-google-button');
 const googleOpen=document.getElementById('morespace-google-open');
 const googleNote=document.getElementById('morespace-google-note');
 const googleResults=document.getElementById('morespace-google-results');
 const ENGINE_ID=/^[A-Za-z0-9][A-Za-z0-9_:-]{3,62}[A-Za-z0-9]$/;
 // The one sentence this page shows when Google results are not inside ROOSTER
 const GOOGLE_UNAVAILABLE='Google results are not available inside ROOSTER yet. Use Search Google to see your results.';
 let searching=false,offset=0,query='',engine=null;

 const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
 const clean=value=>(value||'').replace(/\s+/g,' ').trim().slice(0,80);
 // Google's own results page, with exactly the words that were typed.
 const googleLink=words=>`https://www.google.com/search?q=${encodeURIComponent(words)}`;

 async function request(path){
  const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),15_000);
  try{
   const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:stop.signal,headers:{Accept:'application/json'}});
   return{status:response.status,ok:response.ok,data:await response.json().catch(()=>null)};
  }catch{return{status:0,ok:false,data:null};}
  finally{clearTimeout(timer);}
 }

 function rosterCard(result){
  const item=el('li','morespace-result');
  if(result.photo_url&&result.kind==='member'){
   const photo=el('img','morespace-result-photo');
   photo.src=result.photo_url;photo.alt=result.title;photo.loading='lazy';photo.width=56;photo.height=56;
   item.append(photo);
  }
  const body=el('div','morespace-result-body');
  body.append(el('h3','morespace-result-title',result.title));
  const meta=el('p','morespace-result-meta',result.subtitle||'');
  if(result.verified)meta.append(el('span','morespace-verified',' · Verified'));
  body.append(meta);
  if(result.description)body.append(el('p','morespace-result-text',result.description));
  const open=el('a','morespace-open',result.open_label||'Open in ROOSTER');
  open.href=result.open_url;
  body.append(open);
  item.append(body);
  return item;
 }

 // Keeps both Google buttons pointed at the exact words in the box, so a tap
 // is an ordinary link opening in a new tab rather than a blocked pop-up.
 function pointGoogleAt(words){
  const href=words?googleLink(words):'https://www.google.com/';
  for(const link of [googleButton,googleOpen]){
   if(!link)continue;
   link.href=href;
   link.setAttribute('aria-label',words?`Search Google for ${words}, opens in a new tab`:'Open Google in a new tab');
  }
 }

 async function loadRoster(append=false){
  if(!append){rosterList.replaceChildren();offset=0;}
  rosterNote.textContent='Searching ROOSTER…';
  rosterMore.hidden=true;
  const {ok,data}=await request(`/api/morespace/roster?q=${encodeURIComponent(query)}&offset=${offset}`);
  if(!ok||!data||!Array.isArray(data.results)){rosterNote.textContent=data?.error||'ROOSTER results could not load. Please try again.';return;}
  for(const result of data.results)rosterList.append(rosterCard(result));
  const total=Number.isSafeInteger(data.total)?data.total:rosterList.children.length;
  rosterNote.textContent=total===0
   ?(query?`Nothing on ROOSTER matched “${query}” yet.`:'Search the roster for a name, a page or a song.')
   :`${total} ${total===1?'result':'results'} on ROOSTER`;
  if(Number.isSafeInteger(data.next_offset)){offset=data.next_offset;rosterMore.hidden=false;}
 }

 /* Google Programmable Search Engine, loaded only when the site has a real
    engine ID. Google renders and hosts the results itself; nothing here scrapes
    Google, frames google.com, or calls a search API. */
 function mountGoogleEngine(id){
  if(document.getElementById('morespace-google-engine'))return true;
  const script=el('script');
  script.id='morespace-google-engine';
  script.async=true;
  script.src=`https://cse.google.com/cse.js?cx=${encodeURIComponent(id)}`;
  script.addEventListener('error',()=>{googleNote.textContent=GOOGLE_UNAVAILABLE;googleResults.hidden=true;});
  const box=el('div','gcse-searchresults-only');
  box.setAttribute('data-queryParameterName','q');
  box.setAttribute('data-enableHistory','false');
  googleResults.replaceChildren(box);
  document.head.append(script);
  return true;
 }

 function runGoogleEngine(words){
  googleResults.hidden=false;
  try{
   const element=window.google?.search?.cse?.element?.getElement('searchresults-only0');
   if(element&&words)element.execute(words);
  }catch{/* Google's own element runs the query from the address bar instead. */}
 }

 async function loadGoogle(){
  if(!googleNote)return;
  const {ok,data}=await request(`/api/morespace/google?q=${encodeURIComponent(query)}`);
  const id=ok&&data&&data.configured===true&&typeof data.engine_id==='string'&&ENGINE_ID.test(data.engine_id)?data.engine_id:null;
  if(!id){
   // Nothing about providers, keys or settings is ever shown to a visitor.
   engine=null;
   googleResults.hidden=true;
   googleResults.replaceChildren();
   googleNote.textContent=GOOGLE_UNAVAILABLE;
   return;
  }
  engine=id;
  mountGoogleEngine(id);
  googleNote.textContent=query
   ?`Google results for “${query}”, shown by Google inside ROOSTER.`
   :'Google results appear here once you search.';
  runGoogleEngine(query);
 }

 async function search(next){
  if(searching)return;
  query=clean(next);
  if(input)input.value=query;
  pointGoogleAt(query);
  searching=true;
  try{
   const url=new URL(window.location.href);
   if(query)url.searchParams.set('q',query);else url.searchParams.delete('q');
   window.history.replaceState(null,'',url);
  }catch{/* Keeping the query in the address bar is a convenience, not a requirement. */}
  try{await Promise.all([loadRoster(),loadGoogle()]);}
  finally{searching=false;}
 }

 form.addEventListener('submit',event=>{event.preventDefault();void search(input?.value||'');});
 input?.addEventListener('input',()=>pointGoogleAt(clean(input.value)));
 // An empty box has nothing to send to Google, so ask for words first.
 for(const link of [googleButton,googleOpen]){
  link?.addEventListener('click',event=>{
   const words=clean(input?.value||'');
   if(!words){event.preventDefault();rosterNote.textContent='Type what you are looking for, then choose ROOSTER SEARCH or GOOGLE SEARCH.';input?.focus();return;}
   pointGoogleAt(words);
  });
 }
 rosterMore.addEventListener('click',()=>void loadRoster(true));
 const startQuery=new URL(window.location.href).searchParams.get('q')||'';
 pointGoogleAt(clean(startQuery));
 void search(startQuery);
})();
