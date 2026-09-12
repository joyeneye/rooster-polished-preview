import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {File} from 'node:buffer';

const source = fs.readFileSync(new URL('../video-helper.js', import.meta.url), 'utf8')
  .replace("import {preparePhoneVideo,PHONE_SOURCE_LIMIT} from './phone-video.js';", '')
  .replace(/export (async )?function/g, '$1function');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const clip = (type = 'video/mp4', contents = 'unchanged video container and camera metadata') => new File([contents], 'camera.mp4', {type});

function environment(options = {}) {
  let time = 0;
  let timerID = 0;
  const timers = new Map();
  const revoked = [];
  const videos = [];
  const recorders = [];
  const stream = {getTracks:() => tracks};
  const tracks = ['video', 'audio'].map(kind => ({kind, stops:0, stop() { this.stops++; }}));
  const calls = [];
  const phonePreparations = [];
  let createdURLs = 0;
  const schedule = (callback, delay, interval = false) => {
    const id = ++timerID;
    timers.set(id, {callback, due:time + delay, interval:interval ? delay : 0});
    return id;
  };
  class Recorder {
    static isTypeSupported(type) {
      return options.supported ? options.supported.includes(type) : type.startsWith('video/mp4');
    }
    constructor(input, settings) {
      if (options.constructorError) throw new Error('Constructor failed');
      assert.equal(input, stream);
      this.settings = settings;
      this.mimeType = settings.mimeType;
      this.state = 'inactive';
      this.stopCalls = 0;
      recorders.push(this);
    }
    start(timeslice) {
      if (options.startError) throw new Error('Start failed');
      this.timeslice = timeslice;
      this.state = 'recording';
    }
    stop() {
      this.stopCalls++;
      this.state = 'inactive';
      if (!options.stopNever) queueMicrotask(() => {
        this.ondataavailable?.({data:new Blob([new Uint8Array(options.finalBytes ?? 100)], {type:this.mimeType})});
        this.onstop?.();
      });
    }
    emitBytes(size) { this.ondataavailable?.({data:new Blob([new Uint8Array(size)], {type:this.mimeType})}); }
  }
  const context = vm.createContext({
    File, Blob, DOMException, AbortController,
    performance:{now:() => time},
    setTimeout:(callback, delay) => schedule(callback, delay),
    clearTimeout:id => timers.delete(id),
    setInterval:(callback, delay) => schedule(callback, delay, true),
    clearInterval:id => timers.delete(id),
    MediaRecorder:options.unsupported ? undefined : Recorder,
    navigator:{mediaDevices:{getUserMedia:async constraints => {
      calls.push(constraints);
      if (options.permissionError) throw options.permissionError;
      return options.permission ? await options.permission : stream;
    }}},
    URL:{createObjectURL() { return `blob:video-${++createdURLs}`; }, revokeObjectURL:url => revoked.push(url)},
    document:{createElement(tag) {
      assert.equal(tag, 'video');
      const video = {
        duration:options.duration ?? 10,
        videoWidth:options.width ?? 640,
        videoHeight:options.height ?? 480,
        paused:0, unloaded:0,
        pause() { this.paused++; },
        removeAttribute(name) { assert.equal(name, 'src'); this.unloaded++; },
        load() {},
        set src(value) {
          this.url = value;
          if (!options.pendingMetadata) queueMicrotask(() => {
            if (options.metadataError) this.onerror?.();
            else { this.onloadedmetadata?.(); this.onloadeddata?.(); }
          });
        }
      };
      videos.push(video);
      return video;
    }}
  });
  context.PHONE_SOURCE_LIMIT = 100 * 1024 * 1024;
  context.preparePhoneVideo = async (file, settings) => {
    phonePreparations.push({file,settings});
    if (options.phoneError) throw options.phoneError;
    return options.phoneResult || new File(['prepared phone video'], 'phone-video.mp4', {type:'video/mp4'});
  };
  vm.runInContext(source + '\nthis.prepare = preparePrivateVideo; this.record = recordPrivateVideo;', context);
  return {
    prepare:context.prepare, record:context.record, stream, tracks, calls, recorders, videos, revoked, timers, phonePreparations,
    async advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const next = [...timers.entries()].filter(([, task]) => task.due <= target)
          .sort((a,b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, task] = next;
        time = task.due;
        if (task.interval) task.due += task.interval; else timers.delete(id);
        task.callback();
        await flush();
      }
      time = target;
      await flush();
    }
  };
}

