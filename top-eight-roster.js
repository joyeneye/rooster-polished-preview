(function () {
  'use strict';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function targetFor(host) {
    var value = host.dataset.target;
    if (value && value !== 'profile') return value;
    return new URLSearchParams(location.search).get('id') || 'owner';
  }
  async function request(url, options) {
    var response = await fetch(url, Object.assign({credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}, options || {}));
    var body = await response.json().catch(function(){return {};});
    if (!response.ok) {
      var error = new Error(response.status === 401 ? 'Log in to see your Top 8 Roster.' : body.error || 'Your Top 8 could not connect. Please try again.');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function cleanMembers(value) {
    var seen = new Set();
    return (Array.isArray(value) ? value : []).filter(function(member){
      if (!member || !UUID.test(member.id || '') || seen.has(member.id)) return false;
      seen.add(member.id); return true;
    });
  }
  function mount(host) {
    var list = host.querySelector('[data-top-eight-list]');
    var status = host.querySelector('[data-top-eight-status]');
    var edit = host.querySelector('[data-top-eight-edit]');
    var actions = host.querySelector('[data-top-eight-actions]');
    var save = host.querySelector('[data-top-eight-save]');
    var cancel = host.querySelector('[data-top-eight-cancel]');
    if (!list) return;
    if (!status) { status=document.createElement('p'); status.className='top-eight-roster-status'; status.dataset.topEightStatus=''; }
    status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
    // Keep status outside the scrolling people row so it never takes a ninth spot.
    host.appendChild(status);
    var clear = document.createElement('button'); clear.type='button'; clear.textContent='Clear Top 8'; clear.dataset.topEightClear='';
    if (actions) actions.prepend(clear);
    if (edit) edit.hidden=true;
    if (save) save.textContent='Save Top 8';
    var target=targetFor(host), members=[], available=[], original=[], selected=[], editing=false, editable=false, mode='community', saving=false;
    function message(value) { status.textContent=value; }
    function defaultMessage() {
      if (!members.length) return editable ? 'Choose people with Edit Top 8.' : 'No Top 8 picks yet.';
      return mode === 'community' ? (editable ? 'Community picks · Make it yours with Edit Top 8.' : 'Community picks') : '';
    }
    function optionsFor(index) {
      return available.filter(function(member){ return member.id === selected[index] || !selected.includes(member.id); });
    }
    function render() {
      list.replaceChildren();
      list.classList.toggle('is-choosing',editing);
      if (edit) edit.hidden=editing||!editable;
      if (actions) actions.hidden=!editing;
      if (editing) {
        for (var i=0;i<8;i++) (function(index){
          var label=document.createElement('label'); label.className='top-eight-choice';
          var number=document.createElement('span'); number.textContent=String(index+1);
          var select=document.createElement('select'); select.setAttribute('aria-label','Person for Top 8 spot '+(index+1));
          var empty=document.createElement('option'); empty.value=''; empty.textContent='Empty spot'; select.appendChild(empty);
          optionsFor(index).forEach(function(member){var option=document.createElement('option');option.value=member.id;option.textContent=member.name;select.appendChild(option);});
          select.value=selected[index]||'';
          select.addEventListener('change',function(){selected[index]=select.value;render();message('Choose your people, then tap Save Top 8.');list.querySelectorAll('select')[index]?.focus();});
          label.append(number,select);list.appendChild(label);
        })(i);
      } else members.forEach(function(member,index){
        var link=document.createElement('a');link.className='top-eight-person';link.href='/profile.html?id='+encodeURIComponent(member.id);link.setAttribute('role','listitem');
        var photo=document.createElement('img');photo.src=member.photo_url||'/roster-icon-192.png';photo.alt='';photo.loading='lazy';
        photo.addEventListener('error',function(){if(photo.getAttribute('src')!=='/roster-icon-192.png')photo.src='/roster-icon-192.png';},{once:true});
        var number=document.createElement('span');number.dataset.position='';number.textContent=String(index+1);
        var name=document.createElement('strong');name.textContent=member.name;link.title=member.name;
        link.append(photo,number,name);list.appendChild(link);
      });
      message(editing?'Choose a person for each spot. Empty spot removes a pick.':defaultMessage());
    }
    function apply(data) {
      members=cleanMembers(data.members).slice(0,8);
      available=cleanMembers([...(data.available_members||[]),...members]);
      original=members.slice();editable=data.editable===true;mode=data.mode==='custom'?'custom':'community';
      host.dataset.editable=String(editable);render();
    }
    edit?.addEventListener('click',function(){if(!editable)return;original=members.slice();selected=Array.from({length:8},function(_,i){return members[i]?.id||'';});editing=true;render();list.querySelector('select')?.focus();});
    clear.addEventListener('click',function(){if(saving)return;selected=Array(8).fill('');render();message('All spots cleared. Tap Save Top 8 to keep this change.');});
    cancel?.addEventListener('click',function(){if(saving)return;members=original.slice();editing=false;render();edit?.focus();});
    save?.addEventListener('click',async function(){
      if(saving||!editing)return;
      saving=true;save.disabled=true;clear.disabled=true;if(cancel)cancel.disabled=true;
      list.querySelectorAll('select').forEach(function(select){select.disabled=true;});
      message('Saving your Top 8…');
      try {
        var data=await request('/api/top-eight-roster?target_id=self',{method:'PUT',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({order:selected.filter(Boolean)})});
        editing=false;apply(data);message('Your Top 8 is saved.');edit?.focus();
      } catch(error) {render();message(error.message);}
      finally {saving=false;save.disabled=false;clear.disabled=false;if(cancel)cancel.disabled=false;}
    });
    message('Opening your Top 8…');
    request('/api/top-eight-roster?target_id='+encodeURIComponent(target)).then(apply).catch(function(error){message(error.message);if(edit)edit.hidden=true;});
  }
  function start(){document.querySelectorAll('[data-top-eight-roster]').forEach(mount);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
