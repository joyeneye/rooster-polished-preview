(() => {
 const create=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const PHOTO=/^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/;
 const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 const initials=name=>name.split(/\s+/).slice(0,2).map(word=>[...word][0]||'').join('').toLocaleUpperCase()||'M';
 /* A reply shows the member's current picture and name, and both open their
    profile. The link is only accepted when it belongs to the member ID stored
    with the reply, so a reply never points at somebody else's page. */
 const replyLink=r=>{const id=typeof r.author_id==='string'&&UUID.test(r.author_id)?r.author_id.toLowerCase():null;
  if(!id||typeof r.profile_url!=='string')return null;
  return r.profile_url==='/#home'||r.profile_url===`/profile.html?id=${id}`?r.profile_url:null;};
 function replyAuthor(r){const name=typeof r.name==='string'&&r.name.trim()?r.name.trim():'Somebody on the ROOSTER';
  const href=replyLink(r);
  const link=create(href?'a':'span');link.className='wall-reply-author';
  if(href){link.href=href;link.setAttribute('aria-label',`Open ${name}'s ROOSTER profile`);}
  const avatar=create('span',initials(name));avatar.className='wall-reply-avatar';avatar.setAttribute('aria-hidden','true');
  if(href&&typeof r.photo_url==='string'&&PHOTO.test(r.photo_url)){const img=create('img');img.src=r.photo_url;img.alt='';img.loading='lazy';img.addEventListener('error',()=>img.remove());avatar.append(img);}
  const label=create('span',name);label.className='wall-reply-name';
  if(r.verified_owner===true||r.verified===true){const badge=create('span','\u2713');badge.className=r.verified_owner===true?'official-gold-badge':'member-verified-badge';badge.setAttribute('role','img');badge.setAttribute('aria-label',r.verified_owner===true?'Official account':'Verified on the ROOSTER');label.append(' ',badge);}
  link.append(avatar,label);return link;}
 async function request(path,options={}){const c=new AbortController(),timer=setTimeout(()=>c.abort(),20000);try{const r=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:c.signal,headers:{Accept:'application/json',...options.headers}});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.error||'Could not connect to this wall.');return d;}finally{clearTimeout(timer);}}
 window.JWhiteWallInteractions={attach(container,wall,id){if(container.querySelector('.wall-interactions'))return;const root=create('div');root.className='wall-interactions';const status=create('p');status.setAttribute('role','status');const replies=create('div');replies.className='wall-replies';const form=create('form');form.className='wall-reply-form';form.hidden=true;const input=create('textarea');input.maxLength=1000;input.required=true;input.setAttribute('aria-label','Your reply');const send=create('button','Post Reply');send.type='submit';form.append(input,send);const reply=create('button','Reply');reply.type='button';let state=null,busy=false,attempt=null;const q=`?wall=${encodeURIComponent(wall)}&comment_id=${encodeURIComponent(id)}`;
 const buttons={};for(const reaction of ['apple','tomato']){const b=create('button',reaction==='apple'?'🍏':'🍅');b.type='button';b.setAttribute('aria-label',reaction==='apple'?'React with a green apple':'React with a tomato');b.addEventListener('click',async()=>{if(busy)return;busy=true;try{await request('/api/wall-interactions/post'+q,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'react',reaction:state?.reaction===reaction?null:reaction})});await load();}catch(e){status.textContent=e.message;}finally{busy=false;}});buttons[reaction]=b;root.append(b);}
 async function load(){try{const d=await request('/api/wall-interactions'+q);state=d;for(const k of ['apple','tomato']){buttons[k].textContent=`${k==='apple'?'🍏':'🍅'} ${d.counts[k]}`;buttons[k].setAttribute('aria-pressed',String(d.reaction===k));}replies.replaceChildren(...d.replies.map(r=>{const node=create('article'),p=create('p',r.message);node.append(replyAuthor(r),p);if(r.status==='pending')node.append(create('small','Saved for review, not public yet'));return node;}));}catch(e){status.textContent=e.message;}}
 reply.addEventListener('click',()=>{form.hidden=!form.hidden;if(!form.hidden)input.focus();});form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;const message=input.value.trim();if(message.length<2)return;busy=true;send.disabled=true;if(!attempt||attempt.message!==message)attempt={action:'reply',message,request_id:crypto.randomUUID()};try{const d=await request('/api/wall-interactions/post'+q,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(attempt)});input.value='';attempt=null;status.textContent=d.status==='pending'?'Your reply is saved for review.':'Your reply is posted.';await load();}catch(error){status.textContent=error.message;}finally{busy=false;send.disabled=false;}});root.append(reply,status,replies,form);container.append(root);void load();}};
})();
