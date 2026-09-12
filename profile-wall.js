(() => {
  'use strict';
  const root = document.getElementById('member-wall');
  if (!root) return;
  const byId = id => document.getElementById(id);
  const list = byId('member-wall-list'), form = byId('member-wall-form');
  const input = byId('member-wall-message'), submit = byId('member-wall-submit');
  const status = byId('member-wall-status'), login = byId('member-wall-login');
  const retry = byId('member-wall-retry'), more = byId('member-wall-more'), count = byId('member-wall-count');
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  let target = null, memberName = 'this page', generation = 0, request = null;
  let next = null, expanded = false, timer = null, suspended = false, sending = false;
  let attempt = null, viewerId = null, cards = new Map(), initialized = false;
  const active = () => !suspended && !document.hidden;
  const path = suffix => `/api/member-wall${suffix}?member=${encodeURIComponent(target)}`;
  const draftKey = () => `jwhite:wall-draft:${target}`;
  function newRequestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2,'0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  function report(text, tone = '') { status.textContent = text; status.dataset.tone = tone; }
  async function api(url, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, {once:true});
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 18000);
    try {
      const response = await fetch(url, {...options, signal:controller.signal, credentials:'same-origin', cache:'no-store', redirect:'error', headers:{Accept:'application/json', ...options.headers}});
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) { const error = new Error(data?.error || 'This wall could not connect. Please try again.'); error.status=response.status; throw error; }
      return data;
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
  }
  function photoURL(value) {
    return typeof value === 'string' && /^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/.test(value) ? value : null;
  }
  function commentCard(comment) {
    if (!comment || !/^[a-f0-9]{64}$/.test(comment.id) || comment.member_id !== target || !UUID.test(comment.author_id || '') ||
        typeof comment.name !== 'string' || typeof comment.message !== 'string' || !['approved','pending'].includes(comment.status) ||
        !Number.isFinite(Date.parse(comment.created_at))) throw new Error('Comments could not be read. Try again.');
    const item = document.createElement('li'); item.className='member-wall-comment';
    const author = document.createElement('a'); author.className='member-wall-author';
    author.href = comment.verified_owner === true ? '/#home' : `/profile.html?id=${comment.author_id}`;
    const name = document.createElement('span'); name.textContent=comment.name; name.className='member-wall-author-name';
    const portrait = document.createElement('span'); portrait.className='member-wall-portrait';
    const initial = document.createElement('span'); initial.textContent=[...comment.name][0]?.toUpperCase() || 'M'; portrait.append(initial);
    const photo = photoURL(comment.photo_url);
    if (photo) {const img=document.createElement('img'); img.src=photo; img.alt=''; img.loading='lazy'; img.addEventListener('error',()=>img.remove()); portrait.append(img);}
    author.append(name,portrait);
    if (comment.verified_owner === true || comment.verified === true) {
      // J.White keeps the gold official badge; other verified members get the red check.
      const check=document.createElement('span');
      check.className=comment.verified_owner===true?'official-gold-badge':'member-verified-badge';
      check.textContent='✓';
      check.setAttribute('role','img');
      check.setAttribute('aria-label',comment.verified_owner===true?'Official account':'Verified on the ROOSTER');
      check.title=comment.verified_owner===true?'Official ROOSTER account':'Verified on the ROOSTER';
      name.append(' ',check);
    }
    if (comment.verified_owner === true) {const badge=document.createElement('span'); badge.className='member-wall-owner'; badge.textContent='JWhite · Site owner'; author.append(badge);}
    const content=document.createElement('div'); content.className='member-wall-content';
    const date=document.createElement('time'); date.dateTime=comment.created_at;
    date.textContent=new Date(comment.created_at).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
    const text=document.createElement('p'); text.textContent=comment.message; content.append(date,text);
    if (comment.status === 'pending') {const pending=document.createElement('p'); pending.className='member-wall-pending';pending.textContent='Saved for review. Only you can see this comment until it is approved.';content.append(pending);}
    if (comment.can_delete === true) {
      const remove=document.createElement('button');remove.type='button';remove.className='member-wall-delete';remove.textContent='Remove comment';
      remove.addEventListener('click',async()=>{
        if (!window.confirm('Remove this comment from the wall?')) return;
        remove.disabled=true;
        try {const data=await api(path('/delete'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment_id:comment.id})});if(data.removed!==true)throw new Error('Removal could not be confirmed.');report('Comment removed.','success');await refresh();}
        catch(error){report(error.message,'error');remove.disabled=false;}
      }); content.append(remove);
    }
    item.dataset.commentSignature=JSON.stringify(comment);
    item.append(author,content); if(comment.status==='approved')window.JWhiteWallInteractions?.attach(content,target,comment.id); return item;
  }
  function composer(canPost, nextViewer) {
    if (viewerId && viewerId !== nextViewer) {input.value='';attempt=null;}
    viewerId=nextViewer;
    form.hidden=!canPost;login.hidden=canPost;
    const edit=byId('public-profile-edit');if(edit)edit.hidden=viewerId!==target;
    if (canPost && !input.value) {
      try {const saved=JSON.parse(sessionStorage.getItem(draftKey())||'null');
        sessionStorage.removeItem(draftKey());
        if(saved&&typeof saved.message==='string'&&saved.message.length<=1000&&saved.expires>Date.now())input.value=saved.message;
      } catch { /* Drafts are optional. */ }
    }
  }
  async function refresh(loadMore=false) {
    if(!target||!active())return;
    request?.abort(); const epoch=++generation, controller=new AbortController();request=controller;
    clearTimeout(timer);root.setAttribute('aria-busy','true');retry.hidden=true;more.disabled=true;
    if(!initialized)report('Loading this wall…');
    try {
      const data=await api(path('')+(loadMore&&next?`&before=${encodeURIComponent(next)}`:''),{signal:controller.signal});
      if(epoch!==generation||!active())return;
      if(data.member_id!==target||!Number.isSafeInteger(data.total)||data.total<0||!Array.isArray(data.comments)||typeof data.can_post!=='boolean'||(data.viewer_id!==null&&!UUID.test(data.viewer_id||'')))throw new Error('This wall could not be read. Try again.');
      const newCards=new Map(loadMore?cards:[]);
      for(const comment of data.comments){const previous=cards.get(comment.id);newCards.set(comment.id,previous?.dataset.commentSignature===JSON.stringify(comment)?previous:commentCard(comment));}
      cards=newCards;list.replaceChildren(...cards.values());
      if(!cards.size){const empty=document.createElement('li');empty.className='member-wall-empty';empty.textContent=`Be the first to leave some love on ${memberName}'s wall.`;list.append(empty);}
      count.textContent=`${data.total.toLocaleString()} ${data.total===1?'comment':'comments'}`;
      next=typeof data.next==='string'?data.next:null;more.hidden=!next;expanded=loadMore||expanded;
      composer(data.can_post,data.viewer_id);
      if(!initialized && window.location.hash === '#member-wall') root.scrollIntoView({block:'start'});
      if(!initialized||status.dataset.tone==='error')report('');initialized=true;
    } catch(error) {
      if(epoch===generation&&active()){report(error.name==='AbortError'?'The wall took too long to load. Tap Try again.':error.message,'error');retry.hidden=false;}
    } finally {
      if(epoch===generation){root.setAttribute('aria-busy','false');more.disabled=false;request=null;if(active()&&!expanded)timer=setTimeout(()=>void refresh(),20000);}
    }
  }
  function initialize(profile) {
    if(!profile||!UUID.test(profile.id||'')||profile.verified_owner===true)return;
    const sameTarget=target===profile.id.toLowerCase();
    target=profile.id.toLowerCase();memberName=profile.name||'This page';
    byId('member-wall-heading').textContent=`${memberName}'s Comment Wall`;
    byId('member-wall-prompt').textContent=`Leave ${memberName} some love. Comments stay on this page.`;
    login.href=`/members.html?wall_member=${target}#login`;
    login.textContent=`Log in to write on ${memberName}'s wall »`;
    root.hidden=false;if(!sameTarget)void refresh();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(sending||!target||!form.reportValidity())return;
    const message=input.value.trim();if(message.length<2||message.length>1000)return;
    try { if(!attempt||attempt.message!==message)attempt={request_id:newRequestId(),message}; }
    catch { report('Your browser could not start the comment. Open this page in an updated browser.','error'); return; }
    sending=true;submit.disabled=true;input.readOnly=true;report('Posting your comment…');
    try {
      const data=await api(path('/post'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(attempt)});
      if(!['approved','pending'].includes(data.status)||!data.comment||data.comment.member_id!==target)throw new Error('Your post could not be confirmed. Try again.');
      input.value='';attempt=null;
      try{sessionStorage.removeItem(draftKey());}catch{}
      report(data.status==='approved'?'Your comment is on their wall.':'Your comment is saved for review. It is not public yet.',data.status==='approved'?'success':'pending');
      expanded=false;await refresh();
    } catch(error) {
      report(error.name==='AbortError'?'That took too long. Your text is still here. Tap Post Comment to retry.':error.message,'error');
      if([401,403].includes(error.status)){login.hidden=false;login.textContent='Log in again, then return to this wall »';}
    } finally {sending=false;submit.disabled=false;input.readOnly=false;}
  });
  login.addEventListener('click',()=>{if(input.value.trim())try{sessionStorage.setItem(draftKey(),JSON.stringify({message:input.value,expires:Date.now()+1800000}));}catch{}});
  retry.addEventListener('click',()=>void refresh());more.addEventListener('click',()=>void refresh(true));
  function suspend(){generation++;request?.abort();request=null;clearTimeout(timer);}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();else void refresh();});
  window.addEventListener('pagehide',()=>{suspended=true;suspend();});
  window.addEventListener('pageshow',()=>{suspended=false;if(target)void refresh();});
  window.addEventListener('jwhite:profile-ready',event=>initialize(event.detail));
  if(window.JWhitePublicProfile)initialize(window.JWhitePublicProfile);
})();
