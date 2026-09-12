// ROOSTER NEWS. Every story shown here arrived from a publisher feed with
// its own headline, source name, date and link; this file only arranges what
// the server sends. It never writes a headline, a date, a deadline or a claim
// of its own, and it never presents old stories as new.
(() => {
 'use strict';
 const NEWS='/api/whats-happening';
 const OWNER='/api/whats-happening/owner';
 const CATEGORY={'All News':null,Music:'music',Culture:'culture',Events:'events',Opportunities:'opportunities','J.White':'jwhite'};
 const KIND={announcement:'Announcement',release:'Release',career:'Career news',opportunity:'Opportunity'};
 const CATEGORY_LABEL={music:'Music',culture:'Culture',events:'Events',opportunities:'Opportunities'};
 const FRONT_PAGE=6;
 const TICKER_LIMIT=8;
 let view=null,filter='All News',owner=false,signedIn=false;

 const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node;};
 const root=()=>document.querySelector('[data-whats-happening]');
 const promo=()=>document.querySelector('[data-group-announcement]');

 async function get(path){
  const stop=new AbortController();
  const timer=setTimeout(()=>stop.abort(),15000);
  try{
   const response=await fetch(path,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'},signal:stop.signal});
   const data=await response.json().catch(()=>null);
   return {ok:response.ok,status:response.status,data};
  }catch{return {ok:false,status:0,data:null};}
  finally{clearTimeout(timer);}
 }

 async function ownerPost(body){
  const response=await fetch(OWNER,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(data&&data.error?data.error:'That change could not be saved.');
  return data;
 }

 // Dates are shown exactly as the publisher dated the story.
 function published(value){
  const at=Date.parse(value);
  if(!Number.isFinite(at))return '';
  return new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
 }

 // A story is new only when the publisher's own date says so.
 function isFresh(value){
  const at=Date.parse(value);
  return Number.isFinite(at)&&Date.now()-at<36*3600*1000;
 }

 function paragraphs(text,cls){
  const wrap=el('div',cls);
  for(const line of String(text||'').split('\n')){
   const trimmed=line.trim();
   if(trimmed)wrap.append(el('p','',trimmed));
  }
  return wrap;
 }

 function updateLine(){
  if(view.update_state==='never')return 'No stories have been collected yet.';
  const when=published(view.last_updated_at);
  return view.update_state==='stale'
   ?`Last successful update ${when}. Nothing newer has come in, so these are still the stories from that update.`
   :`Updated ${when}. The featured picks change every Monday, Central time.`;
 }

 // A picture only appears when the publisher's own feed carried one.
 function storyPicture(story){
  if(!story.image||typeof story.image!=='string')return null;
  const frame=el('a','news-story-picture');
  frame.href=story.url;frame.target='_blank';frame.rel='noopener noreferrer';
  frame.setAttribute('tabindex','-1');
  frame.setAttribute('aria-hidden','true');
  const picture=el('img');
  picture.src=story.image;picture.alt='';picture.loading='lazy';picture.decoding='async';
  picture.addEventListener('error',()=>frame.remove());
  frame.append(picture);
  return frame;
 }

 // shape: 'lead' is the one big story, 'second' the two beside it, 'brief' the
 // headlines underneath. Every shape carries the same source and date.
 function storyCard(story,shape){
  const card=el('article','news-story news-'+(shape||'second'));
  if(shape==='lead'){const picture=storyPicture(story);if(picture)card.append(picture);}
  const labels=el('p','news-story-labels');
  if(isFresh(story.published_at))labels.append(el('span','news-fresh','NEW'));
  if(story.featured)labels.append(el('span','news-featured','Featured this week'));
  if(labels.children&&labels.children.length)card.append(labels);
  const heading=el(shape==='lead'?'h4':'h4','news-story-title');
  const link=el('a','',story.title);
  link.href=story.url;link.target='_blank';link.rel='noopener noreferrer';
  heading.append(link);
  const meta=el('p','news-story-meta');
  meta.append(el('span','news-category',CATEGORY_LABEL[story.category]||'News'));
  meta.append(el('span','news-source',story.source));
  const date=published(story.published_at);
  if(date)meta.append(el('span','news-date',date));
  card.append(heading,meta);
  // A brief is a headline, a source and a date. Only the top stories carry the
  // publisher's one or two sentence summary.
  if(shape!=='brief'&&story.summary)card.append(el('p','news-summary',story.summary));
  if(shape==='lead'){
   const read=el('a','news-story-open','Read at '+story.source+' ↗');
   read.href=story.url;read.target='_blank';read.rel='noopener noreferrer';
   card.append(read);
  }
  if(owner){
   const remove=el('button','news-owner-button','Remove this story');
   remove.type='button';
   remove.addEventListener('click',async()=>{
    remove.disabled=true;
    try{await ownerPost({action:'story_remove',id:story.id});await load();}
    catch(error){remove.disabled=false;status(error.message);}
   });
   card.append(remove);
  }
  return card;
 }

 function announcementCard(item){
  const card=el('article','news-announcement');
  card.append(el('span','news-kind',KIND[item.kind]||'Announcement'));
  card.append(el('h4','news-story-title',item.title));
  const meta=el('p','news-story-meta');
  meta.append(el('span','news-source','J.White Did It'));
  const date=published(item.published_at);
  if(date)meta.append(el('span','news-date',date));
  // An opportunity that has closed says so instead of still reading as open.
  if(item.open===false)meta.append(el('span','news-closed','Closed'));
  else if(item.open===true)meta.append(el('span','news-open','Open'));
  card.append(meta,paragraphs(item.body,'news-announcement-body'));
  if(item.url){
   const link=el('a','news-story-open','Open link ↗');
   link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
   card.append(link);
  }
  if(owner){
   const remove=el('button','news-owner-button','Delete announcement');
   remove.type='button';
   remove.addEventListener('click',async()=>{
    remove.disabled=true;
    try{await ownerPost({action:'announcement_delete',id:item.id});await load();}
    catch(error){remove.disabled=false;status(error.message);}
   });
   card.append(remove);
  }
  return card;
 }

 function status(message){
  const note=root()&&root().querySelector('[data-news-status]');
  if(note)note.textContent=message;
 }

 function filters(container){
  const bar=el('div','news-filters');
  bar.setAttribute('role','group');
  bar.setAttribute('aria-label','Filter ROOSTER News');
  for(const label of view.filters||Object.keys(CATEGORY)){
   const button=el('button','news-filter',label);
   button.type='button';
   button.dataset.newsFilter=label;
   button.setAttribute('aria-pressed',String(label===filter));
   if(label===filter)button.classList.add('is-on');
   button.addEventListener('click',()=>{filter=label;expanded=false;render();});
   bar.append(button);
  }
  container.append(bar);
 }

 // Owner tools live behind the server's own owner check and are only ever
 // added to the page for that account.
 function ownerTools(container){
  const box=el('details','news-owner-tools');
  box.append(el('summary','','Owner controls'));
  const form=el('form','news-owner-form');
  const field=(labelText,name,type,limit,required)=>{
   const label=el('label','',labelText);
   const input=el(type==='textarea'?'textarea':'input');
   input.name=name;
   if(type!=='textarea')input.type=type;
   if(limit)input.maxLength=limit;
   if(required)input.required=true;
   label.append(input);
   form.append(label);
   return input;
  };
  const kind=el('select');
  kind.name='kind';
  for(const [value,label] of Object.entries(KIND)){
   const option=el('option','',label);
   option.value=value;
   kind.append(option);
  }
  const kindLabel=el('label','','Kind');
  kindLabel.append(kind);
  form.append(kindLabel);
  // Held as references: a form's own named lookup is not worth relying on.
  const titleInput=field('Headline','title','text',160,true);
  const bodyInput=field('What you want people to know','body','textarea',1200,true);
  const urlInput=field('Link (optional)','url','url',300,false);
  const closesInput=field('Closes on (optional)','closes_at','date',0,false);
  const save=el('button','member-primary','Post announcement');
  save.type='submit';
  const note=el('p','news-owner-note');
  note.setAttribute('role','status');
  form.append(save,note);
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   save.disabled=true;
   note.textContent='Saving…';
   try{
    await ownerPost({action:'announcement_save',kind:kind.value,title:titleInput.value,body:bodyInput.value,url:urlInput.value,closes_at:closesInput.value});
    note.textContent='Posted.';
    form.reset();
    await load();
   }catch(error){note.textContent=error.message;save.disabled=false;}
  });
  box.append(form);

  const pinned=el('div','news-owner-pin');
  const pinNote=el('p','news-owner-note');
  pinNote.setAttribute('role','status');
  const toggle=el('button','member-secondary',view.promotion?'Remove the pinned announcement':'Put the pinned announcement back');
  toggle.type='button';
  toggle.addEventListener('click',async()=>{
   toggle.disabled=true;
   pinNote.textContent='Saving…';
   try{
    await ownerPost({action:view.promotion?'promotion_remove':'promotion_save'});
    await load();
   }catch(error){pinNote.textContent=error.message;toggle.disabled=false;}
  });
  pinned.append(toggle,pinNote);
  box.append(pinned);
  container.append(box);
 }

 // The trending bar carries only real headlines, newest first, and each one
 // opens the publisher's own page.
 function ticker(stories){
  if(!stories.length)return null;
  const bar=el('div','news-ticker');
  bar.setAttribute('aria-label','Trending headlines');
  const track=el('div','news-ticker-track');
  track.append(el('span','news-ticker-label','TRENDING'));
  for(const story of stories.slice(0,TICKER_LIMIT)){
   const link=el('a','news-ticker-item',story.title);
   link.href=story.url;link.target='_blank';link.rel='noopener noreferrer';
   track.append(link);
  }
  bar.append(track);
  return bar;
 }

 // The front page: one lead story, two beside it, three headlines underneath.
 // Never more than six at once, and the rest wait behind the More button.
 function frontPage(list,stories){
  const shown=expanded?stories:stories.slice(0,FRONT_PAGE);
  const grid=el('div','news-grid');
  grid.append(storyCard(shown[0],'lead'));
  const side=el('div','news-side');
  for(const story of shown.slice(1,3))side.append(storyCard(story,'second'));
  if(side.children&&side.children.length)grid.append(side);
  list.append(grid);
  const rest=shown.slice(3);
  if(rest.length){
   const strip=el('div','news-strip');
   for(const story of rest)strip.append(storyCard(story,'brief'));
   list.append(strip);
  }
  const hidden=stories.length-shown.length;
  if(hidden>0){
   const more=el('button','news-more','MORE ROOSTER NEWS');
   more.type='button';
   more.setAttribute('aria-label',`More ROOSTER news, ${hidden.toLocaleString()} more stories`);
   more.addEventListener('click',()=>{expanded=true;render();});
   list.append(more);
  }else if(expanded&&stories.length>FRONT_PAGE){
   const less=el('button','news-more','BACK TO THE FRONT PAGE');
   less.type='button';
   less.addEventListener('click',()=>{expanded=false;render();});
   list.append(less);
  }
 }

 const STORY_PREVIEW=FRONT_PAGE;
 let expanded=false;
 function render(){
  const container=root();
  if(!container||!view)return;
  container.replaceChildren();
  const head=el('div','news-head');
  head.append(el('h3','news-heading',view.heading),el('p','news-description',view.description));
  const note=el('p','news-update');
  note.dataset.newsStatus='';
  note.setAttribute('role','status');
  note.textContent=updateLine();
  head.append(note);
  container.append(head);
  const trending=ticker(view.stories.slice().sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)));
  if(trending)container.append(trending);
  filters(container);

  const list=el('div','news-list');
  if(filter==='J.White'){
   if(view.announcements.length)for(const item of view.announcements)list.append(announcementCard(item));
   else list.append(el('p','news-empty','No announcements from J.White right now.'));
  }else{
   const wanted=CATEGORY[filter];
   const stories=view.stories.filter(story=>!wanted||story.category===wanted);
   if(filter==='All News'&&view.announcements.length){
    const own=el('section','news-jwhite');
    own.append(el('h4','news-jwhite-heading','From J.White Did It'));
    for(const item of view.announcements.slice(0,3))own.append(announcementCard(item));
    list.append(own);
   }
   if(stories.length)frontPage(list,stories);
   else list.append(el('p','news-empty',view.update_state==='never'
    ?'Stories will appear here as soon as the first update comes in.'
    :'Nothing under this filter in the latest update.'));
  }
  container.append(list);

  if(view.sources&&view.sources.length){
   const sources=el('p','news-sources');
   sources.append(el('span','','Sources: '));
   view.sources.forEach((source,index)=>{
    if(index)sources.append(document.createTextNode(', '));
    const link=el('a','',source.source);
    link.href=source.home;link.target='_blank';link.rel='noopener noreferrer';
    sources.append(link);
   });
   container.append(sources);
  }
  if(owner)ownerTools(container);
 }

 // The pinned announcement is never rotated out with the weekly stories. It
 // stays until the owner turns it off.
 function renderPromotion(){
  const container=promo();
  if(!container||!view)return;
  container.replaceChildren();
  const promotion=view.promotion;
  if(!promotion){container.hidden=true;return;}
  container.hidden=false;
  container.append(el('h3','group-heading',promotion.heading));
  container.append(paragraphs(promotion.body,'group-body'));
  if(promotion.badges.length){
   const badges=el('ul','group-badges');
   for(const badge of promotion.badges)badges.append(el('li','group-badge',badge));
   container.append(badges);
  }
  const action=el('a','member-primary group-action');
  if(signedIn){
   // Already a member: send them to their own music, not to a second account.
   action.textContent=promotion.signed_in_label;
   action.href='/members.html#member-songs-root';
   action.addEventListener('click',event=>{
    if(window.RosterFrontDoor&&window.RosterFrontDoor.openMusic){event.preventDefault();window.RosterFrontDoor.openMusic();}
   });
  }else{
   action.textContent=promotion.button_label;
   action.href='/members.html#member-signup';
   action.addEventListener('click',event=>{
    if(window.RosterFrontDoor&&window.RosterFrontDoor.openSignup){event.preventDefault();window.RosterFrontDoor.openSignup();}
   });
  }
  container.append(action);
  // Making a page is not an audition, and it is not a promise.
  container.append(el('p','group-note',promotion.note));
  container.append(el('p','group-note','Making a ROOSTER page adds your music to your own page. It is not an audition submission.'));
 }

 async function load(){
  const result=await get(NEWS);
  if(!result.ok||!result.data||typeof result.data!=='object'||!Array.isArray(result.data.stories)){
   // Keep whatever was last shown rather than replacing real stories with nothing.
   if(view)status('ROOSTER News could not refresh just now. These are the stories from the last successful update.');
   else{
    const container=root();
    if(container){
     container.replaceChildren();
     const head=el('div','news-head');
     head.append(el('h3','news-heading','ROOSTER NEWS'),el('p','news-description','Music, culture, events and opportunities.'));
     const note=el('p','news-update','ROOSTER News could not load right now. Nothing here has been made up in its place.');
     note.dataset.newsStatus='';
     head.append(note);
     container.append(head);
    }
   }
   return;
  }
  view=result.data;
  view.announcements=Array.isArray(view.announcements)?view.announcements:[];
  view.stories=Array.isArray(view.stories)?view.stories:[];
  render();
  renderPromotion();
 }

 async function session(){
  const result=await get('/api/profile/me');
  signedIn=!!(result.ok&&result.data&&result.data.profile);
  owner=!!(result.ok&&result.data&&result.data.can_edit_owner===true);
 }

 async function start(){
  if(!root()&&!promo())return;
  await session();
  await load();
 }

 window.RosterNews={refresh:load,reload:start};
 start();
})();
