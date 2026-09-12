import {PHOTO_FILTERS, normalizePhotoEffects, renderPhotoEffects} from './photo-effects.js?v=20260910-working-camera-v4';

const PREVIEW_FILTERS = Object.freeze({
  original: 'none',
  'roster-clean':'contrast(1.06) brightness(1.02)', 'main-character':'contrast(1.24) saturate(1.18) brightness(1.03)',
  rich:'contrast(1.27) saturate(1.18) sepia(.06)', golden:'brightness(1.06) saturate(1.08) sepia(.17)',
  'soft-glow':'brightness(1.1) contrast(.91) saturate(.96)', studio:'contrast(1.11) brightness(1.04)',
  spotlight:'contrast(1.28) saturate(1.22) brightness(1.05)', 'after-dark':'contrast(1.2) saturate(1.13) brightness(1.13)',
  'viral-pop':'contrast(1.12) saturate(1.3) brightness(1.05)', 'beauty-clean':'brightness(1.07) contrast(.98) saturate(1.02)',
  'barber-fresh':'contrast(1.24) saturate(1.06)', 'hair-glow':'contrast(1.12) saturate(1.2) brightness(1.04)',
  'product-pop':'contrast(1.17) saturate(1.12) brightness(1.06)', 'street-luxe':'contrast(1.25) saturate(.96)',
  'food-heat':'contrast(1.12) saturate(1.25) sepia(.12)', '35mm':'contrast(.94) saturate(.9) sepia(.2)',
  disposable:'contrast(1.08) brightness(1.12) saturate(.92)', 'vintage-fade':'contrast(.78) saturate(.74) sepia(.18)',
  cinema:'contrast(1.22) saturate(1.08) hue-rotate(4deg)', noir:'grayscale(1) contrast(1.2) brightness(1.04)',
  chrome:'contrast(1.2) saturate(.9) hue-rotate(12deg)', dream:'brightness(1.12) contrast(.88) saturate(.9)',
  vhs:'contrast(1.08) saturate(.88) hue-rotate(8deg)', prism:'contrast(1.12) saturate(1.13) hue-rotate(3deg)',
});

let closeActiveCamera = null;

export function cameraPreviewFilter(value) {
  const id = normalizePhotoEffects({filter:value}).filter;
  return PREVIEW_FILTERS[id] || PREVIEW_FILTERS.original;
}

export function cameraCoverCrop(width, height, aspect = 1) {
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const target = Number(aspect) > 0 ? Number(aspect) : sourceWidth / sourceHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  if (sourceAspect > target) {
    const cropWidth = sourceHeight * target;
    return {x: (sourceWidth - cropWidth) / 2, y: 0, width: cropWidth, height: sourceHeight};
  }
  const cropHeight = sourceWidth / target;
  return {x: 0, y: (sourceHeight - cropHeight) / 2, width: sourceWidth, height: cropHeight};
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, className) {
  const element = node('button', text, className);
  element.type = 'button';
  return element;
}

function canvasBlob(canvas, type = 'image/jpeg', quality = .92) {
  return new Promise((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error('The picture could not be captured.')),
    type,
    quality,
  ));
}

/**
 * A first-party camera for profile and album photos. The live preview and the
 * saved derivative use the same selected look, and no file leaves the device
 * until the caller's existing Save or Upload action runs.
 */