test('MP4 and WebM validation preserve bytes while normalizing MIME and releasing video resources', async () => {
  for (const type of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp8,opus']) {
    const e = environment();
    const input = clip(type);
    const output = await e.prepare(input);
    assert.equal(output.type, type.split(';')[0]);
    assert.equal(await output.text(), await input.text());
    assert.equal(e.videos[0].paused, 1);
    assert.equal(e.videos[0].unloaded, 1);
    assert.deepEqual(e.revoked, ['blob:video-1']);
    assert.equal(e.timers.size, 0);
  }
});

test('unsupported, empty, or source-oversized videos never create a decoder', async () => {
  for (const input of [{name:'script.html',type:'text/html',size:100}, {name:'empty.mp4',type:'video/mp4',size:0}, {name:'huge.webm',type:'video/webm',size:100*1024*1024+1}]) {
    const e = environment();
    await assert.rejects(e.prepare(input));
    assert.equal(e.videos.length, 0);
    assert.equal(e.phonePreparations.length, 0);
  }
});

test('MOV and large MP4/WebM phone sources use the bounded local converter', async () => {
  for (const input of [
    {name:'IMG_0001.MOV',type:'video/quicktime',size:2*1024*1024},
    {name:'camera.mp4',type:'video/mp4',size:4*1024*1024+1},
    {name:'camera.webm',type:'video/webm',size:4*1024*1024+1},
  ]) {
    const e = environment();
    const progress = () => {};
    const output = await e.prepare(input, {onProgress:progress});
    assert.equal(output.type, 'video/mp4');
    assert.equal(e.videos.length, 0);
    assert.equal(e.phonePreparations.length, 1);
    assert.equal(e.phonePreparations[0].file, input);
    assert.equal(e.phonePreparations[0].settings.maxBytes, 4*1024*1024);
    assert.equal(e.phonePreparations[0].settings.onProgress, progress);
  }
  const screening = environment();
  await screening.prepare({name:'camera.mov',type:'',size:100}, {maxBytes:12*1024*1024});
  assert.equal(screening.phonePreparations[0].settings.maxBytes, 12*1024*1024);
});

test('duration and dimensions are enforced even if a caller supplies a shorter recording clock', async () => {
  for (const invalid of [{duration:30.01}, {duration:0}, {duration:-1}, {width:1921}, {height:1921}, {width:0}, {height:NaN}]) {
    const e = environment(invalid);
    await assert.rejects(e.prepare(clip(), {recordedDuration:5}), /30 seconds|1920 pixels/);
    assert.equal(e.revoked.length, 1);
    assert.equal(e.timers.size, 0);
  }
  const boundary = environment({duration:30, width:1920, height:1920});
  assert.equal((await boundary.prepare(clip())).type, 'video/mp4');
});

test('only unreadable recorded durations can use the supplied capture clock', async () => {
  for (const duration of [Infinity, NaN]) {
    await assert.rejects(environment({duration}).prepare(clip()), /readable duration/);
    const output = await environment({duration}).prepare(clip('video/webm'), {recordedDuration:29});
    assert.equal(output.type, 'video/webm');
    await assert.rejects(environment({duration}).prepare(clip(), {recordedDuration:31}), /30 seconds/);
  }
});

