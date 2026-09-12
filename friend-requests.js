(() => {
  const root=document.getElementById('friend-requests'); if(!root) return;
  const status=root.querySelector('[data-request-status]'), incoming=root.querySelector('[data-request-incoming]'), outgoing=root.querySelector('[data-request-outgoing]'), count=root.querySelector('[data-request-count]'), refresh=root.querySelector('[data-refresh-requests]');
  let busy=false, repeat=false;
  const el=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
  async function request(path, options={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {const res=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...options.headers}});const data=await res.json().catch(()=>null);if(!res.ok){const error=new Error(data?.error||'Roster Requests could not connect.');error.status=res.status;throw error;}return data;}
    finally{clearTimeout(timer);}
  }
  async function respond(r,action,row) {
    const buttons=[...row.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try {const data=await request('/api/friend-requests/respond',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:r.id,action})});status.textContent=data.message;await load();window.dispatchEvent(new CustomEvent('jwhite:requests-changed'));}
    catch(error){status.textContent=error.message;buttons.forEach(b=>b.disabled=false);}
  }
  function card(r,received) {
    const row=el('article');row.className='friend-request-card';
    const id=r.member_id,name=r.name;
    const link=el('a',name||'View Page'); link.href=id==='owner'?'/#home':`/profile.html?id=${encodeURIComponent(id)}`;row.append(link);
    if(received) for(const action of ['accept','decline']) {const b=el('button',action==='accept'?'Accept':'Decline');b.type='button';b.addEventListener('click',()=>void respond(r,action,row));row.append(b);}
    else row.append(el('span','Waiting for acceptance'));
    return row;
  }
  async function load() {
    if(busy){repeat=true;return;}busy=true;refresh.disabled=true;
    try {const data=await request('/api/friend-requests');if(!Array.isArray(data.incoming)||!Array.isArray(data.outgoing))throw new Error('Roster Requests could not be read.');count.textContent=`(${data.incoming.length})`;incoming.replaceChildren(...data.incoming.map(r=>card(r,true)));outgoing.replaceChildren(...data.outgoing.map(r=>card(r,false)));status.textContent=data.incoming.length?'Choose Accept or Decline below.':'No new roster requests.';if(!data.outgoing.length)outgoing.textContent='No pending sent requests.';}
    catch(error){if(error.status===401||error.status===403){incoming.replaceChildren();outgoing.replaceChildren();count.textContent='';status.replaceChildren();const a=el('a','Log in to see your roster requests');a.href='/members.html#friend-requests';status.append(a);}else status.textContent=error.message;}
    finally{busy=false;refresh.disabled=false;if(repeat){repeat=false;void load();}}
  }
  refresh.addEventListener('click',()=>void load());window.addEventListener('jwhite:session-changed',()=>void load());window.addEventListener('jwhite:requests-changed',()=>void load());window.addEventListener('pageshow',()=>void load());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});void load();
})();
