// Manage Media: one list of everything a member has uploaded, with tick boxes
// so several photos and videos can be removed in one go. The site owner can
// also load another member's uploads here to take down anything inappropriate.
const MAX_BATCH = 20;
// Unanchored on purpose: the admin can paste a bare member ID or a whole
// link to their profile page and the ID is picked out of it.
const MEMBER_REF = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HASH = /^[a-f0-9]{64}$/;

export function createMemberMedia() {
 const root=document.getElementById('member-media-manage');if(!root)return{setUser(){}};
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const intro=node('p','Tick the photos and videos you want gone, then tap Remove Selected. Anything you remove leaves your profile, your photos, the wall and the video section straight away. Undo is offered for a few seconds.','media-manage-intro');
 const toolbar=node('div','','media-manage-toolbar');
 const selectAll=node('button','Select All'),clear=node('button','Clear'),removeAll=node('button','Remove Selected','media-manage-remove'),refresh=node('button','Refresh');
 selectAll.type=clear.type=removeAll.type=refresh.type='button';
 const count=node('span','Nothing selected.','media-manage-count');
 toolbar.append(selectAll,clear,removeAll,refresh,count);
 const status=node('p','','media-manage-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const admin=node('div','','media-manage-admin');admin.hidden=true;
 const lookupLabel=node('label','Manage somebody else on the roster (member ID or profile link)');
 const lookup=node('input');lookup.type='text';lookup.autocomplete='off';lookup.placeholder='Paste a member ID or profile link';
 const open=node('button','Open Their Media');open.type='button';
 const back=node('button','Back to My Media');back.type='button';back.hidden=true;
 lookupLabel.append(lookup);admin.append(lookupLabel,open,back);
 const photoGroup=node('section','','media-manage-group'),photoHeading=node('h4','Photos'),photoGrid=node('div','','media-manage-grid'),photoEmpty=node('p','','media-manage-empty');
 photoGroup.append(photoHeading,photoEmpty,photoGrid);
 const videoGroup=node('section','','media-manage-group'),videoHeading=node('h4','Videos'),videoGrid=node('div','','media-manage-grid'),videoEmpty=node('p','','media-manage-empty');
 videoGroup.append(videoHeading,videoEmpty,videoGrid);
 root.append(intro,admin,toolbar,status,photoGroup,videoGroup);

 let user=null,epoch=0,busy=false,target=null,isAdmin=false,items=[],picked=new Set(),videos=[];
 const key=item=>`${item.kind}:${item.id}`;
 const media=()=>window.RosterMedia||null;
 const say=text=>{status.textContent=text;};
 function tally() {
  const chosen=picked.size;
  count.textContent=chosen?`${chosen} selected.${chosen>MAX_BATCH?` Remove up to ${MAX_BATCH} at a time.`:''}`:'Nothing selected.';
  removeAll.disabled=busy||!chosen;
  selectAll.disabled=busy||!items.length||chosen===items.length;
  clear.disabled=busy||!chosen;
 }
 function releaseVideos() {videos.forEach(video=>{video.pause();video.removeAttribute('src');video.load();});videos=[];}
 function card(item) {
  const figure=node('figure','','media-manage-card'),pick=node('label','','media-manage-pick'),box=node('input');
  box.type='checkbox';box.checked=picked.has(key(item));
  const title=item.kind==='photo'?(item.caption||'Photo'):(item.caption||item.name||'Video');
  pick.append(box,node('span',title.length>60?`${title.slice(0,60)}…`:title));
  figure.dataset.selected=String(box.checked);
  box.addEventListener('change',()=>{
   if(box.checked)picked.add(key(item));else picked.delete(key(item));
   figure.dataset.selected=String(box.checked);tally();
  });
  figure.append(pick);
  if(item.kind==='photo'){const img=node('img');img.src=item.url;img.alt=item.caption||'Your uploaded photo';img.loading='lazy';img.addEventListener('error',()=>{img.hidden=true;});figure.append(img);}
  else {
   if(item.status&&item.status!=='approved')figure.append(node('span',item.status==='pending'?'Waiting for review':'Not approved','media-manage-state'));
   const video=node('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=item.video_url;
   video.setAttribute('aria-label',`Video: ${title}`);video.addEventListener('error',()=>{video.hidden=true;});
   videos.push(video);figure.append(video);
  }
  const when=Date.parse(item.created_at);
  figure.append(node('p',Number.isFinite(when)?new Date(when).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'','media-manage-note'));
  media()?.attach(figure,{kind:item.kind,id:item.id,member_id:item.member_id},handlers());
  return figure;
 }
 function handlers() {
  const current=epoch;
  return {onStatus:text=>{if(current===epoch)say(text);},onBusy:flag=>{if(current!==epoch)return;busy=flag;refresh.disabled=flag;tally();},
   onChanged:()=>{if(current===epoch)void load();}};
 }
 function render() {
  releaseVideos();
  const photos=items.filter(item=>item.kind==='photo'),clips=items.filter(item=>item.kind==='video');
  photoGrid.replaceChildren(...photos.map(card));
  videoGrid.replaceChildren(...clips.map(card));
  photoEmpty.textContent=photos.length?'':'No photos here yet.';
  videoEmpty.textContent=clips.length?'':'No videos here yet.';
  photoEmpty.hidden=Boolean(photos.length);videoEmpty.hidden=Boolean(clips.length);
  tally();
 }
 async function request(path,options={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try {
   const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
   const data=await response.json().catch(()=>null);
   if(!response.ok)throw new Error(data?.error||'Your photos and videos could not load.');
   return data;
  }finally{clearTimeout(timer);}
 }
 async function load() {
  if(!user)return;
  const current=epoch;refresh.disabled=true;say('Loading your photos and videos…');
  try {
   const data=await request(`/api/media/manage${target&&target!==user.id?`?member=${encodeURIComponent(target)}`:''}`);
   if(current!==epoch)return;
   isAdmin=data.is_admin===true;admin.hidden=!isAdmin;back.hidden=!target||target===user.id;
   const photos=(Array.isArray(data.photos)?data.photos:[]).filter(photo=>HASH.test(photo?.id||'')&&typeof photo.url==='string'&&photo.url.startsWith('/api/member-album-photo/'));
   const clips=(Array.isArray(data.videos)?data.videos:[]).filter(clip=>HASH.test(clip?.id||'')&&clip.video_url===`/api/clip-video/${clip.id}`);
   items=[...photos.map(photo=>({...photo,kind:'photo',member_id:photo.member_id||data.member_id})),
    ...clips.map(clip=>({...clip,kind:'video',member_id:clip.member_id||data.member_id}))];
   const live=new Set(items.map(key));
   picked=new Set([...picked].filter(entry=>live.has(entry)));
   render();
   const owned=data.member_id===user.id;
   say(items.length
    ? `${items.length} item${items.length===1?'':'s'}. ${owned?'Tick anything you want gone, then tap Remove Selected.':'You are managing somebody else’s uploads as the admin.'}`
    : owned?'You have not uploaded any photos or videos yet.':'This page has not uploaded any photos or videos.');
  }catch(error){if(current===epoch){items=[];picked=new Set();render();say(error.message);}}
  finally{if(current===epoch)refresh.disabled=false;}
 }
 function chosenItems() {return items.filter(item=>picked.has(key(item))).slice(0,MAX_BATCH);}
 removeAll.addEventListener('click',async()=>{
  if(busy||!picked.size)return;
  const helper=media();
  if(!helper){say('Refresh the page and try again.');return;}
  const chosen=chosenItems();
  if(picked.size>MAX_BATCH)say(`Removing the first ${MAX_BATCH} of ${picked.size} selected items.`);
  await helper.remove(chosen.map(item=>({kind:item.kind,id:item.id,member_id:item.member_id})),handlers()).catch(()=>{});
 });
 selectAll.addEventListener('click',()=>{picked=new Set(items.map(key));render();});
 clear.addEventListener('click',()=>{picked=new Set();render();});
 refresh.addEventListener('click',()=>{if(!busy)void load();});
 open.addEventListener('click',()=>{
  if(busy||!isAdmin)return;
  const found=(lookup.value.match(MEMBER_REF)||[])[0];
  if(!found){say('Paste a member ID or a link to their profile page.');return;}
  target=found.toLowerCase();picked=new Set();void load();
 });
 back.addEventListener('click',()=>{if(busy)return;target=user?.id||null;picked=new Set();lookup.value='';void load();});
 return {setUser(value) {
  if(user?.id===value?.id)return;
  epoch++;user=value;busy=false;target=value?.id||null;isAdmin=false;items=[];picked=new Set();
  lookup.value='';admin.hidden=true;back.hidden=true;releaseVideos();
  photoGrid.replaceChildren();videoGrid.replaceChildren();
  photoEmpty.hidden=videoEmpty.hidden=true;tally();
  status.textContent=user?'':'Log in to manage your photos and videos.';
  if(user)void load();
 }};
}
