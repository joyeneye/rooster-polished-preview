const el=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
const button=(text,className)=>{const node=el('button',text,className);node.type='button';return node;};
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
let closeActive=null;
const VIDEO_LOOKS=Object.freeze([
  ['original','Original','none'],['roster-clean','ROOSTER CLEAN','contrast(1.06) brightness(1.02)'],['main-character','MAIN CHARACTER','contrast(1.24) saturate(1.18) brightness(1.03)'],['rich','RICH','contrast(1.27) saturate(1.18) sepia(.06)'],['golden','GOLDEN','brightness(1.06) saturate(1.08) sepia(.17)'],['soft-glow','SOFT GLOW','brightness(1.1) contrast(.91) saturate(.96)'],['studio','STUDIO','contrast(1.11) brightness(1.04)'],['spotlight','SPOTLIGHT','contrast(1.28) saturate(1.22) brightness(1.05)'],['after-dark','AFTER DARK','contrast(1.2) saturate(1.13) brightness(1.13)'],['viral-pop','VIRAL POP','contrast(1.12) saturate(1.3) brightness(1.05)'],['beauty-clean','BEAUTY CLEAN','brightness(1.07) contrast(.98) saturate(1.02)'],['barber-fresh','BARBER FRESH','contrast(1.24) saturate(1.06)'],['hair-glow','HAIR GLOW','contrast(1.12) saturate(1.2) brightness(1.04)'],['product-pop','PRODUCT POP','contrast(1.17) saturate(1.12) brightness(1.06)'],['street-luxe','STREET LUXE','contrast(1.25) saturate(.96)'],['food-heat','FOOD HEAT','contrast(1.12) saturate(1.25) sepia(.12)'],['35mm','35MM','contrast(.94) saturate(.9) sepia(.2)'],['disposable','DISPOSABLE','contrast(1.08) brightness(1.12) saturate(.92)'],['vintage-fade','VINTAGE FADE','contrast(.78) saturate(.74) sepia(.18)'],['cinema','CINEMA','contrast(1.22) saturate(1.08) hue-rotate(4deg)'],['noir','NOIR','grayscale(1) contrast(1.2) brightness(1.04)'],['chrome','CHROME','contrast(1.2) saturate(.9) hue-rotate(12deg)'],['dream','DREAM','brightness(1.12) contrast(.88) saturate(.9)'],['vhs','VHS','contrast(1.08) saturate(.88) hue-rotate(8deg)'],['prism','PRISM','contrast(1.12) saturate(1.13) hue-rotate(3deg)'],
]);
export function validVideoTrim(start,end,max=30){return Number.isFinite(start)&&Number.isFinite(end)&&end-start>=.5&&end-start<=max;}

function lookFilter(id,intensity){
  if(id==='original'||intensity<=0)return 'none';
  const base=VIDEO_LOOKS.find(item=>item[0]===id)?.[2]||'none';
  return base.replace(/(brightness|contrast|saturate|sepia|grayscale|hue-rotate)\((-?[\d.]+)(deg)?\)/g,(_,name,raw,unit='')=>{
    const value=Number(raw),neutral=['brightness','contrast','saturate'].includes(name)?1:0;
    return `${name}(${(neutral+(value-neutral)*intensity).toFixed(3)}${unit})`;
  });
}

function supportedRecorderType(){
  if(typeof MediaRecorder==='undefined')return '';
  return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported?.(type))||'';
}

function seek(video,time){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('The video preview did not respond.')),8000);
    const done=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);resolve();};
    video.addEventListener('seeked',done,{once:true});
    video.currentTime=clamp(time,0,Number.isFinite(video.duration)?video.duration:time);
  });
}

async function exportVideo({video,canvas,start,end,speed,muted,filter,intensity,onProgress,signal}){
  const mimeType=supportedRecorderType();
  const capture=canvas.captureStream?.(30);
  if(!mimeType||!capture)throw new Error('This browser can preview video edits but cannot export them. Try current Chrome, Edge, or Firefox.');
  let audioContext=null,audioSource=null,audioDestination=null;
  if(!muted&&typeof AudioContext!=='undefined'){
    try{audioContext=new AudioContext();audioSource=audioContext.createMediaElementSource(video);audioDestination=audioContext.createMediaStreamDestination();audioSource.connect(audioDestination);audioDestination.stream.getAudioTracks().forEach(track=>capture.addTrack(track));await audioContext.resume();}catch{audioContext=null;}
  }
  const recorder=new MediaRecorder(capture,{mimeType,videoBitsPerSecond:5_000_000});
  const chunks=[];
  recorder.addEventListener('dataavailable',event=>{if(event.data?.size)chunks.push(event.data);});
  const stopped=new Promise((resolve,reject)=>{recorder.addEventListener('stop',resolve,{once:true});recorder.addEventListener('error',()=>reject(recorder.error||new Error('Video export failed.')),{once:true});});
  await seek(video,start);video.playbackRate=speed;video.muted=true;video.volume=0;
  const context=canvas.getContext('2d',{alpha:false});
  let frame=0,canceled=false;
  const abort=()=>{canceled=true;try{video.pause();}catch{}if(recorder.state!=='inactive')recorder.stop();};
  signal?.addEventListener('abort',abort,{once:true});
  recorder.start(250);
  const draw=()=>{
    if(canceled)return;
    context.filter=filter;context.globalAlpha=1;context.drawImage(video,0,0,canvas.width,canvas.height);context.filter='none';
    onProgress(clamp((video.currentTime-start)/(end-start),0,1));
    if(video.currentTime>=end||video.ended){video.pause();if(recorder.state!=='inactive')recorder.stop();return;}
    frame=requestAnimationFrame(draw);
  };
  await video.play();draw();await stopped;cancelAnimationFrame(frame);signal?.removeEventListener('abort',abort);
  capture.getTracks().forEach(track=>track.stop());audioDestination?.stream.getTracks().forEach(track=>track.stop());audioSource?.disconnect();await audioContext?.close().catch(()=>{});
  if(canceled)throw new DOMException('Video export canceled.','AbortError');
  const blob=new Blob(chunks,{type:mimeType.split(';')[0]});
  if(!blob.size)throw new Error('The edited video was empty. Keep the original and try again.');
  return new File([blob],`roster-edited-${Date.now()}.webm`,{type:blob.type,lastModified:Date.now()});
}

