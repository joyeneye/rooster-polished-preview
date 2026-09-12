import {waitForMediaJob,selectPhoneVideo} from './media-job-client.js';
import {preparePhoneVideo,PHONE_SOURCE_LIMIT} from './phone-video.js';
import {transferClip} from './clip-upload-client.js';
import {preparePrivateVideo, recordPrivateVideo} from './video-helper.js';
import {clipList, clipCard, releaseVideo} from './clip-client-utils.js';
import {openRosterVideoEditor} from './roster-video-editor.js';

export function createMemberClips({onSessionExpired}) {
  const root = document.getElementById('member-clips-root');
  if (!root) return {setUser() {}};
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, id) => {
    const node = element('button', text, 'member-button');
    node.type = 'button';
    if (id) node.id = id;
    return node;
  };
  const heading = element('h3', 'Your 30 Second Moment');
  const intro = element('p', 'Post once. Your approved video appears on your profile and is shared to WYD automatically.', 'member-small');
  const form = element('form', '', 'member-clips-form');
  form.id = 'member-clips-form';
  const selectLabel = element('label', 'Choose from Library', 'member-clips-file-label');
  const input = element('input');
  input.type = 'file';
  input.id = 'member-clips-file';
  input.accept = 'video/*,.mp4,.mov,.m4v,.webm';
  input.removeAttribute('capture');
  selectLabel.append(input);
  const actions = element('div', '', 'member-clips-actions');
  const recordButton = button('Record a video', 'member-clips-record');
  const stopButton = button('Finish recording', 'member-clips-stop');
  stopButton.hidden = true;
  const phoneCameraButton = button('Use phone camera', 'member-clips-phone-camera');
  const timerLabel = element('label', 'Camera timer', 'member-clips-capture-option');
  const timerSelect = element('select');
  [['0','Off'],['3','3 seconds'],['10','10 seconds']].forEach(([value,label])=>{const option=element('option',label);option.value=value;timerSelect.append(option);});
  timerLabel.append(timerSelect);
  const flipCameraButton = button('Use rear camera', 'member-clips-flip-camera');
  const phoneCamera = element('input');
  phoneCamera.type = 'file';
  phoneCamera.accept = 'video/*';
  phoneCamera.setAttribute('capture', 'user');
  phoneCamera.hidden = true;
  phoneCamera.id = 'member-clips-phone-camera-file';
  const prepareButton = button('Make upload smaller', 'member-clips-prepare');
  prepareButton.hidden = true;
  actions.append(recordButton, stopButton, phoneCameraButton, phoneCamera, timerLabel, flipCameraButton, prepareButton);
  const preview = element('video', '', 'short-clip-video member-clip-preview');
  preview.id = 'member-clips-preview';
  preview.controls = true;
  preview.playsInline = true;
  preview.preload = 'metadata';
  preview.hidden = true;
  preview.setAttribute('aria-label', 'Preview your video');
  const remove = button('Remove video', 'member-clips-remove');
  remove.hidden = true;
  const captionLabel = element('label', 'Add a caption (optional)');
  const caption = element('textarea');
  caption.id = 'member-clips-caption';
  caption.maxLength = 300;
  caption.rows = 2;
  caption.placeholder = 'What is your moment about?';
  captionLabel.append(caption);
  const help = element('p', 'Upload MP4, MOV, M4V or WebM videos up to 100 MB and 30 seconds. Large phone videos can be made smaller on your device, and the server can still repair the original if that is not available. Your original stays unchanged. Videos that pass a safety check appear automatically. Anything that needs a closer look stays private.', 'member-small');
  help.id = 'member-clips-help';
  input.setAttribute('aria-describedby', help.id);
  const submit = button('Share video', 'member-clips-submit');
  submit.type = 'submit';
  const checkStatus = button('Check video status', 'member-clips-check-status');
  checkStatus.hidden = true;
  const watchLink = element('a', 'View My Video', 'member-button');
  watchLink.id = 'member-clips-watch';
  watchLink.href = '/members.html#member-clips-root';
  watchLink.hidden = true;
  const status = element('p', '', 'member-small');
  status.id = 'member-clips-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  form.append(selectLabel, actions, preview, remove, captionLabel, help, submit, status, checkStatus, watchLink);
  const review = element('details', '', 'member-clips-review');
  review.id = 'member-clips-review';
  review.hidden = true;
  const reviewSummary = element('summary', 'Review roster videos');
  const reviewIntro = element('p', 'Watch each video before you approve it. Declined videos stay off the page.', 'member-small');
  const reviewRefresh = button('Refresh review queue', 'member-clips-review-refresh');
  const reviewStatus = element('p', '', 'member-small');
  reviewStatus.id = 'member-clips-review-status';
  reviewStatus.setAttribute('role', 'status');
  const reviewList = element('div', '', 'member-clips-review-list');
  reviewList.id = 'member-clips-review-list';
  review.append(reviewSummary, reviewIntro, reviewRefresh, reviewStatus, reviewList);
  root.replaceChildren(heading, intro, form, review);
  root.hidden = true;

  let pickerFile = null;
  let pickerOpen = false;
  let sourceForConversion = null;
  let user = null;
  let generation = 0;
  let selectionSequence = 0;
  let selectionController = null;
  let selected = null;
  let previewUrl = null;
  let recorder = null;
  let recordingController = null;
  let selecting = false;
  let recording = false;
  let sending = false;
  let checking = false;
  let submission = null;
  let reviewing = false;
  let reviewAgain = false;
  let reviewReady = false;
  let retry = null;
  let cameraFacing = 'user';
  const controllers = new Set();
  const pendingUrls = new Set();
  const pendingVideos = new Set();
  const visible = () => document.visibilityState !== 'hidden';
  const current = epoch => Boolean(user && generation === epoch);

  function report(text, error = false) {
    status.textContent = text;
    status.dataset.tone = error ? 'error' : '';
  }

  function controls() {
    const disabled = !user || !visible() || sending || checking || selecting || recording;
    // A native file picker can background Safari. Do not disable the live picker.
    input.disabled = !user || sending || checking || selecting || recording;
    prepareButton.disabled = !user || sending || checking || selecting || recording;
    prepareButton.hidden = !sourceForConversion;
    recordButton.disabled = disabled;
    phoneCameraButton.disabled = disabled;
    timerSelect.disabled = disabled;
    flipCameraButton.disabled = disabled || !globalThis.navigator?.mediaDevices?.getUserMedia;
    caption.disabled = !user || !visible() || sending || checking || recording;
    submit.disabled = disabled || !selected || caption.value.length > 300;
    submit.textContent = sending ? 'Uploading…' : checking ? 'Checking…' : 'Share video';
    remove.disabled = !user || sending || checking || recording;
    remove.hidden = !selected && !selecting;
    stopButton.hidden = !recording;
    recordButton.hidden = recording;
    stopButton.disabled = !recording;
    form.setAttribute('aria-busy', String(sending || checking || selecting));
    checkStatus.hidden = !submission || submission.status !== 'pending';
    checkStatus.disabled = !user || !visible() || sending || checking;
    watchLink.hidden = !user || submission?.status !== 'approved';
    reviewRefresh.disabled = !user || reviewing || !visible();
  }

  function releasePreview() {
    releaseVideo(preview);
    preview.hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function showSelected() {
    releasePreview();
    if (!selected || !visible()) return;
    previewUrl = URL.createObjectURL(selected);
    preview.src = previewUrl;
    preview.muted = false;
    preview.hidden = false;
  }

  function clearSelection() {
    selectionSequence += 1;
    selectionController?.abort();
    selectionController = null;
    recordingController?.abort();
    recorder?.cancel();
    recorder = null;
    recordingController = null;
    selecting = recording = false;
    selected = null;
    sourceForConversion = null;
    retry = null;
    input.value = '';
    releasePreview();
  }

  function clearQueue() {
    pendingVideos.forEach(releaseVideo);
    pendingVideos.clear();
    pendingUrls.forEach(url => URL.revokeObjectURL(url));
    pendingUrls.clear();
    reviewList.replaceChildren();
    reviewStatus.textContent = '';
    reviewReady = false;
  }

  async function request(path, options = {}, controller = new AbortController(), timeoutMs = 45000) {
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        ...options, credentials:'same-origin', cache:'no-store', redirect:'error',
        signal:controller.signal, headers:{Accept:'application/json', ...options.headers},
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(typeof data?.error === 'string' ? data.error.slice(0, 600) : 'The video request could not be completed.');
        error.status = response.status;
        throw error;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid video response');
      return data;
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  function expired(error, epoch) {
    if (!current(epoch) || (error.status !== 401 && error.status !== 403)) return false;
    setUser(null);
    onSessionExpired(error.status === 403 ? 'confirmation' : 'session');
    return true;
  }

  async function choose(file) {
    if (!user || sending || checking || recording || !visible()) return;
    clearSelection();
    if (!file) { report(''); controls(); return; }
    const epoch = generation;
    const sequence = selectionSequence;
    const controller = new AbortController();
    selectionController = controller;
    selecting = true;
    report('Checking your video…');
    controls();
    try {
      report('Opening the ROOSTER video editor…');
      const edited = await openRosterVideoEditor(file, {signal:controller.signal,title:'Edit Your ROOSTER Clip',applyLabel:'Apply Video'});
      if (!current(epoch) || sequence !== selectionSequence || !visible()) return;
      const ready = selectPhoneVideo(edited?.file || file);
      if (edited?.caption) caption.value = edited.caption.slice(0, 300);
      if (!current(epoch) || sequence !== selectionSequence || !visible()) return;
      selected = ready;
      const extension = String(ready.name || '').split('.').pop().toLowerCase();
      sourceForConversion = ready.size <= PHONE_SOURCE_LIMIT
        && (ready.size > 4 * 1024 * 1024 || ['mov','m4v'].includes(extension)) ? ready : null;
      showSelected();
      report(sourceForConversion
        ? 'Video selected. Tap Make upload smaller to use less data, or tap Share video and the server will prepare the original.'
        : edited ? 'Edited video ready. Review it, then tap Share video.' : 'Original video kept. Review it, then tap Share video.');
    } catch (error) {
      if (current(epoch) && sequence === selectionSequence) {
        sourceForConversion = null;
        report((error.message || 'The phone could not prepare this video.') + (sourceForConversion ? ' Tap Prepare for Upload to make a compatible copy without changing your original.' : ''), true);
      }
    } finally {
      if (current(epoch) && sequence === selectionSequence) {
        selecting = false;
        selectionController = null;
        controls();
      }
    }
  }

  async function startRecording() {
    if (!user || sending || checking || selecting || recording || !visible()) return;
    clearSelection();
    const epoch = generation;
    const sequence = selectionSequence;
    const controller = new AbortController();
    recordingController = controller;
    recording = true;
    report('Opening your camera…');
    controls();
    try {
      const delay = Number(timerSelect.value || 0);
      for (let remaining=delay;remaining>0;remaining--) {
        report(`Camera starts in ${remaining}…`);
        await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,1000);controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Recording canceled.','AbortError'));},{once:true});});
      }
      recorder = recordPrivateVideo({
        signal:controller.signal, maxBytes:12 * 1024 * 1024,
        facingMode:cameraFacing,
        onStream(stream) {
          if (!current(epoch) || sequence !== selectionSequence) return;
          if (stream) {
            preview.srcObject = stream;
            preview.muted = true;
            preview.hidden = false;
            void preview.play().catch(() => {});
          } else preview.srcObject = null;
        },
        onTick(seconds) {
          if (current(epoch) && sequence === selectionSequence) report(`Recording. ${seconds} seconds left.`);
        },
      });
      const captured = await recorder.result;
      if (!current(epoch) || sequence !== selectionSequence || !visible()) return;
      report('Opening the ROOSTER video editor…');
      const edited = await openRosterVideoEditor(captured, {signal:controller.signal,title:'Edit Your Recording',applyLabel:'Apply Video'});
      if (!current(epoch) || sequence !== selectionSequence || !visible()) return;
      selected = edited?.file || captured;
      if (edited?.caption) caption.value = edited.caption.slice(0, 300);
      showSelected();
      report(edited ? 'Your edited video is ready. Watch it back, then tap Share video.' : 'Your original recording is ready. Watch it back, then tap Share video.');
    } catch (error) {
      if (current(epoch) && sequence === selectionSequence) {
        releasePreview();
        report(error.name === 'AbortError' ? 'Recording canceled.' : (error.message || 'Your camera could not start. You can choose a video instead.'), error.name !== 'AbortError');
      }
    } finally {
      if (current(epoch) && sequence === selectionSequence) {
        recorder = null;
        recordingController = null;
        recording = false;
        controls();
      }
    }
  }

  async function send(event) {
    event.preventDefault();
    if (!user || !selected || sending || checking || selecting || recording || !visible()) return;
    const text = caption.value.replace(/\r\n?/g, '\n').trim();
    if (text.length > 300) { report('Keep your caption to 300 characters or fewer.', true); return; }
    const epoch = generation;
    if (!retry || retry.file !== selected || retry.caption !== text) retry = {file:selected, caption:text, id:crypto.randomUUID()};
    const attempt = retry;
    sending = true;
    report('Uploading your video…');
    controls();
    try {
      const uploadId = await transferClip(attempt.file, {
        request, requestId:attempt.id,
        isCurrent:() => current(epoch) && visible(),
        onProgress:percent => report(percent === 100 ? 'Video transferred. Saving your clip…' : `Uploading your video… ${percent}%`)
      });
      const received = await request('/api/clips', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({upload_id:uploadId, request_id:attempt.id, caption:attempt.caption})});
      const result = await waitForMediaJob(received,{request,isCurrent:()=>current(epoch),onProgress:text=>report(text)});
      if (!current(epoch)) return;
      const validStatus = {pending:false, approved:true, rejected:false};
      if (!Object.hasOwn(validStatus,result.status) || result.published !== validStatus[result.status] || !/^[a-f0-9]{64}$/.test(result.id)) throw new Error('Unconfirmed submission');
      submission = {id:result.id, status:result.status};
      clearSelection();
      caption.value = '';
      sending = false;
      report('Uploaded. Checking your video…');
      controls();
      if (result.status === 'pending') await checkSubmission({automatic:true});
      else if (result.status === 'approved') report('Your clip is live on your profile and will appear in WYD automatically. Tap View My Video to watch it.');
      else report('Your video was not published because it did not meet the community rules.', true);
    } catch (error) {
      if (!current(epoch) || expired(error, epoch)) return;
      if (error.status === 400 || error.status === 413 || error.status === 415 || error.status === 422 || error.status === 410) {
        retry = null;
        report(error.message, true);
      } else if (error.status === 429 || error.status === 409) report(error.message, true);
      else report('We could not confirm your upload. Tap Share video again to check without posting it twice.', true);
    } finally {
      if (current(epoch)) { sending = false; controls(); }
    }
  }

  async function checkSubmission({automatic = false} = {}) {
    if (!user || !submission || checking || !visible()) return;
    const epoch = generation;
    const id = submission.id;
    checking = true;
    report(automatic ? 'Uploaded. Checking your video…' : 'Checking your video status…');
    controls();
    try {
      const result = automatic
        ? await request('/api/clips/check', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id})}, new AbortController(), 60000)
        : await request(`/api/clips/status/${id}`);
      if (!current(epoch) || !visible() || submission?.id !== id) return;
      const expected = {approved:true, pending:false, rejected:false};
      if (result.id !== id || !Object.hasOwn(expected, result.status) || result.published !== expected[result.status]) throw new Error('Unconfirmed video status');
      submission = {id, status:result.status};
      if (result.status === 'approved') report('Your clip is live on your profile and will appear in WYD automatically. Tap View My Video to watch it.');
      else if (result.status === 'rejected') report('Your video was not published because it did not meet the community rules. Try another moment and keep it kind.', true);
      else if (result.review_unavailable === true) report('Your video uploaded and is saved privately. The safety checker is unavailable, so the site owner needs to review it before it appears.');
      else if (result.checking === true) report('Your video is saved privately while its safety check finishes. Tap Check video status to see the latest.');
      else report('Your video is saved privately and needs a closer look from the team before it can appear on the page.');
      if (!review.hidden) void refreshReview();
    } catch (error) {
      if (!current(epoch) || submission?.id !== id || expired(error, epoch)) return;
      report('Your upload is saved privately. We could not confirm the safety check yet. Tap Check video status to see the latest.');
    } finally {
      if (current(epoch) && submission?.id === id) { checking = false; controls(); }
    }
  }

  async function previewPending(clip, video, playButton, message, epoch) {
    if (!current(epoch) || !visible() || !review.open) return;
    playButton.disabled = true;
    message.textContent = 'Loading the video…';
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(clip.video_url, {credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal});
      if (!response.ok) {
        const error = new Error('Preview unavailable');
        error.status = response.status;
        throw error;
      }
      const blob = await response.blob();
      if (!current(epoch) || !visible() || !review.open || !pendingVideos.has(video)) return;
      if (!['video/mp4', 'video/webm'].includes(blob.type) || blob.size > 12 * 1024 * 1024 || blob.size === 0) throw new Error('Invalid video');
      const url = URL.createObjectURL(blob);
      pendingUrls.add(url);
      video.src = url;
      video.hidden = false;
      playButton.hidden = true;
      message.textContent = 'Tap Play to watch the whole video before you decide.';
    } catch (error) {
      if (!current(epoch) || !pendingVideos.has(video)) return;
      if (error.status === 401 && expired(error, epoch)) return;
      message.textContent = 'This preview could not load. Refresh the queue and try again.';
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
      if (current(epoch) && pendingVideos.has(video)) playButton.disabled = false;
    }
  }

  async function decide(clip, action, buttons, message, epoch) {
    if (!current(epoch) || !visible() || buttons.some(item => item.disabled)) return;
    buttons.forEach(item => { item.disabled = true; });
    message.textContent = action === 'approve' ? 'Approving video…' : 'Declining video…';
    try {
      const result = await request('/api/clips/review', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:clip.id, action})});
      if (!current(epoch)) return;
      if (result.id !== clip.id || result.status !== (action === 'approve' ? 'approved' : 'rejected')) throw new Error('Unconfirmed review');
      await refreshReview();
    } catch (error) {
      if (!current(epoch)) return;
      if (error.status === 401 && expired(error, epoch)) return;
      if (error.status === 403) { clearQueue(); review.hidden = true; return; }
      message.textContent = 'That decision could not be confirmed. Refresh the queue before trying again.';
      buttons.forEach(item => { item.disabled = false; });
    }
  }

  async function refreshReview() {
    if (!user || !visible()) return;
    if (reviewing) { reviewAgain = true; return; }
    const epoch = generation;
    reviewing = true;
    controls();
    try {
      const result = await request('/api/clips/review');
      if (!current(epoch) || !visible()) return;
      const clips = clipList(result);
      clearQueue();
      review.hidden = false;
      reviewReady = true;
      reviewStatus.textContent = clips.length ? `${clips.length} video${clips.length === 1 ? '' : 's'} waiting for review.` : 'You are all caught up. No videos are waiting for review.';
      const cards = clips.map(clip => {
        const {card, video} = clipCard(clip);
        video.hidden = true;
        pendingVideos.add(video);
        video.addEventListener('play', () => pendingVideos.forEach(other => { if (other !== video) other.pause(); }));
        const previewButton = button('Preview video');
        const approve = button('Approve');
        const decline = button('Decline');
        const message = element('p', '', 'member-small');
        message.setAttribute('role', 'status');
        const row = element('div', '', 'member-clips-actions');
        row.append(previewButton, approve, decline);
        previewButton.addEventListener('click', () => void previewPending(clip, video, previewButton, message, epoch));
        approve.addEventListener('click', () => void decide(clip, 'approve', [approve, decline], message, epoch));
        decline.addEventListener('click', () => void decide(clip, 'reject', [approve, decline], message, epoch));
        card.append(row, message);
        return card;
      });
      reviewList.replaceChildren(...cards);
    } catch (error) {
      if (!current(epoch)) return;
      if (error.status === 403) { clearQueue(); review.hidden = true; return; }
      if (error.status === 401 && expired(error, epoch)) return;
      if (!review.hidden) reviewStatus.textContent = 'The review queue could not load. Tap Refresh review queue to try again.';
    } finally {
      if (current(epoch)) {
        reviewing = false;
        controls();
        if (reviewAgain) { reviewAgain = false; void refreshReview(); }
      }
    }
  }

  function setUser(member) {
    pickerFile = null;
    if (member?.id && user?.id === member.id) return;
    generation += 1;
    controllers.forEach(controller => controller.abort());
    controllers.clear();
    clearSelection();
    clearQueue();
    user = member?.id ? {id:member.id} : null;
    watchLink.href = user ? `/profile.html?id=${encodeURIComponent(user.id)}#clips` : '/members.html#member-clips-root';
    caption.value = '';
    sending = checking = reviewing = reviewAgain = false;
    submission = null;
    review.hidden = true;
    root.hidden = !user;
    report('');
    controls();
    if (user) void refreshReview();
  }

  const pick = file => {
    if (!file) return;
    // Some phone pickers emit change before the browser becomes visible again.
    if (!visible()) { pickerFile = file; return; }
    void choose(file);
  };
  input.addEventListener('click', () => { pickerOpen = true; });
  input.addEventListener('cancel', () => { pickerOpen = false; controls(); });
  input.addEventListener('change', () => { const file = input.files?.[0]; pickerOpen = false; pick(file); });
  phoneCameraButton.addEventListener('click', () => { pickerOpen = true; phoneCamera.value = ''; phoneCamera.click(); });
  flipCameraButton.addEventListener('click',()=>{cameraFacing=cameraFacing==='user'?'environment':'user';flipCameraButton.textContent=cameraFacing==='user'?'Use rear camera':'Use front camera';phoneCamera.setAttribute('capture',cameraFacing);report(`${cameraFacing==='user'?'Front':'Rear'} camera selected for the next capture.`);});
  phoneCamera.addEventListener('change', () => { const file=phoneCamera.files?.[0]; pickerOpen=false; pick(file); });
  phoneCamera.addEventListener('cancel', () => { pickerOpen=false; controls(); });
  window.addEventListener('focus', () => { if (pickerFile && visible() && user) { const file=pickerFile;pickerFile=null;void choose(file); } controls(); });
  prepareButton.addEventListener('click', async () => {
    if (!sourceForConversion || selecting || sending || !user) return;
    const file=sourceForConversion, epoch=generation, sequence=selectionSequence;
    const controller=new AbortController();selectionController=controller;selecting=true;controls();
    report('Making a smaller copy on this phone. Keep this page open…');
    try {
      const ready=await preparePhoneVideo(file,{signal:controller.signal,maxBytes:4*1024*1024,onProgress:percent=>report(`Making your upload smaller… ${percent}%. Keep this page open.`)});
      if (!current(epoch)||sequence!==selectionSequence) return;
      selected=ready;sourceForConversion=null;showSelected();report('Ready. Watch the picture and listen to the audio, then tap Share video.');
    } catch(error) { if(current(epoch)&&sequence===selectionSequence)report((error.message||'This phone could not make a smaller copy.')+' Your original is still selected, so you can tap Share video and let the server prepare it.',true); }
    finally {if(current(epoch)&&sequence===selectionSequence){selecting=false;selectionController=null;controls();}}
  });
  caption.addEventListener('input', controls);
  recordButton.addEventListener('click', () => void startRecording());
  stopButton.addEventListener('click', () => {
    if (!recording || !recorder) return;
    stopButton.disabled = true;
    report('Finishing your video…');
    recorder.stop();
  });
  remove.addEventListener('click', () => { if (!sending && !checking) { clearSelection(); report(''); controls(); } });
  form.addEventListener('submit', event => void send(event));
  checkStatus.addEventListener('click', () => void checkSubmission());
  reviewRefresh.addEventListener('click', () => void refreshReview());
  review.addEventListener('toggle', () => {
    if (!review.open) clearQueue();
    else if (user && !reviewReady) void refreshReview();
  });
  document.addEventListener('visibilitychange', () => {
    if (!visible()) {
      if (pickerOpen) return;
      const wasSending = sending;
      const wasChecking = checking;
      const wasRecording = recording;
      generation += 1;
      controllers.forEach(controller => controller.abort());
      controllers.clear();
      if (recording || selecting) clearSelection();
      releasePreview();
      clearQueue();
      sending = checking = reviewing = reviewAgain = false;
      if (wasChecking) report('Your upload is saved. Its status will refresh when you return.');
      else if (wasSending) report('Your video is still here. Tap Share video to check its upload when you return.');
      else if (wasRecording) report('Recording stopped. Tap Record a video to start again.');
    } else if (user) {
      if (pickerFile) { const file = pickerFile; pickerFile = null; void choose(file); }
      showSelected();
      void refreshReview();
      if (submission?.status === 'pending') void checkSubmission();
    }
    controls();
  });
  window.addEventListener('pagehide', () => setUser(null));
  controls();
  return {setUser};
}
