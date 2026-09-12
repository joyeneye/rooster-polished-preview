/* Shared presentation layer. Existing page controllers retain their IDs and handlers. */
(() => {
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 5a3 3 0 0 1 0 6m3 3a6 6 0 0 1 3 5"/>',
    audio: '<path d="M4 9v6m4-10v14m4-18v22m4-18v14m4-10v6"/>',
    video: '<rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 10 6-4v12l-6-4"/>',
    chat: '<path d="M21 12a9 9 0 0 1-9 9H3l2-5A9 9 0 1 1 21 12Z"/><path d="M8 10h8M8 14h5"/>',
    review: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.more}</svg>`;
  const nav = [['WYD', '/', 'home'], ['People', '/people.html', 'people'], ['Rooms', '/live.html', 'audio'], ['Me', '/my-profile.html', 'me']];
  const destinations = [
    ['Top Rosters','/top25.html','The people making connections'],
    ['ORBIT Radio','/radio.html','Find your next frequency'],
    ['Opportunities','/opportunities.html','Make your next move'],
    ['Booking','/booking','Find your next collaborator'],
    ['ROOSTER Manager','/rcm.html','The business behind your work'],
    ['Messages','/members.html#member-mail','Keep the conversation going'],
    ['Chat Room','/members.html#member-chat','Pull up and talk'],
    ['My music','/my-profile.html?view=songs','The soundtrack to your page'],
    ['My photos','/my-profile.html?view=photos','Your creative world'],
    ['Roster requests','/members.html#friend-requests','Build your roster'],
    ['About ROOSTER','/about.html','A place for people'],
    ['Account','/members.html','Your membership and settings']
  ];
  function start() {
    const css = document.querySelector('link[href^="/rooster-polish.css"]');
    if (css) document.head.append(css);
    document.body.classList.add('rooster-polished');
    const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    const group = path === '/' ? 'home' : path === '/people' ? 'people' : ['/live','/reviews','/review-room'].includes(path) || location.hash === '#member-chat' ? 'audio' : ['/my-profile','/profile','/member-photos','/members'].includes(path) ? 'me' : 'more';
    const links = () => nav.map(([name,url,key]) => `<a href="${url}" ${key===group?'aria-current="page"':''}>${icon(key)}<span>${name}</span></a>`).join('');
    const more = '<button type="button" data-polish-menu aria-label="Explore all of ROOSTER" aria-haspopup="dialog">'+icon('more')+'<span>More</span></button>';
    const header = document.createElement('header'); header.className = 'rp-header';
    header.innerHTML = `<a class="rp-brand" href="/" aria-label="ROOSTER home"><img src="/roster-mark.svg" width="34" height="34" alt=""><span>R<b>OO</b>STER</span></a><nav class="rp-desktop-nav" aria-label="Main navigation">${links()}${more}</nav><div class="rp-header-actions"><button class="rp-preview" type="button" data-preview-info>Design preview</button><a class="rp-search" href="/morespace.html" aria-label="Search ROOSTER">${icon('search')}</a><a class="rp-account" href="/members.html#member-login">Your account ${icon('me')}</a></div>`;
    document.body.prepend(header);
    const mobile = document.createElement('nav'); mobile.className='rp-mobile-nav'; mobile.setAttribute('aria-label','Mobile navigation'); mobile.innerHTML=links()+more; document.body.append(mobile);
    const menu=document.createElement('dialog');menu.className='rp-menu';menu.setAttribute('aria-labelledby','rp-menu-title');
    menu.innerHTML=`<header><div><span class="rp-eyebrow">A place for people</span><h2 id="rp-menu-title">Your whole world.</h2></div><button type="button" data-close aria-label="Close navigation">×</button></header><nav aria-label="Explore ROOSTER">${destinations.map(([name,url,desc])=>`<a href="${url}"><strong>${name}<span aria-hidden="true">↗</span></strong><small>${desc}</small></a>`).join('')}</nav><footer><span>Make it yours.</span><div class="rp-theme-slot"></div></footer>`;
    document.body.append(menu);
    let opener;
    document.querySelectorAll('[data-polish-menu]').forEach(button=>button.addEventListener('click',()=>{opener=button;const theme=document.querySelector('[data-roster-theme-toggle]');if(theme)menu.querySelector('.rp-theme-slot').append(theme);menu.showModal();}));
    menu.querySelector('[data-close]').addEventListener('click',()=>menu.close());
    menu.addEventListener('close',()=>opener?.focus());
    menu.addEventListener('click',event=>{if(event.target===menu)menu.close();});
    const theme=document.querySelector('[data-roster-theme-toggle]');if(theme)menu.querySelector('.rp-theme-slot').append(theme);
    const info=document.createElement('dialog');info.className='rp-menu rp-preview-dialog';info.setAttribute('aria-label','About this design preview');
    info.innerHTML='<header><h2>Made for your review.</h2><button type="button" aria-label="Close preview information">×</button></header><p>This is the polished ROOSTER design preview. Public content comes from the current site. Account access, publishing, private messages, bookings, and live broadcasting still require the original services.</p><p>Your original site stays separate while we refine this version.</p><a class="rp-original" href="https://jwhitedidit.net" target="_blank" rel="noopener">Open the original site ↗</a>';
    document.body.append(info);header.querySelector('[data-preview-info]').addEventListener('click',()=>info.showModal());info.querySelector('button').addEventListener('click',()=>info.close());
    const note=document.querySelector('.live-hub-note');
    if(note){note.className='rp-room-intro';note.innerHTML='<span class="rp-eyebrow">ROOSTER / ROOMS</span><h1>Good company.<br><em>Great conversations.</em></h1><p>A stage for your voice. A room for your people.<br>Choose how you want to connect.</p><span class="rp-private">Invite-only community · Your people, your space</span>';
      const types={video:['video','Video live','Bring everyone into the moment.'],audio:['audio','Audio room','Take the mic. Share the floor.'],review:['review','Review room','Play a record. Get real feedback.'],chat:['chat','Text chat','Keep the conversation going.']};
      document.querySelectorAll('.live-modes a').forEach(a=>{const type=types[a.dataset.liveMode];if(type)a.innerHTML=icon(type[0])+`<strong>${type[1]}</strong><span>${type[2]}</span>`;});
    }
    const accountStatus=document.querySelector('#member-status');
    if(accountStatus){const clarify=()=>{if(accountStatus.textContent.includes('Logging in to the ROOSTER is unavailable'))accountStatus.textContent='Account sign-in is not connected in this design preview. Use the original site for your account.';};clarify();new MutationObserver(clarify).observe(accountStatus,{childList:true,subtree:true,characterData:true});}
    if(group==='more')document.querySelectorAll('[data-polish-menu]').forEach(b=>b.setAttribute('aria-current','page'));
    const managerNav=document.querySelector('.manager-nav');
    const managerMain=document.querySelector('.manager-main');
    if(managerNav&&managerMain)managerMain.prepend(managerNav);
    const auth=document.querySelector('#members-content');
    if(auth){const note=document.createElement('div');note.className='rp-auth-note';note.innerHTML='Design preview · Membership and sign-in stay on the original site while you review this version. <a href="https://jwhitedidit.net/members.html" target="_blank" rel="noopener">Open account services ↗</a>';auth.prepend(note);}
    const labels=[['.people-content','PEOPLE / CONNECTIONS'],['.radio-hero','ORBIT / LIVE RADIO'],['.opportunities-main','OPPORTUNITIES / YOUR NEXT CHAPTER'],['.top25-main','TOP ROSTERS / COMMUNITY']];
    labels.forEach(([selector,text])=>{const el=document.querySelector(selector);if(el&&!el.querySelector('.rp-eyebrow')){const tag=document.createElement('p');tag.className='rp-eyebrow';tag.textContent=text;el.prepend(tag);}});
    // Name search inputs without altering the original forms or search handlers.
    document.querySelectorAll('input[type="search"],.search-field input').forEach(input=>{if(!input.labels?.length&&!input.getAttribute('aria-label'))input.setAttribute('aria-label',input.placeholder||'Search');});
    // Keep the new link last when legacy controllers add component styles.
    new MutationObserver(()=>{if(css&&document.head.lastElementChild!==css)document.head.append(css);}).observe(document.head,{childList:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
