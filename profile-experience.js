(function(){
  'use strict';
  var UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  var profile=null,viewer=null,ownerCheck=0;
  function all(selector){return Array.prototype.slice.call(document.querySelectorAll(selector));}
  function setOwner(value){
    all('[data-profile-owner-only]').forEach(function(node){node.hidden=!value;});
    all('[data-viewed-profile]').forEach(function(node){node.hidden=value;});
    var add=document.querySelector('[data-profile-add-roster]');
    if(add)add.hidden=value;
    document.body.dataset.profileOwner=value?'true':'false';
  }
  function activateTab(name,quiet){
    if(!['posts','songs','photos','about','studio'].includes(name))return;
    document.body.dataset.profileTabActive=name;
    all('[data-profile-tab]').forEach(function(button){var active=button.dataset.profileTab===name;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));});
    all('[data-profile-panel]').forEach(function(panel){panel.hidden=panel.dataset.profilePanel!==name;});
    if(name==='photos'&&!quiet)document.querySelector('[data-album-grid]')?.scrollIntoView({block:'nearest'});
    if(!quiet)window.dispatchEvent(new CustomEvent('jwhite:profile-tab',{detail:{tab:name}}));
  }
  function configureProfession(member){
    var look=window.RoosterProfileProfession?.describe(member);if(!look)return;
    document.body.dataset.profileProfession=look.kind;
    var primary=document.getElementById('profile-primary-tab');
    if(primary){primary.dataset.profileTab=look.music?'songs':'studio';primary.textContent=look.music?'Profile Music':'Creator Studio';}
    var optional=document.getElementById('profile-optional-music');if(optional)optional.hidden=look.music;
    var composer=document.querySelector('[data-profile-create-feature]');
    if(composer){composer.href=look.music?'/members.html#member-songs-root':'/members.html#member-clips-root';composer.querySelector('b').textContent=look.music?'Song':'Clip';composer.querySelector('span').textContent=look.music?'Add music':'Post a video';}
    [['profile-studio-kicker',look.kicker],['profile-studio-title',look.title],['profile-studio-description',look.description],['profile-studio-videos',look.videos],['profile-studio-photos',look.photos],['profile-studio-connect-title',look.connectTitle],['profile-studio-connect-description',look.connectDescription]].forEach(function(item){var node=document.getElementById(item[0]);if(node)node.textContent=item[1];});
    var link=document.getElementById('profile-studio-collaborate');
    if(link&&UUID.test(member.id||'')){link.href='/members.html?to='+encodeURIComponent(member.id.toLowerCase())+'&name='+encodeURIComponent(member.name||'Member')+'#member-mail';link.textContent=look.inquiry;}
    var website=document.getElementById('profile-studio-website');
    if(website){var href='';try{var url=new URL(member.website_url);if(url.protocol==='https:'&&!url.username&&!url.password)href=url.href;}catch{}
      website.hidden=!href;if(href)website.href=href;else website.removeAttribute('href');
    }
    activateTab(document.body.dataset.profileTabActive||'posts',true);
  }
  function mirrorRosterCount(){
    var source=document.querySelector('#friend-space [data-friend-count]'),target=document.querySelector('[data-profile-roster-count]');
    if(!source||!target)return;
    var paint=function(){target.textContent=source.textContent||'…';};paint();
    new MutationObserver(paint).observe(source,{childList:true,characterData:true,subtree:true});
  }
  async function identifyOwner(member){
    var check=++ownerCheck;
    try{var response=await fetch('/api/profile/me',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(check!==ownerCheck||profile!==member)return;if(!response.ok)return setOwner(false);var data=await response.json();if(check!==ownerCheck||profile!==member)return;viewer=data.profile||null;setOwner(UUID.test(viewer?.id||'')&&UUID.test(member.id||'')&&viewer.id.toLowerCase()===member.id.toLowerCase());}
    catch{if(check===ownerCheck&&profile===member)setOwner(false);}
  }
  async function loadRoom(member){
    var card=document.getElementById('profile-room-preview');if(!card)return;
    try{var response=await fetch('/api/live/rooms',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)return;var data=await response.json();var room=(Array.isArray(data.rooms)?data.rooms:[]).find(function(item){return typeof item?.host_id==='string'&&item.host_id.toLowerCase()===member.id.toLowerCase();});if(!room)return;
      card.querySelector('[data-profile-room-title]').textContent=room.title||'Live on ROOSTER';
      card.querySelector('[data-profile-room-meta]').textContent=(room.medium==='video'?'Video live':'Audio room')+' · '+Number(room.participant_count||0).toLocaleString()+' listening · '+Number(room.speaker_count||0).toLocaleString()+' speaking';
      card.querySelector('[data-profile-room-link]').href='/live.html?room='+encodeURIComponent(room.key);card.querySelector('[data-profile-room-link]').textContent=room.medium==='video'?'Watch':'Join';card.hidden=false;
    }catch{}
  }
  function ready(member){
    if(!member||!(UUID.test(member.id||'')||member.id==='owner'))return;var same=profile?.id===member.id;profile=member;if(!same)setOwner(false);configureProfession(member);
    var composerAvatar=document.querySelector('.profile-composer-avatar');if(composerAvatar&&typeof member.photo_url==='string'&&member.photo_url.startsWith('/'))composerAvatar.style.background='center/cover url("'+member.photo_url.replace(/["\\]/g,'')+'")';
    void identifyOwner(member);if(!same)void loadRoom(member);
  }
  document.addEventListener('click',function(event){
    var tab=event.target.closest('[data-profile-tab]');if(tab){activateTab(tab.dataset.profileTab);return;}
    var openTab=event.target.closest('[data-profile-open-tab]');if(openTab){activateTab(openTab.dataset.profileOpenTab);return;}
    if(event.target.closest('[data-profile-add-roster]')){document.querySelector('#friend-space [data-add-friend]')?.click();document.getElementById('friend-space')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});return;}
    if(event.target.closest('[data-profile-compose-post]'))location.href='/?compose=post';
    if(event.target.closest('[data-profile-menu-open]'))document.getElementById('profile-menu-sheet')?.showModal();
    if(event.target.closest('[data-profile-menu-close]'))document.getElementById('profile-menu-sheet')?.close();
  });
  document.getElementById('profile-menu-sheet')?.addEventListener('click',function(event){if(event.target===event.currentTarget)event.currentTarget.close();});
  window.addEventListener('jwhite:profile-ready',function(event){ready(event.detail);});
  function resetOwner(){ownerCheck++;viewer=null;setOwner(false);if(profile)void identifyOwner(profile);}
  window.addEventListener('jwhite:session-changed',resetOwner);
  window.addEventListener('storage',function(event){if(event.key===null||event.key==='gotrue.user')resetOwner();});
  window.addEventListener('pagehide',function(){ownerCheck++;viewer=null;setOwner(false);});
  window.addEventListener('pageshow',function(event){if(event.persisted&&profile)void identifyOwner(profile);});
  if(window.JWhitePublicProfile)ready(window.JWhitePublicProfile);
  var requestedTab=new URLSearchParams(location.search).get('view');
  mirrorRosterCount();activateTab(['posts','songs','photos','about','studio'].includes(requestedTab)?requestedTab:'posts');
})();
