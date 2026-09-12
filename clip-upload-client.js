// This only transfers bytes. A separate authenticated final request validates
// and saves the video; a progress bar reaching 100% does not mean published.
export async function transferClip(file,{kind = 'clip',request,requestId,onProgress=()=>{},isCurrent=()=>true}) {
  const limit=100*1024*1024;
  if(!file?.size || file.size>limit) throw new Error('Choose a video up to 100 MB.');
  const active=()=>{if(!isCurrent())throw new DOMException('Upload canceled','AbortError');};
  active();
  const start=await request('/api/video-uploads/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,kind,name:file.name,size:file.size})});
  if(start.upload_id!==requestId || start.part_bytes!==2*1024*1024 || start.parts!==Math.ceil(file.size/start.part_bytes)) throw new Error('The upload could not be started. Refresh and try again.');
  for(let part=0;part<start.parts;part++) {
    active(); const begin=part*start.part_bytes; const bytes=file.slice(begin,Math.min(file.size,begin+start.part_bytes));
    let result;
    for(let attempt=0;attempt<3;attempt++) {
      active();
      try {result=await request(`/api/video-uploads/part?upload_id=${encodeURIComponent(start.upload_id)}&part=${part}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes});break;}
      catch(error) {if(!isCurrent() || error.name==='AbortError' || (error.status && error.status<500) || attempt===2)throw error; await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
    }
    active();
    if(result?.upload_id!==start.upload_id || result.part!==part || result.received!==bytes.size)throw new Error('An upload part was not confirmed. Tap upload again to resume.');
    onProgress(Math.round(Math.min(file.size,begin+bytes.size)/file.size*100));
  }
  active(); return start.upload_id;
}
