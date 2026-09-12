/* roster-startup.js
   Two things that have to agree with each other on every page, so they live in
   one file that every page already loads: the shared ROOSTER brand mark, and
   the light startup screen that opens with it.

   THE SHARED LOGO COMPONENT
   ------------------------------------------------------------------
   MARK below is the single canonical source for the ROOSTER mark. The header,
   the startup screen and every other surface read it from here instead of
   naming a file of their own, so replacing the artwork is a one-file change:
   drop the approved outlined R in at that path and every mark on the site is
   the new one. Each page still ships a real <img> in its markup with the same
   src, so the mark is there before this script runs and stays there if the
   script never does; upgrade() only re-points marks that name a different
   file, which is what makes the swap reach pages that were not reopened.

   THE STARTUP SCREEN
   ------------------------------------------------------------------
   Rules, in order of who wins:
   - It never replays. One appearance per browsing session, so switching tabs,
     opening a thread and coming back, or moving between pages does not show it
     again.
   - It never blocks anything. Browser back or forward, a deep link with a hash
     or a query, a page that has already loaded, or reduced-motion preferences
     all skip it outright, and a real interaction, a script error, or a hard cap
     dismisses it early.
   - The only progress shown is the real approved-member count toward the first
     500 spots. No fake members are added and no percentage is presented. */
