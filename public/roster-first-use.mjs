// Short first-use lessons. Progress stays on this browser; no tracking request.
export const TIP_KEY='roster-first-use-v1';
export const TIPS={
 slots:['WYD','This is the community feed: videos, photos, conversations, music and sports. Scroll to see what’s happening next.'],
 following:['Following','See posts from the people you follow. Find more people in Discover.'],
 for_you:['For You','Explore community posts, music, sports and ROOSTER video promos. Pause motion whenever you want.'],
 replies:['Replies','Read posts as a simple list and join a conversation. Tap Post to start your own.'],
 live_feed:['Live','Find rooms and live conversations happening on ROOSTER.'],
 profile:['Profiles','See what someone does, their Top 8, and what they share. Home takes you back to the community feed.'],
 profile_slots:['Posts','These are this person’s videos and posts. Tap Home for the full WYD feed.'],
 profile_music:['Profile Music','Listen to songs this person chose for their page. Music starts when you press play.'],
 photos:['Photos','Browse the photos shared on this page. Tap a photo to open it.'],
 about:['About','Read their bio, location and information about what they do.'],
 people:['Discover','Find real people on ROOSTER. Open a profile to learn about them or connect.'],
 inbox:['Inbox','Your private conversations live here. Tap New to message someone.'],
 new_message:['New message','Choose who you want to message, write your note, then send it privately.'],
 sent:['Sent','Find the messages you have sent.'],
 rooms:['Rooms','Join a live conversation or start a room. Allow the microphone when you want to talk.'],
 radio:['ORBIT Radio','Choose a channel, then press play. ORBIT is separate from personal profile music.'],
 booking:['Booking','Find services and people to book. Provider tools let you add services and manage your clients.'],
 opportunities:['Opportunities','Explore openings, collaborations and opportunities shared with the community.'],
 account:['Your account','Log in or manage your profile, uploads, music and account settings.'],
 post:['Post','Write what you want to share, choose who can see it, and tap Post.'],
 picture:['Take a Pic','Allow camera access, choose a filter, then tap the shutter. Review your picture before sharing.'],
 song:['Add a song','Add music to your personal profile here. Your songs and ORBIT Radio are separate.'],
 top8:['Your Top 8','Choose up to eight people for your page. Empty spot removes a pick. Tap Save Top 8 to keep your changes.'],
 manager:['ROOSTER Manager','Keep your songs, work and money records together. MONA, your AI Manager, can help explain your next step.'],
 stuff:['My Stuff','Keep your work organized here. Open an item to review or update it.'],
 money:['My Money','Track recorded earnings, payments and money still owed. These are your records, not a live bank balance.'],
 ai:['Co-Manager','Ask about your saved work and money records. Review its suggestions before acting.'],
};
const normalize=path=>path.replace(/\.html$/,'').replace(/\/$/,'')||'/';
export function tipForRoute(href,base='https://jwhitedidit.net/'){
 let url;try{url=new URL(href,base);if(url.origin!==new URL(base).origin)return null;}catch{return null;}
 const path=normalize(url.pathname),hash=url.hash;
 if(path==='/')return url.searchParams.get('camera')==='1'?'picture':url.searchParams.has('compose')?'post':url.searchParams.get('view')==='board'?'replies':'slots';
 if(['/profile','/my-profile','/jwhite'].includes(path))return 'profile';
 if(path==='/members')return /member-mail/.test(hash)?'inbox':/member-songs/.test(hash)?'song':/photo/.test(hash)?'photos':'account';
 if(['/photos','/member-photos'].includes(path))return 'photos';
 if(path.startsWith('/booking'))return 'booking';
 if(path==='/rcm')return ({'#income':'money','#money':'money','#help':'ai','#stuff':'stuff'})[hash]||'manager';
 return ({'/people':'people','/live':'rooms','/radio':'radio','/opportunities':'opportunities'})[path]||null;
}
export function tipForControl(data={},href='',base='https://jwhitedidit.net/'){
 if(data.profileTab)return ({posts:'profile_slots',songs:'profile_music',photos:'photos',about:'about'})[data.profileTab]||null;
 if(data.feedView)return data.feedView==='board'?(data.feedFilter==='rooms'?'live_feed':'replies'):data.feedView;
 if(data.managerView)return ({home:'manager',stuff:'stuff',money:'money',help:'ai'})[data.managerView]||null;
 if(data.mailGo)return ({inbox:'inbox',sent:'sent',compose:'new_message'})[data.mailGo]||null;
 if('topEightEdit' in data)return 'top8';
 if('slotsCamera' in data)return 'picture';
 if('openComposer' in data||'profileComposePost' in data)return 'post';
 return href?tipForRoute(href,base):null;
}
export function createTipProgress(storage){
 let seen=new Set(),disabled=false;
 try{const saved=JSON.parse(storage?.getItem(TIP_KEY)||'{}');seen=new Set(Array.isArray(saved.seen)?saved.seen.filter(key=>key in TIPS):[]);disabled=saved.disabled===true;}catch{}
 const persist=()=>{try{storage?.setItem(TIP_KEY,JSON.stringify({seen:[...seen],disabled}));}catch{}};
 return {shouldShow:key=>!!TIPS[key]&&!disabled&&!seen.has(key),remember(key){if(TIPS[key]){seen.add(key);persist();}},disable(){disabled=true;persist();},reset(){seen.clear();disabled=false;persist();}};
}
function start(){
 if(document.querySelector('[data-roster-first-use]'))return;
 let storage;try{storage=localStorage;}catch{}
 const progress=createTipProgress(storage);
 const coach=document.createElement('aside');coach.dataset.rosterFirstUse='';coach.className='roster-first-use';coach.hidden=true;coach.setAttribute('aria-label','ROOSTER first-time tip');
 coach.innerHTML='<div class="roster-tip-heading"><span>QUICK TIP</span><button type="button" data-tip-close aria-label="Close tip">×</button></div><div role="status" aria-live="polite"><h2></h2><p></p></div><div class="roster-tip-actions"><button type="button" data-tip-stop>Turn off tips</button><button type="button" data-tip-done>Got it</button></div>';
 document.body.appendChild(coach);
 let lastTrigger=null;
 function close(){coach.hidden=true;if(coach.contains(document.activeElement)&&lastTrigger?.isConnected)lastTrigger.focus({preventScroll:true});}
 function show(key,trigger){
  if(!progress.shouldShow(key))return;
  const modal=document.querySelector('dialog[open]');
  (modal||document.body).appendChild(coach);
  coach.classList.toggle('roster-tip-in-dialog',!!modal);
  coach.querySelector('h2').textContent=TIPS[key][0];coach.querySelector('p').textContent=TIPS[key][1];
  lastTrigger=trigger||null;coach.hidden=false;progress.remember(key);
 }
 coach.querySelector('[data-tip-close]').addEventListener('click',close);
 coach.querySelector('[data-tip-done]').addEventListener('click',close);
 coach.querySelector('[data-tip-stop]').addEventListener('click',()=>{progress.disable();close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!coach.hidden)close();});
 document.addEventListener('close',event=>{if(event.target.contains?.(coach)){close();document.body.appendChild(coach);}},true);
 document.addEventListener('click',event=>{
  const reset=event.target.closest('[data-roster-reset-tips]');
  if(reset){progress.reset();reset.closest('dialog')?.close();show(tipForRoute(location.href));return;}
  if(coach.contains(event.target)||event.target.closest('[data-roster-guide]'))return;
  const control=event.target.closest('a,button,[role="tab"]');
  if(!control||control.disabled||control.getAttribute('aria-disabled')==='true')return;
  const href=control.tagName==='A'?control.getAttribute('href'):'';
  // Only actual navigation or identified feature controls receive lessons.
  if(href&&!control.closest('nav,header,.slots-quick-compose,.profile-composer,.profile-slots-access,.roster-sheet-links,.profile-hero-actions')&&!control.hasAttribute('data-tip'))return;
  const key=control.dataset.tip||tipForControl(control.dataset,href,location.href);
  if(!progress.shouldShow(key))return;
  if(href){
   let next;try{next=new URL(href,location.href);}catch{return;}
   if(next.origin!==location.origin||control.target==='_blank'||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   if(normalize(next.pathname)!==normalize(location.pathname)){
    try{sessionStorage.setItem('roster-tip-pending',JSON.stringify({key,path:normalize(next.pathname),at:Date.now()}));}catch{}
    return;
   }
  }
  // Let a tab, camera or composer finish opening before placing its tip.
  setTimeout(()=>show(key,control),0);
 },true);
 let pending;
 try{pending=JSON.parse(sessionStorage.getItem('roster-tip-pending')||'null');sessionStorage.removeItem('roster-tip-pending');}catch{}
 const path=normalize(location.pathname);
 const redirectProfile=pending?.key==='profile'&&['/profile','/my-profile','/members'].includes(path);
 const key=pending&&Date.now()-pending.at<120000&&(pending.path===path||redirectProfile)?pending.key:tipForRoute(location.href);
 // Start once on arrival; hidden tabs wait until the person actually sees them.
 if(document.visibilityState==='hidden')document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')show(key);},{once:true});
 else setTimeout(()=>show(key),350);
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
