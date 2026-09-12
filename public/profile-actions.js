(() => {
  const byId=id=>document.getElementById(id);
  const open=byId('public-photo-open'), dialog=byId('member-photo-dialog'), image=byId('member-photo-large');
  let current=null;
  function ready(profile) {
    current=profile;
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(profile.id || '')) {
      // Send Message names the person it opens a conversation with, so the
      // messages panel can address them even before the roster list loads.
      const named=typeof profile.name==='string'?profile.name.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,60):'';
      byId('public-profile-message').href=`/members.html?to=${profile.id.toLowerCase()}`
        +(named?`&name=${encodeURIComponent(named)}`:'')+'#member-mail';
      byId('public-profile-message').textContent='Send Message';
    }
    // The profile renderer owns the profession and location labels. Replacing
    // them with optional raw fields here erased the member's profession.
    const photo=profile.photo_url;
    const safe=typeof photo==='string'&&/^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/.test(photo);
    open.disabled=!safe;
    if(safe){image.src=photo;image.alt=`${profile.name}'s profile picture`;byId('member-photo-heading').textContent=`${profile.name}'s Picture`;}
    if(profile.verified_owner===true){byId('member-wall').hidden=true;byId('public-profile-message').href='/members.html#member-mail';}
  }
  open?.addEventListener('click',()=>{if(!open.disabled)dialog.showModal();});
  byId('member-photo-close')?.addEventListener('click',()=>dialog.close());
  dialog?.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  byId('profile-copy-link')?.addEventListener('click',async()=>{
    if(!current)return;
    const url=new URL(`/profile.html?id=${encodeURIComponent(current.id)}`,window.location.origin).href;
    try{await navigator.clipboard.writeText(url);byId('profile-copy-status').textContent='Profile link copied.';}
    catch{byId('profile-copy-status').textContent=`Copy this address: ${url}`;}
  });
  window.addEventListener('jwhite:profile-ready',event=>ready(event.detail));
  if(window.JWhitePublicProfile)ready(window.JWhitePublicProfile);
})();
