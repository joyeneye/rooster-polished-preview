import {prepareAlbumPhoto} from './album-photo-helper.js';
import {openPhotoFilterEditor} from './photo-filter-editor.js';
import {photoEffectsLabel} from './photo-effects.js';
import {openRosterCamera} from './roster-camera.js?v=20260912-centered-camera-v5';
const MAX_PHOTOS=10;
export function createMemberAlbum() {
 const root=document.getElementById('member-photo-album');if(!root)return{setUser(){}};
 const input=document.getElementById('member-album-files'),camera=document.getElementById('member-album-camera'),send=document.getElementById('member-album-upload'),status=document.getElementById('member-album-status'),grid=document.getElementById('member-album-grid');
 const intro=root.querySelector('p');if(intro&&intro!==status)intro.textContent='Take a new picture with visible filters, or choose pictures from your library. Your public album holds up to 10 photos.';
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const selection=node('div');selection.id='member-album-selection';selection.className='album-upload-selection';send.before(selection);
 const more=node('button','Show More Photos');more.type='button';more.hidden=true;grid.after(more);
 let user=null,busy=false,epoch=0,offset=0,next=null,total=0,selected=[],urls=[],editingAbort=null;
 function cleanSelection(){editingAbort?.abort();editingAbort=null;urls.forEach(u=>URL.revokeObjectURL(u));urls=[];selected=[];selection.replaceChildren();}
 function updateControls(){const blocked=!user||busy||total>=MAX_PHOTOS;if(camera)camera.disabled=blocked;input.disabled=blocked;send.disabled=blocked||!!editingAbort||!selected.length;}
 async function request(path,options={}) {const c=new AbortController(),timer=setTimeout(()=>c.abort(),30000);try {const r=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:c.signal});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.error||'Your photos could not connect.');return d;}finally{clearTimeout(timer);}}
 function card(p) {
  const fig=node('figure'),a=node('a'),img=node('img'),caption=node('figcaption',p.caption||''),actions=node('div');caption.className='album-caption';actions.className='album-photo-actions';a.href=p.url;a.target='_blank';a.rel='noopener';img.src=p.url;img.alt=p.caption||'Your uploaded photo';img.loading='lazy';a.append(img);
  const edit=node('button','Edit Caption'),filters=node('button','Filters');edit.type=filters.type='button';filters.disabled=total>=MAX_PHOTOS;actions.append(edit,filters);
  // Delete stays visible on the picture itself for the member who owns it.
  const made=epoch;
  window.RosterMedia?.attach(fig,{kind:'photo',id:p.id,member_id:user?.id},{
   onStatus(text){if(made===epoch)status.textContent=text;},
   onBusy(flag){if(made!==epoch)return;busy=flag;updateControls();},
   onChanged(){if(made===epoch)void refresh();},
  });
  filters.addEventListener('click',async()=>{
   if(!user||busy)return;if(total>=MAX_PHOTOS){status.textContent='Your album has 10 photos. Remove one before saving a filtered copy.';return;}const current=epoch;busy=true;filters.disabled=true;const controller=new AbortController();editingAbort=controller;updateControls();status.textContent='Opening photo filters…';let timer;
   try{
    const url=new URL(p.url,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith('/api/member-album-photo/'))throw new Error('Open a photo from your album.');
    timer=setTimeout(()=>controller.abort(),20000);const response=await fetch(url.href,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('This photo could not load. Try again.');const blob=await response.blob();clearTimeout(timer);if(current!==epoch)return;
    const result=await openPhotoFilterEditor(new File([blob],'album-photo.jpg',{type:blob.type}),{signal:controller.signal,title:'Edit Photo Filters',applyLabel:'Save Filtered Copy'});if(current!==epoch)return;if(!result){status.textContent='Original photo unchanged.';return;}
    const body=new FormData();body.set('photo',result.file);body.set('caption',caption.textContent);const saved=await request('/api/member-album/upload',{method:'POST',body});if(current!==epoch)return;busy=false;await refresh();status.textContent=saved.duplicate?'This picture is already in your album.':'Filtered copy saved. Your original photo and caption are still in your album.';
   }catch(e){if(current===epoch)status.textContent=e.name==='AbortError'?'Photo editing canceled. Your original is unchanged.':e.message;}finally{clearTimeout(timer);if(current===epoch){busy=false;filters.disabled=!user||total>=MAX_PHOTOS;editingAbort=null;updateControls();}}
  });fig.append(caption,a,actions);
  const form=node('form'),label=node('label','Photo caption'),text=node('textarea'),save=node('button','Save Caption'),cancel=node('button','Cancel'),feedback=node('p');text.maxLength=500;text.rows=2;text.value=p.caption||'';text.dataset.photoCaption='true';label.append(text);save.type='submit';cancel.type='button';feedback.setAttribute('role','status');form.append(label,save,cancel,feedback);form.hidden=true;fig.append(form);
  edit.addEventListener('click',()=>{form.hidden=false;text.value=caption.textContent;feedback.textContent='';text.focus();});cancel.addEventListener('click',()=>{form.hidden=true;edit.focus();});
  form.addEventListener('submit',async event=>{event.preventDefault();if(!user||busy||save.disabled)return;const current=epoch;save.disabled=true;feedback.textContent='Saving caption…';try{const d=await request('/api/member-album/caption',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo_id:p.id,caption:text.value})});if(current!==epoch)return;caption.textContent=d.photo.caption||'';img.alt=caption.textContent||'Your uploaded photo';form.hidden=true;status.textContent='Caption saved.';edit.focus();}catch(e){if(current===epoch)feedback.textContent=e.message;}finally{save.disabled=false;}});
  return fig;
 }
 async function refresh(append=false) {if(!user)return;const current=epoch;more.disabled=true;if(!append)offset=0;try{const d=await request(`/api/member-album?limit=${MAX_PHOTOS}&offset=${offset}`);if(epoch!==current)return;total=Number.isSafeInteger(d.total)?Math.min(MAX_PHOTOS,d.total):Math.min(MAX_PHOTOS,d.photos.length);if(!append)grid.replaceChildren();grid.append(...d.photos.map(card));next=d.next_offset;more.hidden=!Number.isSafeInteger(next);if(!busy)status.textContent=total>=MAX_PHOTOS?'10 of 10 photos. Remove one before adding another.':`${total} of 10 photos. Add or edit a caption on any picture.`;updateControls();}catch(e){if(epoch===current)status.textContent=e.message;}finally{more.disabled=false;}}
 function addSelection(file,{prepared=null,effects=null}={}) {
  const index=selected.length,fig=node('figure'),img=node('img'),label=node('label',`Caption for photo ${index+1}`),text=node('textarea');
  const shown=prepared||file,url=URL.createObjectURL(shown);urls.push(url);img.src=url;img.alt=shown.name||`Selected photo ${index+1}`;img.loading='lazy';img.addEventListener('error',()=>{img.hidden=true;});
  text.maxLength=500;text.rows=2;text.placeholder='Add a caption (optional)';text.dataset.photoCaption='true';label.append(text);fig.append(img,label);
  const filters=node('button','Filters'),look=node('p',effects?photoEffectsLabel(effects):'Original');filters.type='button';filters.className='album-filter-button';look.className='album-filter-description';fig.append(filters,look);selection.append(fig);
  const entry={file,text,preview:img,prepared,effects};selected.push(entry);
  filters.addEventListener('click',async()=>{if(!user||busy||editingAbort)return;const current=epoch,controller=new AbortController();editingAbort=controller;filters.disabled=true;updateControls();try{const result=await openPhotoFilterEditor(entry.file,{initial:entry.effects,signal:controller.signal,title:`Edit Photo ${selected.indexOf(entry)+1}`,applyLabel:'Apply Photo'});if(current!==epoch||!selected.includes(entry)||!result)return;entry.prepared=result.file;entry.effects=result.settings;if(result.caption)text.value=result.caption;const previewUrl=URL.createObjectURL(result.file);urls.push(previewUrl);img.src=previewUrl;img.hidden=false;look.textContent=photoEffectsLabel(result.settings);status.textContent='Edited photo ready. Tap Upload Selected Photos to post it.';}catch(error){if(current===epoch&&error?.name!=='AbortError')status.textContent=error?.message||'That photo could not be edited.';}finally{if(current===epoch){editingAbort=null;filters.disabled=false;updateControls();}}});
 }
 function chooseFiles(files,{openEditor=false,prepared=null,effects=null}={}) {
  cleanSelection();const available=Math.max(0,MAX_PHOTOS-total);
  if(!available){status.textContent='Your album has 10 photos. Remove one before adding another.';input.value='';updateControls();return false;}
  if(files.length>available){status.textContent=`You have room for ${available} more photo${available===1?'':'s'}.`;input.value='';updateControls();return false;}
  files.forEach((file,index)=>addSelection(file,{prepared:index===0?prepared:null,effects:index===0?effects:null}));
  status.textContent=files.length?(openEditor?`${files.length} selected. Opening the ROOSTER media editor…`:`${files.length} photo${files.length===1?' is':'s are'} ready to upload.`):'Choose photos from your library.';
  updateControls();if(files.length&&openEditor)queueMicrotask(()=>selection.querySelector('.album-filter-button')?.click());return !!files.length;
 }
 input.addEventListener('change',()=>{if(!busy)chooseFiles([...(input.files||[])],{openEditor:true});});
 camera?.addEventListener('click',async()=>{
  if(!user||busy||editingAbort||total>=MAX_PHOTOS)return;const current=epoch,controller=new AbortController();editingAbort=controller;updateControls();status.textContent='Opening the camera…';
  try{const result=await openRosterCamera({signal:controller.signal,title:'Take an Album Photo',aspect:4/5,applyLabel:'Use Photo'});if(current!==epoch||!result)return;editingAbort=null;input.value='';chooseFiles([result.sourceFile],{prepared:result.file,effects:result.settings});status.textContent=`${photoEffectsLabel(result.settings)} photo ready. Add a caption or upload it.`;}
  catch(error){if(current===epoch&&error?.name!=='AbortError')status.textContent=error?.message||'The camera could not open.';}
  finally{if(current===epoch){editingAbort=null;updateControls();}}
 });
 send.addEventListener('click',async()=>{if(!user||busy||editingAbort)return;if(!selected.length){status.textContent='Take a photo or choose one from your library first.';return;}const current=epoch;busy=true;updateControls();let added=0,duplicates=0;const failed=[];
  for(let i=0;i<selected.length;i++){if(current!==epoch)break;status.textContent=`Uploading photo ${i+1} of ${selected.length}…`;try{const photo=selected[i].prepared||await prepareAlbumPhoto(selected[i].file);if(current!==epoch)break;const body=new FormData();body.set('photo',photo);body.set('caption',selected[i].text.value);const d=await request('/api/member-album/upload',{method:'POST',body});d.duplicate?duplicates++:added++;}catch(e){failed.push(`Photo ${i+1}: ${e.message}`);}}
  if(current===epoch){busy=false;if(!failed.length){input.value='';cleanSelection();}await refresh();status.textContent=`${added} photo${added===1?'':'s'} saved.${duplicates?` ${duplicates} already in your album.`:''}${failed.length?` ${failed.length} could not upload. ${failed.slice(0,3).join(' ')}`:''}`;updateControls();}
 });
 more.addEventListener('click',()=>{if(!busy&&Number.isSafeInteger(next)){offset=next;void refresh(true);}});
 return{setUser(value){if(user?.id===value?.id)return;epoch++;user=value;busy=false;total=0;input.value='';cleanSelection();grid.replaceChildren();more.hidden=true;status.textContent='';updateControls();if(user)void refresh();}};
}