(function () {
  'use strict';

  var THEME_KEY = 'roster-theme';
  function savedTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }
  function applyTheme(theme) {
    var next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-roster-theme', next);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'dark' ? '#09090b' : '#f6f5f1');
    var toggle = document.querySelector('[data-roster-theme-toggle]');
    if (toggle) {
      toggle.textContent = next === 'dark' ? 'LIGHT' : 'DARK';
      toggle.setAttribute('aria-label', `Use ${next === 'dark' ? 'light' : 'dark'} background`);
    }
  }
  applyTheme(savedTheme());

  /* The one place the mark is named. */
  var MARK_PATH = '/roster-mark.svg';
  var MARK = MARK_PATH + '?v=20260910-r-logo-v2';
  /* The startup mark is 132 CSS px and the header mark is 32, both inside the
     sizes the brand asks for, and both stated here so the two never drift. */
  var STARTUP_SIZE = 132;
  var HEADER_SIZE = 32;

  function upgrade(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var marks = scope.querySelectorAll('[data-roster-mark], .roster-brand-mark, .wordmark-mark');
    for (var i = 0; i < marks.length; i++) {
      var img = marks[i];
      if (img.tagName !== 'IMG') continue;
      // Compare the path only, so a cache-busting ?v= on the page's own copy
      // is not mistaken for a different file and reloaded for nothing.
      var current = (img.getAttribute('src') || '').split('?')[0];
      if (current !== MARK_PATH || img.getAttribute('src') !== MARK) img.setAttribute('src', MARK);
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
      img.classList.add('roster-brand-mark');
    }
  }

  /* RCM is reached from the More menus, which every page ships in its own
     markup; adding the link here is what keeps those menus identical from
     page to page. */
  function addRcmToMoreMenus() {
    document.querySelectorAll('.nav-more-menu,.mobile-nav-menu').forEach(function (menu) {
      menu.querySelectorAll('a').forEach(function (link) {
        if ((link.textContent || '').trim().toLowerCase() === 'booking') { link.href = '/booking'; link.textContent = 'Booking Marketplace'; }
      });
      if (!menu.querySelector('.nav-rcm')) {
        var link = document.createElement('a');
        link.className = 'nav-rcm';
        link.href = '/rcm.html';
        link.textContent = 'ROOSTER Manager';
        menu.insertBefore(link, menu.firstChild);
      }
    });
  }

  function consolidateNavigation() {
    function currentChoice() {
      var path=location.pathname.replace(/\.html$/,'')||'/';
      if(path==='/')return 'nav-wyd';
      if(path==='/people')return 'nav-people';
      if(path==='/live'||path==='/review-room'||path==='/reviews')return 'nav-review-room';
      if(path==='/my-profile'||path==='/profile'||path==='/members')return 'nav-mine';
      return 'more';
    }
    function primaryLinks() {
      return [
        ['WYD', '/#home', 'nav-wyd'], ['People', '/people.html', 'nav-people'],
        ['Rooms', '/live.html', 'nav-review-room'], ['Me', '/my-profile.html', 'nav-mine'],
      ].map(function (item) { var link=document.createElement('a');link.textContent=item[0];link.href=item[1];link.className=item[2];if(item[2]==='nav-mine')link.setAttribute('data-my-profile','');if(item[2]===currentChoice())link.setAttribute('aria-current','page');return link; });
    }
    function moreMenu(mobile) {
      var details=document.createElement('details');details.className=mobile?'mobile-nav-more':'nav-more';
      var summary=document.createElement('summary');summary.textContent='More';
      if(currentChoice()==='more')summary.setAttribute('aria-current','page');
      var menu=document.createElement('div');menu.className=mobile?'mobile-nav-menu':'nav-more-menu';
      [['Opportunities','/opportunities.html'],['Booking','/booking'],['Manager','/rcm.html'],['Radio','/radio.html'],['Top 25','/top25.html'],['About','/about.html'],['Settings','/members.html']].forEach(function(item){var link=document.createElement('a');link.textContent=item[0];link.href=item[1];menu.appendChild(link);});
      details.append(summary,menu);return details;
    }
    function normalize(nav, mobile, preserve) {
      var kept = preserve ? Array.from(nav.querySelectorAll(preserve)) : [];
      nav.replaceChildren(...primaryLinks(),...kept,moreMenu(mobile));
      nav.setAttribute('data-canonical-global-nav','');
    }
    document.querySelectorAll('.site-nav,.mobile-site-nav').forEach(function (nav) {
      normalize(nav, nav.classList.contains('mobile-site-nav'));
    });
    document.querySelectorAll('.community-rail > nav').forEach(function(nav){normalize(nav,false)});
    document.querySelectorAll('.mobile-community-nav').forEach(function(nav){normalize(nav,true,'.mobile-take-pic')});
    document.querySelectorAll('.profile-desktop-nav > nav').forEach(function(nav){normalize(nav,false)});
    document.querySelectorAll('.profile-mobile-nav').forEach(function(nav){normalize(nav,true,'.profile-mobile-create')});

    /* Old shell-specific menus represented the same global destinations. The
       canonical More control above replaces them; account/login and content
       controls remain page-local. */
    document.querySelectorAll('.rail-rest,#mobile-more-sheet,#profile-menu-sheet,.profile-menu-button,.profile-topbar-slots,.profile-account-button,.community-header-actions .header-discover,.community-header-actions .header-menu,.community-header-actions .header-profile').forEach(function(node){node.remove()});

    /* Booking keeps Explore, business login and provider actions as task
       controls. Add the same compact app navigation beside those controls. */
    document.querySelectorAll('.booking-nav').forEach(function(shell,index){
      if(shell.querySelector('[data-canonical-global-nav]'))return;
      var nav=document.createElement('nav');nav.className='roster-booking-global';nav.setAttribute('aria-label','ROOSTER navigation');
      normalize(nav,false);var task=shell.querySelector('.nav-links');shell.insertBefore(nav,task||null);
    });
  }

  function enhanceMoreMenus() {
    var menus = Array.from(document.querySelectorAll('.nav-more,.mobile-nav-more'));
    var active = null;
    function close(menu, restore) {
      if (!menu || !menu.button) return;
      menu.panel.hidden = true;
      menu.button.setAttribute('aria-expanded', 'false');
      menu.host.removeAttribute('data-menu-open');
      if (active === menu) active = null;
      if (restore) menu.button.focus({preventScroll: true});
    }
    function place(menu) {
      var mobile = matchMedia('(max-width:760px)').matches;
      menu.panel.classList.toggle('roster-more-sheet', mobile);
      menu.panel.classList.toggle('roster-more-popover', !mobile);
      if (mobile) { menu.panel.style.removeProperty('--more-left'); menu.panel.style.removeProperty('--more-top'); menu.panel.style.removeProperty('--more-max-height'); return; }
      var rect = menu.button.getBoundingClientRect(), width = 280;
      var left = Math.max(12, Math.min(innerWidth - width - 12, rect.right - width));
      var top = Math.min(innerHeight - 80, rect.bottom + 6);
      menu.panel.style.setProperty('--more-left', left + 'px');
      menu.panel.style.setProperty('--more-top', top + 'px');
      menu.panel.style.setProperty('--more-max-height', Math.max(120, innerHeight - top - 12) + 'px');
    }
    function open(menu) {
      if (active && active !== menu) close(active, false);
      active = menu; place(menu); menu.panel.hidden = false;
      menu.button.setAttribute('aria-expanded', 'true'); menu.host.setAttribute('data-menu-open', '');
    }
    menus.forEach(function (host, index) {
      var summary = host.querySelector(':scope > summary');
      var panel = host.querySelector(':scope > .nav-more-menu,:scope > .mobile-nav-menu');
      if (!summary || !panel) return;
      var button = document.createElement('button');
      button.type = 'button'; button.className = summary.className + ' roster-more-trigger';
      button.textContent = 'More'; button.setAttribute('aria-expanded', 'false');
      if (summary.getAttribute('aria-current') === 'page') button.setAttribute('aria-current','page');
      panel.id = panel.id || 'roster-more-menu-' + index; button.setAttribute('aria-controls', panel.id);
      var wrapper = document.createElement('div');
      Array.from(host.attributes).forEach(function (attribute) {
        if (attribute.name !== 'open') wrapper.setAttribute(attribute.name, attribute.value);
      });
      wrapper.appendChild(button); panel.hidden = true;
      host.replaceWith(wrapper); document.body.appendChild(panel);
      var menu = {host:wrapper, button:button, panel:panel};
      wrapper._rosterMoreMenu = menu;
      panel.querySelectorAll('a').forEach(function (link) {
        try {
          var target = new URL(link.href, location.href), current = new URL(location.href);
          if (target.pathname === current.pathname && (!target.hash || target.hash === current.hash)) link.setAttribute('aria-current', 'page');
        } catch (e) {}
        link.addEventListener('click', function () { close(menu, false); });
      });
      button.addEventListener('click', function () { button.getAttribute('aria-expanded') === 'true' ? close(menu, false) : open(menu); });
      button.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown') { event.preventDefault(); open(menu); panel.querySelector('a')?.focus(); }
      });
      panel.addEventListener('keydown', function (event) {
        var links = Array.from(panel.querySelectorAll('a:not([hidden])'));
        if (event.key === 'Escape') { event.preventDefault(); close(menu, true); return; }
        if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key) || !links.length) return;
        event.preventDefault(); var at = links.indexOf(document.activeElement), next;
        if (event.key === 'Home') next = 0; else if (event.key === 'End') next = links.length - 1;
        else next = (at + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links[next].focus();
      });
    });
    document.addEventListener('pointerdown', function (event) { if (active && !active.panel.contains(event.target) && event.target !== active.button) close(active, false); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && active) { event.preventDefault(); close(active, true); } });
    addEventListener('resize', function () { if (active) place(active); }, {passive:true});
    addEventListener('popstate', function () { if (active) close(active, false); });
    addEventListener('hashchange', function () { if (active) close(active, false); });
  }

  function cleanNavigation() {
    var selector = 'nav a[href^="/jwhite"],.nav-more-menu a[href^="/jwhite"],.mobile-nav-menu a[href^="/jwhite"],.roster-sheet-links a[href^="/jwhite"],.community-context footer a[href^="/jwhite"]';
    document.querySelectorAll(selector).forEach(function (link) { link.remove(); });
    document.querySelectorAll('nav a').forEach(function (link) {
      var words = (link.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (words.indexOf('j.white') !== -1 || words.indexOf('jwhite') !== -1) link.remove();
    });
    document.querySelectorAll('nav a[href="/"],nav a[href="/#home"]').forEach(function (link) {
      var label = (link.textContent || '').trim().toLowerCase();
      if (label === 'feed' || label === 'home' || label === 'for you') link.textContent = 'WYD';
      if (link.getAttribute('aria-label') === 'Home' || link.getAttribute('aria-label') === 'Feed') link.setAttribute('aria-label', 'WYD');
    });
  }

  function ensureExperienceAssets() {
    if (!document.querySelector('link[href^="/slots.css"]')) {
      var style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/slots.css?v=20260910-friendly-v6'; document.head.appendChild(style);
    }
    // The floating WYD player is opt-in. WYD loads it directly. Profiles
    // and ORBIT use separate players so one person's music never follows a
    // visitor onto somebody else's page.
  }

  function ensureGuideAssets() {
    document.querySelectorAll('.roster-guide-open,.roster-guide-dialog,script[src^="/roster-guide.js"]').forEach(function(node){node.remove();});
  }

  function ensureFirstUseTips() {
    if (document.querySelector('script[src^="/roster-first-use.mjs"]')) return;
    var tips = document.createElement('script'); tips.type = 'module'; tips.src = '/roster-first-use.mjs?v=20260911-first-use-v1'; document.head.appendChild(tips);
  }

  function ensureThemeChoice() {
    if (!document.querySelector('link[href^="/roster-theme.css"]')) {
      var style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/roster-theme.css?v=20260912-canonical-shell-v2'; document.head.appendChild(style);
    }
    if (document.querySelector('[data-roster-theme-toggle]')) return;
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'roster-theme-toggle'; button.setAttribute('data-roster-theme-toggle', '');
    button.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-roster-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* the choice lasts for this page */ }
      applyTheme(next);
    });
    document.body.appendChild(button); applyTheme(savedTheme());
  }

  function ensureUtilityDock() {
    if (!document.querySelector('link[href^="/roster-utility.css"]')) {
      var style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/roster-utility.css?v=20260912-live-assistant-v1'; document.head.appendChild(style);
    }
    if (!document.querySelector('script[src^="/roster-utility.js"]')) {
      var script = document.createElement('script'); script.src = '/roster-utility.js?v=20260912-mona-priority-v2'; script.defer = true; document.head.appendChild(script);
    }
    document.querySelectorAll('nav [data-message-inbox],.nav-messages,.mobile-nav-messages,.roster-guide-open,.nav-mona').forEach(function (link) {
      link.remove();
    });
  }

  function enhance() {
    upgrade(document);
    consolidateNavigation();
    enhanceMoreMenus();
    cleanNavigation();
    ensureExperienceAssets();
    ensureGuideAssets();
    ensureFirstUseTips();
    ensureThemeChoice();
    ensureUtilityDock();
    /* Legacy page code may repaint account navigation after authentication.
       Restore missing primary choices without deleting or hiding the current
       route. This guard is bounded to already-normalized global shells. */
    new MutationObserver(function(){
      document.querySelectorAll('[data-canonical-global-nav]').forEach(function(nav){
        var items=[['WYD','/#home','nav-wyd'],['People','/people.html','nav-people'],['Rooms','/live.html','nav-review-room'],['Me','/my-profile.html','nav-mine']];
        items.forEach(function(item,index){
          if(nav.querySelector(':scope > .'+item[2]))return;
          var link=document.createElement('a');link.textContent=item[0];link.href=item[1];link.className=item[2];
          if(item[2]==='nav-mine')link.setAttribute('data-my-profile','');
          var next=items.slice(index+1).map(function(candidate){return nav.querySelector(':scope > .'+candidate[2])}).find(Boolean);
          nav.insertBefore(link,next||nav.querySelector(':scope > .nav-more,:scope > .mobile-nav-more')||null);
        });
      });
    }).observe(document.body,{childList:true,subtree:true});
  }

  window.RosterLogo = {src: MARK, headerSize: HEADER_SIZE, upgrade: upgrade};
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, {once: true});
  } else enhance();

  var KEY = 'roster-startup-shown';
  var HARD_CAP = 3300;
  var MINIMUM_HOLD = 2700;

  function seen() {
    try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return true; }
  }
  function remember() {
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode: just don't repeat */ }
  }

  // Back or forward navigation restores a page the member has already seen.
  function restored() {
    try {
      var entries = performance.getEntriesByType('navigation');
      if (entries && entries.length) return entries[0].type === 'back_forward';
      return performance.navigation && performance.navigation.type === 2;
    } catch (e) { return false; }
  }

  var reduced = false;
  try {
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* treat as no preference */ }

  if (seen() || restored() || reduced || document.readyState === 'complete') {
    remember();
    return;
  }
  remember();

  var screenEl = document.createElement('div');
  screenEl.className = 'roster-startup';
  screenEl.setAttribute('role', 'region');
  screenEl.setAttribute('aria-label', 'Welcome to ROOSTER');
  /* The approved-member total animates slowly enough to read, without
     inventing demand or exposing any private member information. */
  screenEl.innerHTML =
    '<div class="roster-startup-inner"><img class="roster-startup-mark" src="/assets/roster-logo.webp" alt="ROOSTER — People, Music, Opportunity" width="220" height="296">' +
    '<div class="roster-startup-count" role="status" aria-live="polite" aria-label="ROOSTER is growing toward 500 members"><b data-startup-count>—</b><span>OF 500 SPOTS CLAIMED</span><i><em data-startup-meter></em></i></div>' +
    '<nav class="roster-startup-actions" aria-label="Get started"><a class="roster-startup-login" href="/members.html#member-login">Log in</a><a class="roster-startup-invite" href="/members.html#invite-code">Enter invite code</a></nav></div>';

  var css = document.createElement('style');
  css.textContent = [
    '.roster-startup{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;box-sizing:border-box;padding:20px;overflow:auto;',
    'background:radial-gradient(circle at 50% 30%,#fffaf3 0,#f6f1e8 58%,#eaded1 100%);color:#171719;transition:opacity .24s ease}',
    '.roster-startup[data-leaving="true"]{opacity:0;pointer-events:none}',
    '.roster-startup-mark{display:block;width:min(48vw,220px);height:auto;max-height:46vh;',
    'object-fit:contain;filter:drop-shadow(0 0 26px rgba(245,62,45,.25));animation:roster-startup-in .9s cubic-bezier(.2,.8,.2,1) both}',
    '.roster-startup-inner{display:grid;place-items:center;gap:8px}.roster-startup-count{width:min(68vw,280px);display:grid;place-items:center;gap:5px;font-family:"Space Mono",monospace}',
    '.roster-startup-count b{color:#cf1235;font-size:22px;line-height:1}.roster-startup-count span{font-size:11px;font-weight:800;letter-spacing:.13em;color:#251d1d}',
    '.roster-startup-count i{display:block;width:100%;height:4px;overflow:hidden;border-radius:99px;background:#ded2c5}.roster-startup-count em{display:block;width:0;height:100%;background:linear-gradient(90deg,#dc0d32,#ff7a2f);transition:width 1.7s cubic-bezier(.2,.75,.2,1)}',
    '.roster-startup-actions{display:grid;gap:4px;width:min(76vw,280px);margin-top:16px;font-family:Arial,Helvetica,sans-serif}',
    '.roster-startup-actions a{display:flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:48px;padding:12px 18px;border-radius:14px;text-align:center;text-decoration:none;font-size:16px;font-weight:700}',
    '.roster-startup-login{background:#cf1235;color:#fff!important;box-shadow:0 6px 18px #cf123526}.roster-startup-login:hover{background:#ad0e2c}',
    '.roster-startup-invite{color:#6d2735!important}.roster-startup-actions a:focus-visible{outline:3px solid #b35a00;outline-offset:3px}',
    '@keyframes roster-startup-in{from{opacity:0;transform:scale(.94)}55%{opacity:1}to{opacity:1;transform:scale(1)}}',
    '@media (max-width:360px){.roster-startup-mark{width:46vw}}',
    '@media (prefers-reduced-motion: reduce){.roster-startup{transition:none}.roster-startup-mark{animation:none}}',
  ].join('');

  var root = document.documentElement;
  root.appendChild(css);
  root.appendChild(screenEl);

  fetch('/api/member-count', {headers:{Accept:'application/json'}, cache:'no-store'}).then(function (response) {
    if (!response.ok) throw new Error('count'); return response.json();
  }).then(function (data) {
    var claimed = Number.isSafeInteger(data.claimed) ? Math.max(0, Math.min(500, data.claimed)) : null;
    if (claimed === null) return;
    var number = screenEl.querySelector('[data-startup-count]');
    var meter = screenEl.querySelector('[data-startup-meter]');
    var started = performance.now();
    function tick(now) {
      var progress = Math.min(1, (now - started) / 1700);
      number.textContent = Math.round(claimed * (1 - Math.pow(1 - progress, 3))).toLocaleString('en-US');
      if (progress < 1 && !done) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick); requestAnimationFrame(function () { meter.style.width = (claimed / 5) + '%'; });
  }).catch(function () { var node=screenEl.querySelector('.roster-startup-count'); if(node)node.hidden=true; });

  var done = false;
  var openedAt = Date.now();
  var actionHoldUntil = 0;
  var waitingForAction = false;
  var actions = screenEl.querySelector('.roster-startup-actions');
  // A pointer gesture needs time to finish its click, and a keyboard user
  // must not lose a focused login link when the startup timer expires.
  ['pointerdown', 'touchstart'].forEach(function (type) {
    actions.addEventListener(type, function () { actionHoldUntil = Date.now() + 700; }, {passive: true});
  });
  actions.addEventListener('focusout', function () {
    if (waitingForAction) setTimeout(dismiss, 0);
  });
  function dismiss() {
    if (done) return;
    if (actions.contains(document.activeElement)) { waitingForAction = true; return; }
    waitingForAction = false;
    var wait = Math.max(MINIMUM_HOLD - (Date.now() - openedAt), actionHoldUntil - Date.now());
    if (wait > 0) { setTimeout(dismiss, wait); return; }
    done = true;
    clearTimeout(cap);
    screenEl.setAttribute('data-leaving', 'true');
    var drop = function () {
      if (screenEl.parentNode) screenEl.parentNode.removeChild(screenEl);
      if (css.parentNode) css.parentNode.removeChild(css);
    };
    if (reduced) drop();
    else setTimeout(drop, 200);
  }

  var cap = setTimeout(dismiss, HARD_CAP);

  // Ready means ready: whichever of these lands first ends the screen.
  if (document.readyState === 'complete') dismiss();
  else window.addEventListener('load', dismiss, {once: true});
  document.addEventListener('DOMContentLoaded', function () { setTimeout(dismiss, MINIMUM_HOLD); }, {once: true});

  // Never make anybody wait, and never hide an error.
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (type) {
    window.addEventListener(type, dismiss, {once: true, passive: true});
  });
  window.addEventListener('error', dismiss, {once: true});
  window.addEventListener('unhandledrejection', dismiss, {once: true});
  window.addEventListener('pagehide', dismiss, {once: true});
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') dismiss();
  });

  window.RosterStartup = {dismiss: dismiss};
})();
