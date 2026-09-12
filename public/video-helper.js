import {preparePhoneVideo,PHONE_SOURCE_LIMIT} from './phone-video.js';

const VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;
const RECORDING_MS = 29_000;
const abortError = () => new DOMException('Video preparation stopped', 'AbortError');
const baseType = type => String(type || '').split(';', 1)[0].trim().toLowerCase();

// Local validation only. The server must independently validate every upload.
// Compatible small files preserve their bytes. Larger phone files and MOV
// sources are converted locally to a bounded MP4/WebM copy with sound.
export async function preparePrivateVideo(file, {signal, recordedDuration, maxBytes = MAX_VIDEO_BYTES, onProgress} = {}) {
  if (signal?.aborted) throw abortError();
  const declaredType = baseType(file?.type);
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  const extensionType = ext === 'webm' ? 'video/webm' : ['mp4', 'm4v'].includes(ext) ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : '';
  const phoneLabel = ['video/quicktime','video/x-m4v','application/mp4','application/octet-stream','video/*',''].includes(declaredType);
  const type = VIDEO_TYPES.has(declaredType) ? declaredType : phoneLabel ? extensionType : '';
  if (!type) throw new Error('Choose an MP4, MOV, M4V or WebM video.');
  const limit = maxBytes === 12 * 1024 * 1024 ? maxBytes : MAX_VIDEO_BYTES;
  if (!file?.size || file.size > PHONE_SOURCE_LIMIT) throw new Error('Choose a phone video up to 100 MB.');
  if (!VIDEO_TYPES.has(type) || file.size > limit) {
    return preparePhoneVideo(file, {signal,onProgress,maxBytes:limit});
  }
  await new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let temporaryURL;
    let timer;
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      video.onloadedmetadata = video.onloadeddata = null;
      video.onerror = null;
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
      if (temporaryURL) URL.revokeObjectURL(temporaryURL);
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(abortError());
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const inspect = loadedData => {
      if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight)
        || video.videoWidth <= 0 || video.videoHeight <= 0) {
        if (loadedData) finish(new Error('Choose a video no larger than 1920 pixels wide or tall.'));
        return;
      }
      const duration = Number.isFinite(video.duration) ? video.duration : recordedDuration;
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) {
        finish(new Error('Choose a video up to 30 seconds long with a readable duration.'));
      } else if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight)
        || video.videoWidth <= 0 || video.videoHeight <= 0
        || video.videoWidth > 1920 || video.videoHeight > 1920) {
        finish(new Error('Choose a video no larger than 1920 pixels wide or tall.'));
      } else finish();
    };
    video.onloadedmetadata = () => inspect(false);
    video.onloadeddata = () => inspect(true);
    video.onerror = () => finish(new Error('This video could not open. Try another MP4 or WebM.'));
    signal?.addEventListener('abort', cancel, {once:true});
    if (signal?.aborted) { cancel(); return; }
    timer = setTimeout(() => finish(new Error('This video took too long to open. Save it to your phone from iCloud or Google Photos, then choose it again.')), 12_000);
    try {
      temporaryURL = URL.createObjectURL(file);
      video.src = temporaryURL;
    } catch { finish(new Error('This video could not open. Try another MP4 or WebM.')); }
  });
  if (signal?.aborted) throw abortError();
  return new File([file], type === 'video/quicktime' ? 'camera-video.mov' : type === 'video/mp4' ? 'private-video.mp4' : 'private-video.webm', {type});
}

function recordingError(error) {
  if (error?.name === 'AbortError') return abortError();
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return new Error('Allow camera and microphone access to record, or choose a video from your phone.');
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return new Error('No camera or microphone was found. Choose a video from your phone.');
  }
  return new Error('Recording could not start. Close other camera apps or choose a video from your phone.');
}

