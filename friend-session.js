(() => {
  const KEY='jwhite:pending-friend:v1';
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const valid=target=>target==='owner'||UUID.test(target||'');
  let session=null, busy=false, controller=null, generation=0, attempted='';
  const read=()=>{try {const saved=JSON.parse(localStorage.getItem(KEY)||'null');return saved&&valid(saved.target)&&typeof saved.nonce==='string'&&Number.isFinite(saved.expires)&&saved.expires>Date.now()?saved:null;}catch{return null;}};
  function remember(target){if(!valid(target))return null;const intent={target:target.toLowerCase(),nonce:crypto.randomUUID(),expires:Date.now()+86400000};try{localStorage.setItem(KEY,JSON.stringify(intent));return intent;}catch{return null;}}
  function forget(intent){try{if(read()?.nonce===intent?.nonce)localStorage.removeItem(KEY);}catch{}}
  function message(text,linkText='View the Roster »',target='owner') {
    const box=document.getElementById('friend-login-confirmation');if(!box)return;
    box.replaceChildren();const textNode=document.createElement('p');textNode.textContent=text;box.append(textNode);
    if(linkText){const a=document.createElement('a');a.href=linkText==='View Roster Requests »'?'/members.html#friend-requests':target==='owner'?'/#jwhite-friend-space':`/profile.html?id=${encodeURIComponent(target)}#friend-space`;a.textContent=linkText;box.append(a);}
    box.hidden=false;
  }
  async function resume(){
    const intent=read();if(!session||busy||!intent)return;
    const signature=`${session}:${intent.nonce}`;if(attempted===signature)return;
    attempted=signature;busy=true;const epoch=generation;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
    message('Sending your roster request…',null);
    try {
      const response=await fetch(`/api/friends/add?target_id=${encodeURIComponent(intent.target)}`,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data||!Number.isSafeInteger(data.count)||data.count<0)throw new Error(data?.error||'Your roster request could not be confirmed.');
      if(epoch!==generation)return;
      forget(intent);
      message(data.message || 'Roster request sent. Waiting for acceptance.','View Roster Requests »',intent.target);
      window.dispatchEvent(new CustomEvent('jwhite:requests-changed'));
      window.dispatchEvent(new CustomEvent('jwhite:friends-changed',{detail:{target:intent.target}}));
    } catch(error){if(epoch!==generation)return;attempted='';message(error.name==='AbortError'?'That took too long. Your add is saved here to retry.':'Your add did not finish. Try again below.',null);
      const box=document.getElementById('friend-login-confirmation');if(box){const retry=document.createElement('button');retry.type='button';retry.textContent='Send Roster Request';retry.className='member-primary';retry.addEventListener('click',()=>void resume());box.append(retry);}}
    finally {clearTimeout(timeout);if(epoch===generation){busy=false;controller=null;}}
  }
  function setUser(user){const next=user?.confirmedAt&&UUID.test(user.id||'')?user.id.toLowerCase():null;
    if(next!==session){generation++;controller?.abort();controller=null;busy=false;attempted='';session=next;}
    if(session)void resume();
  }
  window.JWhiteFriendSession={remember,forget,read,setUser};
  window.addEventListener('pagehide',()=>{generation++;controller?.abort();controller=null;busy=false;attempted='';});
  window.addEventListener('pageshow',()=>{if(session)void resume();});
})();