test('metadata abort, decoder error and timeout all release the object URL and event handlers', async () => {
  const controller = new AbortController();
  const aborted = environment({pendingMetadata:true});
  const result = aborted.prepare(clip(), {signal:controller.signal});
  const rejection = assert.rejects(result, error => error.name === 'AbortError');
  controller.abort();
  await rejection;
  assert.equal(aborted.videos[0].onloadedmetadata, null);
  assert.equal(aborted.revoked.length, 1);
  assert.equal(aborted.timers.size, 0);
  const broken = environment({metadataError:true});
  await assert.rejects(broken.prepare(clip()), /could not open/);
  assert.equal(broken.revoked.length, 1);
  const slow = environment({pendingMetadata:true});
  const timedOut = assert.rejects(slow.prepare(clip()), /too long/);
  await slow.advance(12_000);
  await timedOut;
  assert.equal(slow.revoked.length, 1);
});

test('import is passive and a pre-aborted recording never requests camera permission', async () => {
  const e = environment();
  assert.equal(e.calls.length, 0);
  const controller = new AbortController();
  controller.abort();
  const capture = e.record({signal:controller.signal});
  assert.equal(typeof capture.stop, 'function');
  assert.equal(typeof capture.cancel, 'function');
  await assert.rejects(capture.result, error => error.name === 'AbortError');
  assert.equal(e.calls.length, 0);
});

test('camera capture prefers H264 MP4, uses modest bitrate and ends with all tracks stopped', async () => {
  const e = environment();
  const previews = [];
  const ticks = [];
  const capture = e.record({onStream:stream => previews.push(stream), onTick:value => ticks.push(value)});
  await flush();
  const recorder = e.recorders[0];
  assert.match(recorder.mimeType, /^video\/mp4;codecs=avc1/);
  assert.equal(recorder.settings.videoBitsPerSecond, 650_000);
  assert.equal(recorder.settings.audioBitsPerSecond, 64_000);
  assert.equal(recorder.timeslice, 500);
  assert.equal(e.calls[0].video.width.ideal, 640);
  assert.equal(e.calls[0].video.height.ideal, 480);
  await e.advance(2_000);
  capture.stop();
  assert.ok(e.tracks.every(track => track.stops === 1));
  const file = await capture.result;
  assert.equal(file.type, 'video/mp4');
  assert.deepEqual(previews, [e.stream, null]);
  assert.deepEqual(ticks, [29, 28, 27]);
  assert.equal(e.timers.size, 0);
  assert.equal(recorder.ondataavailable, null);
});

test('WebM fallback auto stops after 29 seconds and validates an infinite container duration against the capture clock', async () => {
  const e = environment({supported:['video/webm;codecs=vp8,opus'], duration:Infinity});
  const ticks = [];
  const capture = e.record({onTick:value => ticks.push(value)});
  await flush();
  await e.advance(29_000);
  const file = await capture.result;
  assert.equal(file.type, 'video/webm');
  assert.equal(e.recorders[0].stopCalls, 1);
  assert.equal(ticks.at(-1), 0);
  assert.equal(ticks[0], 29);
  assert.ok(e.tracks.every(track => track.stops === 1));
  assert.equal(e.timers.size, 0);
});

test('permission denial and unsupported codecs offer an upload fallback without leaving timers', async () => {
  const denied = environment({permissionError:new DOMException('Denied', 'NotAllowedError')});
  await assert.rejects(denied.record().result, /Allow camera and microphone.*choose a video/);
  assert.equal(denied.timers.size, 0);
  assert.equal(denied.recorders.length, 0);
  for (const options of [{unsupported:true}, {supported:[]}]) {
    const unsupported = environment(options);
    await assert.rejects(unsupported.record().result, /Choose a video|Choose an MP4/);
    assert.equal(unsupported.calls.length, 0);
    assert.equal(unsupported.timers.size, 0);
  }
});