// Call only from a Record button. This module never requests a camera on import.
// stop() keeps the clip; cancel() discards it and also cancels a pending permission request.
export function recordPrivateVideo({signal, onStream, onTick, maxBytes = MAX_VIDEO_BYTES, facingMode = 'user'} = {}) {
  const recordingLimit = maxBytes === 12 * 1024 * 1024 ? maxBytes : MAX_VIDEO_BYTES;
  let resolveResult;
  let rejectResult;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const preparation = new AbortController();
  let stream;
  let recorder;
  let chunks = [];
  let bytes = 0;
  let settled = false;
  let finishing = false;
  let startedAt;
  let stoppedAt;
  let deadline;
  let ticker;
  let stopDeadline;
  let previewCleared = false;
  const stoppedTracks = new Set();
  const now = () => performance.now();
  const notify = (callback, value) => { try { callback?.(value); } catch {} };
  const clearTimers = () => {
    clearTimeout(deadline);
    clearInterval(ticker);
    clearTimeout(stopDeadline);
  };
  const releaseCapture = () => {
    for (const track of stream?.getTracks() || []) {
      if (!stoppedTracks.has(track)) {
        stoppedTracks.add(track);
        try { track.stop(); } catch {}
      }
    }
    if (!previewCleared) { previewCleared = true; notify(onStream, null); }
  };
  const detachRecorder = () => {
    if (recorder) recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
  };
  const fail = error => {
    if (settled) return;
    settled = true;
    clearTimers();
    preparation.abort();
    detachRecorder();
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch {} }
    releaseCapture();
    signal?.removeEventListener('abort', cancel);
    chunks = [];
    rejectResult(error);
  };
  const cancel = () => fail(abortError());
  const stop = () => {
    if (settled || finishing) return;
    if (!recorder || startedAt === undefined) { cancel(); return; }
    finishing = true;
    stoppedAt = now();
    clearTimers();
    stopDeadline = setTimeout(() => fail(new Error('The recording could not finish. Please try again.')), 5_000);
    try { if (recorder.state !== 'inactive') recorder.stop(); }
    catch { fail(new Error('The recording could not finish. Please try again.')); }
    // Release hardware immediately, including when a browser delays its stop event.
    releaseCapture();
  };
  const finishRecording = async () => {
    if (settled) return;
    finishing = true;
    stoppedAt ??= now();
    clearTimers();
    detachRecorder();
    releaseCapture();
    const type = baseType(recorder.mimeType || chunks.find(chunk => chunk.type)?.type);
    try {
      const file = new File(chunks, type === 'video/mp4' ? 'private-video.mp4' : 'private-video.webm', {type});
      chunks = [];
      const prepared = await preparePrivateVideo(file, {
        signal:preparation.signal,
        maxBytes:recordingLimit, recordedDuration:(stoppedAt - startedAt) / 1000
      });
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      resolveResult(prepared);
    } catch (error) { fail(error); }
  };
  signal?.addEventListener('abort', cancel, {once:true});
  if (signal?.aborted) cancel();

  const start = async () => {
    if (settled) return;
    if (typeof MediaRecorder === 'undefined' || !globalThis.navigator?.mediaDevices?.getUserMedia) {
      fail(new Error('This browser cannot record here. Choose a video from your phone instead.'));
      return;
    }
    const preferredTypes = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    let mimeType;
    try { mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type)); }
    catch {}
    if (!mimeType) {
      fail(new Error('This browser cannot make a compatible recording. Choose an MP4 or WebM video instead.'));
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio:true,
        video:{facingMode:{ideal:facingMode === 'environment' ? 'environment' : 'user'}, width:{ideal:640,max:1280}, height:{ideal:480,max:1280}, frameRate:{ideal:24,max:30}}
      });
      // Browsers do not offer an AbortSignal for getUserMedia. A late permission
      // response must release its newly granted tracks without starting capture.
      if (settled) { releaseCapture(); return; }
      // Some mobile recorders support the format but reject bitrate hints.
      // Keep a compatible constructor fallback instead of treating it as a
      // camera permission error.
      try { recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond:650_000, audioBitsPerSecond:64_000}); }
      catch { recorder = new MediaRecorder(stream, {mimeType}); }
      recorder.ondataavailable = event => {
        if (settled || !event.data?.size) return;
        bytes += event.data.size;
        if (bytes > recordingLimit) {
          fail(new Error('That recording is too large. Try a shorter video.'));
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => fail(new Error('Recording stopped unexpectedly. Please try again or choose a video.'));
      recorder.onstop = () => { void finishRecording(); };
      recorder.start(500);
      startedAt = now();
      notify(onStream, stream);
      if (settled || finishing) return;
      notify(onTick, RECORDING_MS / 1000);
      if (settled || finishing) return;
      deadline = setTimeout(() => { notify(onTick, 0); stop(); }, RECORDING_MS);
      ticker = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((RECORDING_MS - (now() - startedAt)) / 1000));
        notify(onTick, remaining);
        if (!remaining) stop();
      }, 1_000);
    } catch (error) { if (!settled) fail(recordingError(error)); else releaseCapture(); }
  };
  void start();
  return {stop, cancel, result};
}
