// Produces a compatible copy on the device. Never requests camera/microphone,
// uploads the original, changes the saved original, or bypasses server moderation.
export const PHONE_SOURCE_LIMIT=100*1024*1024;
const PRIVATE_VIDEO_LIMIT=4*1024*1024;
const SCREENING_VIDEO_LIMIT=12*1024*1024;
export async function preparePhoneVideo(file,{signal,onProgress=()=>{},maxBytes=SCREENING_VIDEO_LIMIT}={}) {
 if(!file?.size||file.size>PHONE_SOURCE_LIMIT)throw new Error('Choose a source video up to 100 MB.');
 const outputLimit=maxBytes===PRIVATE_VIDEO_LIMIT?PRIVATE_VIDEO_LIMIT:SCREENING_VIDEO_LIMIT;
 const aborted=()=>new DOMException('Video preparation canceled.','AbortError');
 if(signal?.aborted)throw aborted();
 const Audio=window.AudioContext||window.webkitAudioContext;
 const canvas=document.createElement('canvas');
 if(typeof MediaRecorder==='undefined'||!canvas.captureStream||!Audio)throw new Error(`This browser cannot prepare that video. Open the site in Safari or Chrome, or export an H.264 MP4 under ${outputLimit/1024/1024} MB.`);
 const formats=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'];
 const mimeType=formats.find(type=>MediaRecorder.isTypeSupported(type));
 if(!mimeType)throw new Error(`This browser cannot prepare that video. Use an H.264 MP4 under ${outputLimit/1024/1024} MB.`);
 const context=new Audio();
 // Start audio during the explicit Prepare button gesture; never silently drop sound.
 const resume=context.resume();
 const video=document.createElement('video');video.playsInline=true;video.preload='auto';video.muted=false;
 const url=URL.createObjectURL(file);let stream,recorder,frame,deadline,settled=false,cancelRecord;
 const cancel=()=>{cancelRecord?.(aborted());try{video.pause();}catch{}};
 signal?.addEventListener('abort',cancel,{once:true});
 try {
  await resume;if(context.state!=='running')throw new Error('Tap Prepare for Upload again to enable the video audio.');
  const source=context.createMediaElementSource(video),destination=context.createMediaStreamDestination();source.connect(destination);
  await new Promise((resolve,reject)=>{const done=error=>{clearTimeout(timer);video.onloadedmetadata=video.onerror=null;signal?.removeEventListener('abort',onAbort);error?reject(error):resolve();};const onAbort=()=>done(aborted());const timer=setTimeout(()=>done(new Error('The phone could not read this video. Save it to your device from iCloud or Google Photos and try again.')),30_000);signal?.addEventListener('abort',onAbort,{once:true});video.onloadedmetadata=()=>done();video.onerror=()=>done(new Error('This browser cannot open this format. Export an H.264 MP4 and try again.'));video.src=url;video.load();});
  if(signal?.aborted)throw aborted();
  if(!Number.isFinite(video.duration)||video.duration<=0||video.duration>30)throw new Error('Trim this video to 30 seconds or less in your Photos app, then choose it again.');
  if(!video.videoWidth||!video.videoHeight)throw new Error('The phone could not read the video picture. Try another video.');
  const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(2,Math.round(video.videoWidth*scale/2)*2);canvas.height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
  const drawing=canvas.getContext('2d',{alpha:false});if(!drawing)throw new Error('Video preparation is unavailable in this browser.');
  stream=canvas.captureStream(24);for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
  // Stay beneath the selected upload ceiling while giving shorter clips more
  // picture detail. The server still validates every byte of the result.
  const audioBitsPerSecond=64_000;
  const availableBits=Math.floor(outputLimit*8*.85/video.duration)-audioBitsPerSecond;
  const videoBitsPerSecond=Math.max(400_000,Math.min(1_500_000,availableBits));
  try{recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond,audioBitsPerSecond});}
  catch{recorder=new MediaRecorder(stream,{mimeType});}
  const recorded=new Promise((resolve,reject)=>{let chunks=[],bytes=0;
   const fail=error=>{if(settled)return;settled=true;reject(error);};cancelRecord=fail;
   recorder.ondataavailable=e=>{if(e.data.size){bytes+=e.data.size;if(bytes>outputLimit){fail(new Error('The prepared video is still too large. Try a shorter clip.'));try{recorder.stop();}catch{}return;}chunks.push(e.data);}};
   recorder.onerror=()=>fail(new Error('Video preparation stopped. Keep the page open and try again.'));
   recorder.onstop=()=>{if(settled)return;const type=mimeType.startsWith('video/mp4')?'video/mp4':'video/webm';const result=new File(chunks,type==='video/mp4'?'phone-video.mp4':'phone-video.webm',{type});if(!result.size||result.size>outputLimit){fail(new Error('The prepared video is still too large. Try a shorter clip.'));return;}settled=true;resolve(result);};
   video.onended=()=>{if(recorder.state!=='inactive')recorder.stop();};
   deadline=setTimeout(()=>{fail(new Error('Video preparation took too long. Keep the page open and try again.'));},45_000);
  });
  const draw=()=>{if(!video.paused&&!video.ended)drawing.drawImage(video,0,0,canvas.width,canvas.height);onProgress(Math.min(99,Math.floor(video.currentTime/video.duration*100)));if(!settled)frame=requestAnimationFrame(draw);};
  recorder.start(500);draw();
  try{await video.play();}catch{cancelRecord(new Error('Playback was blocked. Tap Prepare for Upload again.'));}
  const result=await recorded;onProgress(100);return result;
 } finally {
  settled=true;clearTimeout(deadline);cancelAnimationFrame(frame);signal?.removeEventListener('abort',cancel);
  if(recorder){recorder.onstop=recorder.onerror=recorder.ondataavailable=null;if(recorder.state!=='inactive')try{recorder.stop();}catch{}}
  for(const track of stream?.getTracks()||[])track.stop();try{video.pause();video.removeAttribute('src');video.load();}catch{}URL.revokeObjectURL(url);await context.close().catch(()=>{});
 }
}
