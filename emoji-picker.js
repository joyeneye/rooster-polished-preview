(() => {
 const emojis=['😀','😂','🥹','😍','😎','🤔','🙌','👏','🙏','💪','🔥','💯','❤️','💚','🎵','🎶','🎧','🎤','🎹','🎸','🍏','🍅','👑','✨','🚀','✅','👀','🎉'];
 function attach(input){if(input.dataset.emojiReady)return;input.dataset.emojiReady='true';const wrap=document.createElement('div');wrap.className='emoji-tools';const toggle=document.createElement('button');toggle.type='button';toggle.textContent='😀 Add Emoji';toggle.setAttribute('aria-expanded','false');const tray=document.createElement('div');tray.className='emoji-tray';tray.hidden=true;tray.setAttribute('aria-label','Choose an emoji');
  let start=0,end=0;const remember=()=>{start=input.selectionStart??input.value.length;end=input.selectionEnd??start;};for(const name of ['input','select','keyup','click','blur'])input.addEventListener(name,remember);
  for(const emoji of emojis){const b=document.createElement('button');b.type='button';b.textContent=emoji;b.setAttribute('aria-label',`Insert ${emoji}`);b.addEventListener('click',()=>{if(input.disabled||input.readOnly)return;if(input.maxLength>0&&input.value.length-(end-start)+emoji.length>input.maxLength)return;input.focus();input.setRangeText(emoji,start,end,'end');remember();input.dispatchEvent(new Event('input',{bubbles:true}));tray.hidden=true;toggle.setAttribute('aria-expanded','false');});tray.append(b);}
  toggle.addEventListener('click',()=>{tray.hidden=!tray.hidden;toggle.setAttribute('aria-expanded',String(!tray.hidden));});wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){tray.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});wrap.append(toggle,tray);input.insertAdjacentElement('afterend',wrap);
 }
 function scan(){for(const input of document.querySelectorAll('#member-wall-message, .wall-reply-form textarea, #wall textarea, #comment-wall textarea, form[name="comment-wall"] textarea, textarea[name="message"], textarea[data-photo-caption]'))attach(input);}
 let timer;function run(){scan();new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,80);}).observe(document.body,{childList:true,subtree:true});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
})();