export function openRosterCamera({
  signal,
  title = 'Take a Photo',
  aspect = 1,
  initialFilter = 'original',
  applyLabel = 'Use Photo',
  postComposer = false,
  initialCaption = '',
  initialLocation = '',
  onShare = null,
} = {}) {
  closeActiveCamera?.();
  if (signal?.aborted) return Promise.resolve(null);

  return new Promise(resolve => {
    const before = document.activeElement;
    const local = new AbortController();
    let done = false;
    let stream = null;
    let facing = 'user';
    let captured = null;
    let stillUrl = '';
    let opening = false;
    let renderSequence = 0;
    let thumbTimer = null;
    let previewFrame = 0;
    let previewPaintedAt = 0;
    let selected = normalizePhotoEffects({filter: initialFilter, strength: 1, overlay: 'none'}).filter;
    let strength = 1;
    let busy = false;
    let composeStep = false;
    const pageScroll = window.scrollY;
    const previousOverflow = document.body.style.overflow;

    const dialog = node('dialog', '', 'roster-camera');
    dialog.setAttribute('aria-label', title);
    const shell = node('div', '', 'roster-camera-shell');
    const header = node('header', '', 'roster-camera-header');
    const headingWrap = node('div');
    headingWrap.append(node('p', 'ROOSTER CAMERA', 'roster-camera-eyebrow'), node('h2', title));
    const close = button('Close', 'roster-camera-close');
    header.append(headingWrap, close);

    const stage = node('div', '', 'roster-camera-stage');
    stage.style.setProperty('--camera-aspect', String(Number(aspect) > 0 ? Number(aspect) : 1));
    stage.dataset.facing = facing;
    const video = node('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', 'Camera preview');
    const liveCanvas = node('canvas', '', 'roster-camera-live-preview');
    liveCanvas.hidden = true;
    const still = node('img');
    still.alt = 'Your captured photo preview';
    still.hidden = true;
    const stageMessage = node('p', 'Opening your camera…', 'roster-camera-stage-message');
    stage.append(video, liveCanvas, still, stageMessage);

    const looks = node('section', '', 'roster-camera-looks');
    const lookHeading = node('div', '', 'roster-camera-looks-heading');
    lookHeading.append(node('h3', `${PHOTO_FILTERS.length} Filters`), node('p', 'Swipe, tap a look, then take your photo.'));
    const strip = node('div', '', 'roster-camera-look-strip');
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Camera filters');
    const lookButtons = [];
    for (const filter of PHOTO_FILTERS) {
      const control = button('', 'roster-camera-look');
      const swatch = node('canvas', '', 'roster-camera-look-preview');swatch.width=108;swatch.height=108;
      control.append(swatch, node('span', filter.name));
      control.setAttribute('aria-label', `${filter.name} filter`);
      control.addEventListener('click', () => {
        const repeated=selected===filter.id;selected = filter.id;
        if (!repeated) { strength = 1; intensity.value = '100'; }
        intensityWrap.hidden=!repeated;
        paintLooks();
        if (captured) void renderStill();
      });
      lookButtons.push({id: filter.id, control, swatch});
      strip.append(control);
    }
    const intensityWrap=node('label','Intensity','roster-camera-intensity'),intensity=node('input');intensity.type='range';intensity.min='0';intensity.max='100';intensity.value='100';intensityWrap.hidden=true;intensityWrap.append(intensity);
    intensity.addEventListener('input',()=>{strength=Number(intensity.value)/100;if(captured)void renderStill();});
    looks.append(lookHeading, strip, intensityWrap);

    const status = node('p', 'Nothing is saved until you choose Use Photo.', 'roster-camera-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const postFields=node('section','','roster-camera-post-fields');postFields.hidden=true;
    const captionLabel=node('label','Caption','roster-camera-field'),caption=node('textarea');caption.maxLength=500;caption.rows=3;caption.placeholder='Write a caption…';caption.value=String(initialCaption||'').slice(0,500);captionLabel.append(caption);
    const locationLabel=node('label','Add location (optional)','roster-camera-field'),locationRow=node('div','','roster-camera-location-row'),location=node('input');location.type='text';location.maxLength=100;location.placeholder='City or place';location.value=String(initialLocation||'').slice(0,100);const removeLocation=button('Remove','roster-camera-location-remove');removeLocation.type='button';removeLocation.hidden=!location.value;location.addEventListener('input',()=>{removeLocation.hidden=!location.value});removeLocation.addEventListener('click',()=>{location.value='';removeLocation.hidden=true;location.focus()});locationRow.append(location,removeLocation);locationLabel.append(locationRow);postFields.append(captionLabel,locationLabel,node('p','Location is optional. Type only the city or place you want people to see.','roster-camera-location-note'));
    const controls = node('div', '', 'roster-camera-controls');
    const flip = button('Switch Camera', 'roster-camera-secondary');
    const retake = button('Retake', 'roster-camera-secondary');
    retake.hidden = true;
    const shutter = button('Take Photo', 'roster-camera-shutter');
    const use = button(applyLabel, 'roster-camera-use');
    use.hidden = true;
    controls.append(flip, retake, shutter, use);
    shell.append(header, stage, looks, postFields, status, controls);
    dialog.append(shell);
    document.body.append(dialog);

    function paintLooks() {
      const css = cameraPreviewFilter(selected);
      video.style.setProperty('--camera-filter', css);
      for (const item of lookButtons) item.control.setAttribute('aria-pressed', String(item.id === selected));
    }

    // Draw the active look from the real camera frame. This avoids a fake
    // decorative preview: the member sees the same local pixel renderer that
    // is permanently applied to the saved picture.
    function paintLivePreview(time = 0) {
      if (done) return;
      previewFrame = requestAnimationFrame(paintLivePreview);
      if (captured || !stream || !video.videoWidth || time - previewPaintedAt < 66) return;
      previewPaintedAt = time;
      try {
        const ratio = Number(aspect) > 0 ? Number(aspect) : 1;
        const width = 360;
        const height = Math.max(1, Math.round(width / ratio));
        if (liveCanvas.width !== width || liveCanvas.height !== height) { liveCanvas.width = width; liveCanvas.height = height; }
        const context = liveCanvas.getContext('2d', {alpha:false});
        if (!context) return;
        const crop = cameraCoverCrop(video.videoWidth, video.videoHeight, ratio);
        context.setTransform(1,0,0,1,0,0);
        context.clearRect(0,0,width,height);
        if (facing === 'user') { context.translate(width,0); context.scale(-1,1); }
        context.drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,width,height);
        context.setTransform(1,0,0,1,0,0);
        renderPhotoEffects(context,width,height,{filter:selected,strength,overlay:'none'});
        liveCanvas.hidden = false;
        video.classList?.add('is-rendering-filter');
      } catch {
        liveCanvas.hidden = true;
        video.classList?.remove('is-rendering-filter');
      }
    }

    function paintActualThumbnails() {
      if(done||captured||!video.videoWidth)return;
      for(const item of lookButtons){
        const context=item.swatch.getContext?.('2d',{alpha:false});if(!context)continue;
        try{context.save();if(facing==='user'){context.translate(item.swatch.width,0);context.scale(-1,1);}context.drawImage(video,0,0,item.swatch.width,item.swatch.height);context.restore();renderPhotoEffects(context,item.swatch.width,item.swatch.height,{filter:item.id,strength:1,overlay:'none'});}catch{/* next camera frame will retry */}
      }
    }
    function scheduleThumbnails(){if(done)return;paintActualThumbnails();thumbTimer=setTimeout(scheduleThumbnails,900);thumbTimer?.unref?.();}

    function stopCamera() {
      for (const track of stream?.getTracks?.() || []) {
        track.enabled = false;
        track.stop();
      }
      stream = null;
      video.srcObject = null;
    }

    async function getCamera(mode, strict = false) {
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error('This browser cannot open the camera here. Use Choose from Photos instead.');
      const facingMode = strict ? {exact: mode} : {ideal: mode};
      return media.getUserMedia({
        audio: false,
        video: {facingMode, width: {ideal: 1440}, height: {ideal: 1920}},
      });
    }

    async function startCamera(mode, strict = false) {
      if (opening || done) return false;
      opening = true;
      flip.disabled = shutter.disabled = true;
      stageMessage.hidden = false;
      stageMessage.textContent = mode === facing ? 'Opening your camera…' : 'Switching camera…';
      stopCamera();
      try {
        try { stream = await getCamera(mode, strict); }
        catch (error) {
          if (!strict || !['OverconstrainedError', 'NotFoundError'].includes(error?.name)) throw error;
          stream = await getCamera(mode, false);
        }
        if (done) { stopCamera(); return false; }
        facing = stream.getVideoTracks?.()[0]?.getSettings?.().facingMode || mode;
        if (!['user', 'environment'].includes(facing)) facing = mode;
        stage.dataset.facing = facing;
        video.srcObject = stream;
        await video.play().catch(() => {});
        if (!video.videoWidth) await new Promise(resolveReady => {
          const timer = setTimeout(resolveReady, 1800);
          video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolveReady(); }, {once:true});
        });
        if (!video.videoWidth && !video.readyState) throw new Error('The camera opened but did not send a picture. Tap Try Camera Again.');
        stageMessage.hidden = true;
        status.textContent = `${facing === 'user' ? 'Front' : 'Rear'} camera ready. Pick a filter, then take your photo.`;
        return true;
      } catch (error) {
        const denied = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(error?.name);
        stageMessage.hidden = false;
        stageMessage.textContent = denied
          ? 'Camera permission is off. Allow camera access for this site, then try again.'
          : (error?.message || 'The camera could not open. Use Choose from Photos instead.');
        status.textContent = 'Your current photo is unchanged.';
        return false;
      } finally {
        opening = false;
        flip.disabled = false;
        shutter.disabled = !stream;
      }
    }

    function outputSize(crop) {
      const ratio = crop.width / crop.height;
      if (ratio >= 1) {
        const width = Math.max(1, Math.round(Math.min(1440, crop.width)));
        return {width, height: Math.max(1, Math.round(width / ratio))};
      }
      const height = Math.max(1, Math.round(Math.min(1440, crop.height)));
      return {width: Math.max(1, Math.round(height * ratio)), height};
    }

    function drawCapture(canvas) {
      const width = video.videoWidth || stream?.getVideoTracks?.()[0]?.getSettings?.().width || 1080;
      const height = video.videoHeight || stream?.getVideoTracks?.()[0]?.getSettings?.().height || 1440;
      const crop = cameraCoverCrop(width, height, aspect);
      const size = outputSize(crop);
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d', {alpha: false});
      if (!context) throw new Error('This browser could not prepare the picture.');
      // Only the live front-camera preview is mirrored. Saved pixels retain
      // their real orientation, matching ordinary phone camera behavior.
      context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      return context;
    }

    async function renderStill() {
      if (!captured || done) return;
      const sequence = ++renderSequence;
      use.disabled = true;
      status.textContent = 'Applying your filter…';
      try {
        const output = node('canvas');
        output.width = captured.canvas.width;
        output.height = captured.canvas.height;
        const context = output.getContext('2d', {alpha: false});
        context.drawImage(captured.canvas, 0, 0);
        const settings = normalizePhotoEffects({filter: selected, strength, overlay: 'none'});
        renderPhotoEffects(context, output.width, output.height, settings);
        const blob = await canvasBlob(output);
        if (done || sequence !== renderSequence || !captured) return;
        captured.filtered = new File([blob], `roster-camera-${Date.now()}.jpg`, {type: 'image/jpeg', lastModified: Date.now()});
        captured.settings = settings;
        if (stillUrl) URL.revokeObjectURL(stillUrl);
        stillUrl = URL.createObjectURL(blob);
        still.src = stillUrl;
        status.textContent = `${PHOTO_FILTERS.find(item => item.id === selected)?.name || 'Original'} selected. Retake it or use this photo.`;
      } catch (error) {
        status.textContent = error?.message || 'That filter could not be applied. Try Original.';
      } finally {
        use.disabled = !captured?.filtered;
      }
    }

    async function takePhoto() {
      if (!stream || opening || done) return;
      shutter.disabled = flip.disabled = true;
      status.textContent = 'Capturing…';
      try {
        const canvas = node('canvas');
        drawCapture(canvas);
        const raw = await canvasBlob(canvas);
        captured = {
          sequence: Date.now(), canvas,
          source: new File([raw], `roster-camera-original-${Date.now()}.jpg`, {type: 'image/jpeg', lastModified: Date.now()}),
          filtered: null, settings: null,
        };
        video.hidden = true;
        liveCanvas.hidden = true;
        still.hidden = false;
        shutter.hidden = true;
        flip.hidden = true;
        retake.hidden = false;
        use.hidden = false;
        use.textContent=postComposer?'Next':applyLabel;
        await renderStill();
      } catch (error) {
        status.textContent = error?.message || 'The picture could not be captured. Try again.';
        shutter.disabled = false;
        flip.disabled = false;
      }
    }

    function retakePhoto() {
      renderSequence += 1;
      captured = null;
      if (stillUrl) URL.revokeObjectURL(stillUrl);
      stillUrl = '';
      still.removeAttribute('src');
      still.hidden = true;
      video.hidden = false;
      liveCanvas.hidden = !stream;
      shutter.hidden = false;
      flip.hidden = false;
      retake.hidden = true;
      use.hidden = true;
      composeStep=false;postFields.hidden=true;looks.hidden=false;use.textContent=postComposer?'Next':applyLabel;
      shutter.disabled = !stream;
      flip.disabled = false;
      status.textContent = 'Camera ready. Pick a filter, then take your photo.';
      void video.play().catch(() => {});
    }

    function finish(value) {
      if (done) return;
      done = true;
      local.abort();
      if(thumbTimer!==null)clearTimeout(thumbTimer);
      if(previewFrame)cancelAnimationFrame(previewFrame);
      signal?.removeEventListener('abort', abort);
      stopCamera();
      if (closeActiveCamera === abort) closeActiveCamera = null;
      dialog.classList.add('is-closing');
      const finalize=()=>{if(stillUrl)URL.revokeObjectURL(stillUrl);dialog.remove();document.body.style.overflow=previousOverflow;window.scrollTo(0,pageScroll);if(before?.isConnected)before.focus({preventScroll:true});resolve(value)};
      if(matchMedia('(prefers-reduced-motion:reduce)').matches)finalize();else setTimeout(finalize,160);
    }

    const abort = () => finish(null);
    closeActiveCamera = abort;
    signal?.addEventListener('abort', abort, {once: true});
    close.addEventListener('click', abort);
    dialog.addEventListener('cancel', event => { event.preventDefault(); abort(); });
    flip.addEventListener('click', async () => {
      if (captured || opening) return;
      const previous = facing;
      const next = facing === 'user' ? 'environment' : 'user';
      if (!await startCamera(next, true) && !done) {
        status.textContent = 'That camera was not available. Putting the previous camera back…';
        await startCamera(previous, false);
      }
    });
    shutter.addEventListener('click', () => void takePhoto());
    retake.addEventListener('click', retakePhoto);
    use.addEventListener('click', async () => {
      if (!captured?.filtered || !captured?.source) return;
      if(postComposer&&!composeStep){composeStep=true;looks.hidden=true;postFields.hidden=false;use.textContent='Share';status.textContent='Add a caption or location, then share when you’re ready.';caption.focus({preventScroll:true});return;}
      const value={file: captured.filtered, sourceFile: captured.source, settings: captured.settings,caption:caption.value.trim(),location:location.value.trim()};
      if(postComposer&&typeof onShare==='function'){
        if(busy)return;busy=true;close.disabled=flip.disabled=retake.disabled=use.disabled=true;dialog.setAttribute('aria-busy','true');use.textContent='Sharing…';status.textContent='Sharing your photo…';
        try{const shared=await onShare(value);finish({...value,...shared});}catch(error){if(done)return;busy=false;close.disabled=false;retake.disabled=false;use.disabled=false;dialog.removeAttribute('aria-busy');use.textContent='Try Share Again';status.textContent=error?.message||'Your photo could not be shared. Your caption and location are still here.';}return;
      }
      finish(value);
    });

    paintLooks();
    document.body.style.overflow='hidden';
    dialog.classList.add('is-opening');
    dialog.showModal();
    requestAnimationFrame(() => {dialog.classList.remove('is-opening');close.focus({preventScroll: true})});
    scheduleThumbnails();
    previewFrame = requestAnimationFrame(paintLivePreview);
    void startCamera(facing, false);
  });
}