test('cancel during a pending permission prompt rejects immediately and closes a late granted stream', async () => {
  let grant;
  const e = environment({permission:new Promise(resolve => { grant = resolve; })});
  const previews = [];
  const capture = e.record({onStream:value => previews.push(value)});
  const rejection = assert.rejects(capture.result, error => error.name === 'AbortError');
  capture.cancel();
  await rejection;
  grant(e.stream);
  await flush();
  assert.ok(e.tracks.every(track => track.stops === 1));
  assert.equal(e.recorders.length, 0);
  assert.deepEqual(previews, [null]);
  assert.equal(e.timers.size, 0);
});

test('abort during recording stops hardware and ignores delayed recorder events', async () => {
  const e = environment();
  const controller = new AbortController();
  const capture = e.record({signal:controller.signal});
  const rejection = assert.rejects(capture.result, error => error.name === 'AbortError');
  await flush();
  const staleDataHandler = e.recorders[0].ondataavailable;
  controller.abort();
  staleDataHandler({data:new Blob(['late bytes'], {type:'video/mp4'})});
  await rejection;
  await flush();
  assert.ok(e.tracks.every(track => track.stops === 1));
  assert.equal(e.videos.length, 0);
  assert.equal(e.timers.size, 0);
});

test('oversized chunks or final data reject the recording and stop both tracks', async () => {
  for (const finalChunk of [false, true]) {
    const e = environment(finalChunk ? {finalBytes:4*1024*1024+1} : {});
    const capture = e.record();
    const rejection = assert.rejects(capture.result, /too large/);
    await flush();
    if (finalChunk) capture.stop(); else e.recorders[0].emitBytes(4*1024*1024+1);
    await rejection;
    assert.ok(e.tracks.every(track => track.stops === 1));
    assert.equal(e.timers.size, 0);
    assert.equal(e.videos.length, 0);
  }
});

test('recorder construction, start, error and missing stop events all release the camera', async () => {
  for (const options of [{constructorError:true}, {startError:true}, {runtimeError:true}, {stopNever:true}]) {
    const e = environment(options);
    const capture = e.record();
    const rejection = assert.rejects(capture.result, /could not start|stopped unexpectedly|could not finish/);
    await flush();
    if (options.runtimeError) e.recorders[0].onerror({});
    if (options.stopNever) { capture.stop(); await e.advance(5_000); }
    await rejection;
    assert.ok(e.tracks.every(track => track.stops === 1));
    assert.equal(e.timers.size, 0);
  }
});

test('cancel during final metadata validation releases the decoder and never returns a clip', async () => {
  const e = environment({pendingMetadata:true});
  const capture = e.record();
  const rejection = assert.rejects(capture.result, error => error.name === 'AbortError');
  await flush();
  capture.stop();
  await flush();
  assert.equal(e.videos.length, 1);
  capture.cancel();
  await rejection;
  assert.equal(e.revoked.length, 1);
  assert.ok(e.tracks.every(track => track.stops === 1));
  assert.equal(e.timers.size, 0);
});

test('a recorder that ends itself still validates the clip and shuts down both tracks', async () => {
  const e = environment({duration:Infinity});
  const capture = e.record();
  await flush();
  await e.advance(1_500);
  const recorder = e.recorders[0];
  recorder.emitBytes(100);
  recorder.state = 'inactive';
  recorder.onstop();
  assert.equal((await capture.result).size, 100);
  assert.ok(e.tracks.every(track => track.stops === 1));
  assert.equal(e.timers.size, 0);
});

test('a preview callback can cancel immediately without restarting the countdown', async () => {
  const e = environment();
  const ticks = [];
  const capture = e.record({onStream:stream => { if (stream) capture.cancel(); }, onTick:value => ticks.push(value)});
  await assert.rejects(capture.result, error => error.name === 'AbortError');
  assert.deepEqual(ticks, []);
  assert.ok(e.tracks.every(track => track.stops === 1));
  assert.equal(e.timers.size, 0);
});
