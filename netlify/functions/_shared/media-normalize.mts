/** Server-side media conversion. Uploaded media is data, never a URL or command. */
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { validatePrivateMessageVideo } from './private-message-videos.mts';
import { validateMemberSongAudio } from './member-song-audio.mts';

export const MEDIA_SOURCE_LIMIT = 100 * 1024 * 1024;
export const SCREENING_LIMIT = 12 * 1024 * 1024;
export class MediaPreparationError extends Error {
  constructor(message: string) { super(message); this.name = 'MediaPreparationError'; }
}
type Options = { binary?: string; timeoutMs?: number; playback?: boolean; videoSeconds?: 30 | 31 };
export function ffmpegBinary(): string { return resolve('media-runtime/ffmpeg'); }
function sourceBuffer(bytes: ArrayBuffer): Buffer {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > MEDIA_SOURCE_LIMIT)
    throw new MediaPreparationError('Choose a file up to 100 MB.');
  return Buffer.from(bytes);
}
export function phoneContainer(bytes: ArrayBuffer): 'mov' | 'matroska' {
  const data = sourceBuffer(bytes);
  if (data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp') return 'mov';
  if (data.length >= 4 && data.readUInt32BE(0) === 0x1a45dfa3) return 'matroska';
  throw new MediaPreparationError('Choose an MP4, MOV, M4V or WebM video from your photo library.');
}
function run(binary: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((done, reject) => {
    let expired = false;
    // No shell, URLs, filename interpolation, caller-supplied flags or stdin.
    const child = spawn(binary, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    // Drain stderr without logging filenames or member media contents.
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { expired = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); reject(new MediaPreparationError('The media converter is unavailable. Your original file has not been changed.')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0 && !expired) done();
      else reject(new MediaPreparationError(expired
        ? 'This file took too long to process. Try a shorter clip or a lower resolution.'
        : 'This file could not be decoded completely. Choose the original MP4, MOV, WebM or MP3 file again.'));
    });
  });
}
async function convert(bytes: ArrayBuffer, format: string, audioOnly: boolean, options: Options): Promise<ArrayBuffer> {
  const data = sourceBuffer(bytes);
  const limit = audioOnly && options.playback ? 18 * 1024 * 1024 : SCREENING_LIMIT;
  const directory = await mkdtemp(join(tmpdir(), 'jwhite-media-'));
  const source = join(directory, 'source');
  const destination = join(directory, audioOnly ? 'review.mp3' : 'clip.mp4');
  try {
    await writeFile(source, data, { mode: 0o600 });
    // Demuxer and protocol allowlists prevent playlists, external URLs and network lookups.
    const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-xerror',
      '-protocol_whitelist', 'file', '-format_whitelist', format, '-f', format,
      '-threads', '2', '-filter_threads', '1', '-i', source];
    if (audioOnly) args.push('-map', '0:a:0', '-vn', '-sn', '-dn', '-t', '601',
      '-c:a', 'libmp3lame', '-ac', options.playback ? '2' : '1', '-ar', options.playback ? '44100' : '24000', '-b:a', options.playback ? '192k' : '48k', '-map_metadata', '-1', '-map_chapters', '-1');
    else args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-t', String(options.videoSeconds || 31),
      '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-maxrate', '2200k', '-bufsize', '4400k',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-threads', '2', '-movflags', '+faststart', '-map_metadata', '-1', '-map_chapters', '-1');
    args.push('-fs', String(limit + 1), destination);
    await run(options.binary || ffmpegBinary(), args, Math.min(180000, options.timeoutMs || 180000));
    const size = (await stat(destination)).size;
    if (!size || size > limit) throw new MediaPreparationError('The prepared file is too large. Try a shorter recording.');
    const result = await readFile(destination);
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
/** Read duration only from the MP4 just created by our converter, never the upload. */
function convertedDuration(bytes: ArrayBuffer): number {
  const b = Buffer.from(bytes);
  function atom(start: number, end: number, name: string): {start:number;end:number}|null {
    for (let p=start;p+8<=end;) {
      const raw=b.readUInt32BE(p); let header=8; let size=raw;
      if(raw===1) {
        if(p+16>end)throw new MediaPreparationError('The converted video is incomplete.');
        const big=b.readBigUInt64BE(p+8);
        if(big>BigInt(end-p))throw new MediaPreparationError('The converted video is incomplete.');
        size=Number(big);header=16;
      } else if(raw===0)size=end-p;
      if(size<header||p+size>end)throw new MediaPreparationError('The converted video is incomplete.');
      if(b.toString('ascii',p+4,p+8)===name)return {start:p+header,end:p+size};
      p+=size;
    }
    return null;
  }
  const moov=atom(0,b.length,'moov');
  const mvhd=moov&&atom(moov.start,moov.end,'mvhd');
  if(!mvhd)throw new MediaPreparationError('The converted video has no duration.');
  const p=mvhd.start,version=b[p];
  if(version!==0&&version!==1||p+(version===1?32:20)>mvhd.end)
    throw new MediaPreparationError('The converted video has an invalid duration.');
  const scale=b.readUInt32BE(p+(version===1?20:12));
  const ticks=version===1?Number(b.readBigUInt64BE(p+24)):b.readUInt32BE(p+16);
  const duration=ticks/scale;
  if(!Number.isFinite(duration)||duration<=0)throw new MediaPreparationError('The converted video has an invalid duration.');
  return duration;
}
export async function preparePhoneVideoOnServer(bytes: ArrayBuffer, options: Options = {}) {
  const format = phoneContainer(bytes);
  let prepared = await convert(bytes, format, false, {...options,videoSeconds:31});
  const duration=convertedDuration(prepared);
  // Inspect a second beyond the limit so a long source is not silently shortened.
  // AAC can add a final frame to an exactly 30 second recording. Bound that small
  // encoder pad in a second pass, rather than padding every short recording.
  if(duration>30.1)throw new MediaPreparationError('Videos must be 30 seconds or shorter. Trim the original in Photos and try again.');
  if(duration>30)prepared=await convert(bytes,format,false,{...options,videoSeconds:30});
  try { return validatePrivateMessageVideo(prepared, 'video/mp4', { maxBytes: SCREENING_LIMIT }); }
  catch { throw new MediaPreparationError('This video could not be prepared as a complete clip of 30 seconds or less. Choose the original recording and try again.'); }
}
export async function prepareSongForScreening(bytes: ArrayBuffer, options: Options = {}): Promise<ArrayBuffer> {
  // Keep the member's original for playback; convert only the complete review copy.
  const original = validateMemberSongAudio(bytes, 'audio/mpeg');
  const prepared = await convert(bytes, 'mp3', true, options);
  const reviewed = validateMemberSongAudio(prepared, 'audio/mpeg');
  if (Math.abs(reviewed.duration - original.duration) > 0.35)
    throw new MediaPreparationError('The full song could not be prepared for review. Try exporting the MP3 again.');
  return prepared;
}

/** Small enough for the host's 20 MB streaming response limit. Original stays private and intact. */
export async function prepareSongPlayback(bytes: ArrayBuffer, options: Options = {}): Promise<ArrayBuffer> {
  const original=validateMemberSongAudio(bytes,'audio/mpeg');
  const prepared=await convert(bytes,'mp3',true,{...options,playback:true});
  const playback=validateMemberSongAudio(prepared,'audio/mpeg');
  if(Math.abs(playback.duration-original.duration)>0.35)throw new MediaPreparationError('The complete song could not be prepared for playback.');
  return prepared;
}
