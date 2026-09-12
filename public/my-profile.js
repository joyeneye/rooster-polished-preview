(() => {
 'use strict';
 const status=document.getElementById('my-profile-status'),retry=document.getElementById('my-profile-retry');let busy=false;
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 async function open(){if(busy)return;busy=true;retry.hidden=true;status.textContent='Opening your profile…';const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{const r=await fetch('/api/profile/me',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
   const requestedView=new URL(location.href).searchParams.get('view');
   const view=requestedView==='photos'?'photos':requestedView==='songs'?'songs':'profile';
   if(r.status===401||r.status===403){location.replace('/members.html?open='+view);return;}
   if(!r.ok)throw new Error();const d=await r.json();if(!uuid.test(d.profile?.id||''))throw new Error();
   const own=d.can_edit_owner===true||d.profile.verified_owner===true;
   const target=view==='photos'?(own?'/photos.html':'/member-photos.html?id='+encodeURIComponent(d.profile.id)):view==='songs'?'/profile.html?id='+encodeURIComponent(d.profile.id)+'&view=songs':'/profile.html?id='+encodeURIComponent(d.profile.id);
   location.replace(target);
  }catch{status.textContent='Your profile could not load. Try again or open your account below.';retry.hidden=false;}finally{clearTimeout(timer);busy=false;}}
 retry.addEventListener('click',()=>void open());void open();
})();
