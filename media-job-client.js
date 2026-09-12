/** Wait for server preparation without treating transfer completion as publication. */
export async function waitForMediaJob(initial,{request,isCurrent=()=>true,onProgress=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxPolls=190}) {
  if(initial?.processing!==true)return initial;
  const id=initial.job_id;
  if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Invalid processing receipt.');
  for(let count=0;count<maxPolls;count++){
    if(!isCurrent())throw new DOMException('Processing check paused','AbortError');
    onProgress('Your upload is saved. Preparing it on the server and checking it before publication…');
    await sleep(2500);
    if(!isCurrent())throw new DOMException('Processing check paused','AbortError');
    const result=await request(`/api/media-jobs/${id}`);
    if(result?.processing===true){if(result.job_id!==id)throw new Error('Unexpected processing receipt.');continue;}
    return result;
  }
  const error=new Error('Your upload is saved, but processing has not finished. Tap the button again to check it.');
  error.status=409;throw error;
}
export function selectPhoneVideo(file) {
  if(!file?.size||file.size>100*1024*1024)throw new Error('Choose a video up to 100 MB.');
  if(!/^video\//.test(file.type||'')&&!/\.(mp4|mov|m4v|webm)$/i.test(file.name||''))throw new Error('Choose an MP4, MOV, M4V or WebM video.');
  // Do not require Safari to decode or transcode before uploading. The server
  // validates the actual contents, duration and prepared codec before publishing.
  return file;
}