export function openRosterVideoEditor(file,{signal,title='Edit Video',applyLabel='Apply Video'}={}){
  closeActive?.();
  if(signal?.aborted)return Promise.resolve(null);
  return new Promise(resolve=>{
    let done=false,url='',duration=0,exporting=false,coverTime=0,look='original',intensity=1;
    const local=new AbortController(),before=document.activeElement;
    const dialog=el('dialog','', 'roster-media-editor roster-video-editor');dialog.setAttribute('aria-label',title);
    const shell=el('div','', 'roster-media-shell');
    const header=el('header'),identity=el('div'),eyebrow=el('p','ROOSTER MEDIA','roster-media-eyebrow'),heading=el('h2',title),close=button('Cancel','roster-media-quiet');identity.append(eyebrow,heading);header.append(identity,close);
    const stage=el('div','', 'roster-video-stage'),video=el('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label','Edited video preview');stage.append(video);
    const timeline=el('section','', 'roster-video-timeline'),trimGrid=el('div','', 'roster-media-grid');
    const startLabel=el('label','Trim start'),start=el('input'),endLabel=el('label','Trim end'),end=el('input');
    [start,end].forEach(input=>{input.type='range';input.min='0';input.step='.05';});startLabel.append(start);endLabel.append(end);trimGrid.append(startLabel,endLabel);
    const time=el('p','Loading duration…','roster-media-meta');timeline.append(trimGrid,time);
    const tools=el('div','', 'roster-video-tools');
    const speedLabel=el('label','Speed'),speed=el('select');['0.5','1','1.5','2'].forEach(value=>{const option=el('option',value+'×');option.value=value;if(value==='1')option.selected=true;speed.append(option);});speedLabel.append(speed);
    const audioLabel=el('label','Original audio'),audio=el('select');[['keep','Keep'],['mute','Mute']].forEach(([value,label])=>{const option=el('option',label);option.value=value;audio.append(option);});audioLabel.append(audio);
    const cover=button('Choose Current Cover','roster-media-tool');tools.append(speedLabel,audioLabel,cover);
    const looks=el('section','', 'roster-video-looks'),looksTitle=el('h3','ROOSTER Looks'),lookStrip=el('div','', 'roster-look-strip'),intensityLabel=el('label','Look intensity'),intensityInput=el('input');intensityInput.type='range';intensityInput.min='0';intensityInput.max='100';intensityInput.value='100';intensityLabel.hidden=true;intensityLabel.append(intensityInput);looks.append(looksTitle,lookStrip,intensityLabel);
    const captionLabel=el('label','Caption'),caption=el('textarea');caption.maxLength=300;caption.rows=2;caption.placeholder='What is this moment about?';captionLabel.append(caption);
    const altLabel=el('label','Video description'),alt=el('textarea');alt.maxLength=500;alt.rows=2;alt.placeholder='Describe important visual details for accessibility';altLabel.append(alt);
    const visibilityLabel=el('label','Audience'),visibility=el('select');[['public','Everyone'],['followers','Followers'],['connections','Connections'],['private','Only me']].forEach(([value,label])=>{const option=el('option',label);option.value=value;visibility.append(option);});visibilityLabel.append(visibility);
    const status=el('p','Preparing video…','roster-media-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const progress=el('progress');progress.max=1;progress.value=0;progress.hidden=true;progress.setAttribute('aria-label','Video export progress');
    const footer=el('footer'),reset=button('Reset','roster-media-quiet'),apply=button(applyLabel,'roster-media-apply');footer.append(reset,apply);
    shell.append(header,stage,timeline,tools,looks,captionLabel,altLabel,visibilityLabel,status,progress,footer);dialog.append(shell);document.body.append(dialog);
    const lookButtons=[];VIDEO_LOOKS.forEach(([id,name])=>{const control=button('', 'roster-look'),thumb=el('canvas');thumb.width=144;thumb.height=144;control.append(thumb,el('span',name));control.setAttribute('aria-label',`${name} video look`);control.setAttribute('aria-pressed',String(id===look));control.addEventListener('click',()=>{const repeated=look===id;look=id;intensityLabel.hidden=!repeated;paintLook();});lookStrip.append(control);lookButtons.push({id,control,thumb});});
    function paintLook(){const filter=lookFilter(look,intensity);video.style.filter=intensity===0?'none':filter;video.style.opacity='1';lookButtons.forEach(item=>item.control.setAttribute('aria-pressed',String(item.id===look)));}
    function paintThumbs(){if(!duration||!video.videoWidth)return;lookButtons.forEach(({id,thumb})=>{const context=thumb.getContext('2d');context.filter=lookFilter(id,1);context.drawImage(video,0,0,thumb.width,thumb.height);context.filter='none';});}
    function controls(){[start,end,speed,audio,cover,caption,alt,visibility,intensityInput,reset,apply,close,...lookButtons.map(item=>item.control)].forEach(control=>control.disabled=exporting||!duration);apply.textContent=exporting?'Exporting…':applyLabel;dialog.setAttribute('aria-busy',String(exporting));}
    function report(){const a=Number(start.value),b=Number(end.value),length=Math.max(0,b-a);time.textContent=`${a.toFixed(1)}s – ${b.toFixed(1)}s · ${(length/Number(speed.value||1)).toFixed(1)}s export`;apply.disabled=exporting||!duration||!validVideoTrim(a,b);status.textContent=length<.5?'Choose at least 0.5 seconds.':length>30?'ROOSTER clips can be up to 30 seconds. Shorten the trim.':'Preview the trim, choose a cover, then apply.';}
    function finish(result){if(done)return;done=true;local.abort();signal?.removeEventListener('abort',abort);try{video.pause();}catch{}if(url)URL.revokeObjectURL(url);dialog.remove();if(closeActive===abort)closeActive=null;if(before?.isConnected)before.focus({preventScroll:true});resolve(result);}
    const abort=()=>finish(null);closeActive=abort;signal?.addEventListener('abort',abort,{once:true});close.addEventListener('click',abort);dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});
    video.addEventListener('loadedmetadata',()=>{duration=Math.min(video.duration||0,600);start.max=end.max=String(duration);start.value='0';end.value=String(Math.min(duration,30));coverTime=0;canvas.width=Math.min(video.videoWidth||1280,1280);canvas.height=Math.round(canvas.width*(video.videoHeight||720)/(video.videoWidth||1280));controls();report();paintLook();void seek(video,0).then(paintThumbs).catch(()=>{});});
    video.addEventListener('error',()=>{status.textContent='This browser cannot preview that video codec. Your original is unchanged.';});
    start.addEventListener('input',()=>{if(Number(start.value)>Number(end.value)-.5)start.value=String(Math.max(0,Number(end.value)-.5));video.currentTime=Number(start.value);report();});
    end.addEventListener('input',()=>{if(Number(end.value)<Number(start.value)+.5)end.value=String(Math.min(duration,Number(start.value)+.5));video.currentTime=Number(end.value);report();});speed.addEventListener('change',report);
    cover.addEventListener('click',()=>{coverTime=video.currentTime;cover.textContent=`Cover ${coverTime.toFixed(1)}s`;status.textContent='Cover frame selected.';});
    intensityInput.addEventListener('input',()=>{intensity=Number(intensityInput.value)/100;paintLook();});
    reset.addEventListener('click',()=>{start.value='0';end.value=String(Math.min(duration,30));speed.value='1';audio.value='keep';caption.value='';alt.value='';visibility.value='public';coverTime=0;look='original';intensity=1;intensityInput.value='100';intensityLabel.hidden=true;cover.textContent='Choose Current Cover';video.currentTime=0;paintLook();report();});
    const canvas=el('canvas');canvas.hidden=true;shell.append(canvas);
    apply.addEventListener('click',async()=>{if(exporting||apply.disabled)return;exporting=true;progress.hidden=false;progress.value=0;controls();status.textContent='Exporting an upload-ready copy. Your original stays unchanged…';const controller=new AbortController();local.signal.addEventListener('abort',()=>controller.abort(),{once:true});
      try{const derivative=await exportVideo({video,canvas,start:Number(start.value),end:Number(end.value),speed:Number(speed.value),muted:audio.value==='mute',filter:lookFilter(look,intensity),intensity,signal:controller.signal,onProgress:value=>{progress.value=value;}});finish({file:derivative,caption:caption.value.trim(),alt:alt.value.trim(),visibility:visibility.value,trim:{start:Number(start.value),end:Number(end.value)},speed:Number(speed.value),muted:audio.value==='mute',coverTime,look,intensity});}
      catch(error){exporting=false;progress.hidden=true;controls();status.textContent=error?.name==='AbortError'?'Export canceled. Your original is unchanged.':(error?.message||'The edited video could not be exported. Your original is unchanged.');}
    });
    url=URL.createObjectURL(file);video.src=url;controls();dialog.showModal();requestAnimationFrame(()=>close.focus({preventScroll:true}));
  });
}
