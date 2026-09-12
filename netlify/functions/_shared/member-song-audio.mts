// Bounded MPEG Layer III structural validation. This is not an audio decoder:
// frame headers, side information, CRCs and reservoir bounds are checked; the
// browser's MP3 decoder still handles the coded Huffman audio data.
// The reservoir layout follows RFC 3119, section 2 and appendix A.
export const MAX_MEMBER_SONG_BYTES = 100 * 1024 * 1024;
export const MAX_MEMBER_SONG_SECONDS = 600;
export type PreparedMemberSong = {bytes: ArrayBuffer; mime: 'audio/mpeg'; duration: number};
const INVALID = 'Choose a complete, valid MP3 audio file.';
const fail = (message = INVALID): never => { throw new Error(message); };
const MPEG1_BITRATES = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
const MPEG2_BITRATES = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
const MAX_TAG_BYTES = 512 * 1024;
const MAX_FRAMES = 50_000;

class Bits {
  position = 0;
  private data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  read(count: number): number {
    if (this.position + count > this.data.length * 8) fail();
    let value = 0;
    for (let i = 0; i < count; i++, this.position++) value = value * 2 + ((this.data[this.position >> 3] >> (7 - (this.position & 7))) & 1);
    return value;
  }
}

function crc16(header: Uint8Array, side: Uint8Array): number {
  let crc = 0xffff;
  for (const data of [header, side]) for (const value of data) {
    for (let bit = 7; bit >= 0; bit--) {
      const carry = ((crc >> 15) ^ (value >> bit)) & 1;
      crc = (crc << 1) & 0xffff;
      if (carry) crc ^= 0x8005;
    }
  }
  return crc;
}

function sideInfo(data: Uint8Array, mpeg1: boolean, channels: number) {
  const bits = new Bits(data);
  const back = bits.read(mpeg1 ? 9 : 8);
  bits.read(mpeg1 ? (channels === 1 ? 5 : 3) : (channels === 1 ? 1 : 2));
  if (mpeg1) bits.read(channels * 4); // scfsi
  let length = 0;
  for (let granule = 0; granule < (mpeg1 ? 2 : 1); granule++) for (let channel = 0; channel < channels; channel++) {
    const partLength = bits.read(12);
    length += partLength;
    const bigValues = bits.read(9);
    if (bigValues > 288) fail();
    bits.read(8); // global_gain
    bits.read(mpeg1 ? 4 : 9); // scalefac_compress
    const switched = bits.read(1);
    if (switched) {
      const blockType = bits.read(2);
      const mixed = bits.read(1);
      if (!blockType || (mixed && blockType !== 2)) fail();
      for (let table = 0; table < 2; table++) if ([4,14].includes(bits.read(5))) fail();
      bits.read(9); // subblock_gain
    } else {
      for (let table = 0; table < 3; table++) if ([4,14].includes(bits.read(5))) fail();
      if (bits.read(4) + bits.read(3) > 20) fail();
    }
    if (mpeg1) bits.read(1); // preflag
    bits.read(2); // scalefac_scale, count1table_select
  }
  if (bits.position !== data.length * 8) fail();
  return {back, length};
}

function signature(bytes: Uint8Array, offset: number, value: string): boolean {
  return offset >= 0 && offset + value.length <= bytes.length && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function audioBounds(bytes: Uint8Array): [number, number] {
  let start = 0;
  let tags = 0;
  while (signature(bytes, start, 'ID3')) {
    if (++tags > 4 || start + 10 > bytes.length) fail();
    const version = bytes[start + 3], revision = bytes[start + 4], flags = bytes[start + 5];
    if (![2,3,4].includes(version) || revision === 255 || flags & (version === 2 ? 0x3f : version === 3 ? 0x1f : 0x0f)) fail();
    let size = 0;
    for (let i = 6; i < 10; i++) {
      if (bytes[start + i] & 0x80) fail();
      size = size * 128 + bytes[start + i];
    }
    const footer = version === 4 && (flags & 0x10) ? 10 : 0;
    const next = start + 10 + size + footer;
    if (next > bytes.length || next > MAX_TAG_BYTES) fail('This MP3 has too much or incomplete embedded metadata. Export it without artwork and try again.');
    if (footer) {
      const position = next - 10;
      if (!signature(bytes, position, '3DI')) fail();
      for (let i = 3; i < 10; i++) if (bytes[position + i] !== bytes[start + i]) fail();
    }
    start = next;
  }
  const end = signature(bytes, bytes.length - 128, 'TAG') ? bytes.length - 128 : bytes.length;
  if (end <= start) fail();
  return [start, end];
}

export function validateMemberSongAudio(input: Uint8Array | ArrayBuffer, mime = ''): PreparedMemberSong {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) fail();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) fail();
  if (bytes.length > MAX_MEMBER_SONG_BYTES) fail('Choose an MP3 of 100 MB or less.');
  if (!['','audio/mpeg','audio/mp3','audio/x-mp3','audio/x-mpeg','application/octet-stream'].includes(mime.split(';')[0].trim().toLowerCase())) fail();
  const [start, end] = audioBounds(bytes);
  const frames: Array<{start: number; end: number; payload: number; logical: number}> = [];
  const spans: Array<[number, number]> = [];
  let firstVersion = -1, sampleRate = 0, firstChannels = 0, samplesPerFrame = 0;
  let logicalBytes = 0, previousEndBits = 0;
  for (let position = start; position < end;) {
    if (frames.length >= MAX_FRAMES || position + 4 > end) fail();
    if (bytes[position] !== 0xff || (bytes[position + 1] & 0xe0) !== 0xe0) fail();
    const version = (bytes[position + 1] >> 3) & 3;
    const layer = (bytes[position + 1] >> 1) & 3;
    const protectedCRC = !(bytes[position + 1] & 1);
    const bitrateIndex = bytes[position + 2] >> 4;
    const rateIndex = (bytes[position + 2] >> 2) & 3;
    const padding = (bytes[position + 2] >> 1) & 1;
    const mode = bytes[position + 3] >> 6;
    const channels = mode === 3 ? 1 : 2;
    const mpeg1 = version === 3;
    if (version === 1 || layer !== 1 || !bitrateIndex || bitrateIndex === 15 || rateIndex === 3 || (bytes[position + 3] & 3) === 2) fail();
    const rate = [44100,48000,32000][rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
    if (!frames.length) { firstVersion = version; sampleRate = rate; firstChannels = channels; samplesPerFrame = mpeg1 ? 1152 : 576; }
    if (version !== firstVersion || rate !== sampleRate || channels !== firstChannels) fail();
    const bitrate = (mpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES)[bitrateIndex];
    const size = Math.floor((mpeg1 ? 144000 : 72000) * bitrate / rate) + padding;
    const sideStart = position + 4 + (protectedCRC ? 2 : 0);
    const sideLength = mpeg1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
    const payload = sideStart + sideLength;
    const frameEnd = position + size;
    if (frameEnd > end || payload >= frameEnd) fail();
    const side = bytes.subarray(sideStart, payload);
    if (protectedCRC && crc16(bytes.subarray(position + 2, position + 4), side) !== ((bytes[position + 4] << 8) | bytes[position + 5])) fail();
    const info = sideInfo(side, mpeg1, channels);
    const dataStartBits = (logicalBytes - info.back) * 8;
    const dataEndBits = dataStartBits + info.length;
    if (dataStartBits < previousEndBits || dataStartBits < 0 || dataEndBits > (logicalBytes + frameEnd - payload) * 8) fail();
    if (info.length) { spans.push([dataStartBits, dataEndBits]); previousEndBits = dataEndBits; }
    frames.push({start: position, end: frameEnd, payload, logical: logicalBytes});
    logicalBytes += frameEnd - payload;
    if (frames.length * samplesPerFrame > sampleRate * MAX_MEMBER_SONG_SECONDS) fail('Songs must be 10 minutes or shorter.');
    position = frameEnd;
  }
  if (frames.length < 2) fail();

  // Strip all non-audio ancillary data, including Xing/Info/VBRI/LAME text.
  // Reservoir references can reach earlier frames, so retain coded spans only
  // after every frame has been validated. No audio bits are decoded or changed.
  const used = new Uint8Array(logicalBytes);
  for (const [first, last] of spans) {
    const firstByte = first >> 3, lastByte = (last - 1) >> 3;
    if (firstByte === lastByte) used[firstByte] |= (0xff >> (first & 7)) & (0xff << (7 - ((last - 1) & 7)));
    else {
      used[firstByte] |= 0xff >> (first & 7);
      used.fill(0xff, firstByte + 1, lastByte);
      used[lastByte] |= 0xff << (7 - ((last - 1) & 7));
    }
  }
  const normalized = new Uint8Array(end - start);
  for (const frame of frames) {
    normalized.set(bytes.subarray(frame.start, frame.payload), frame.start - start);
    for (let position = frame.payload; position < frame.end; position++) normalized[position - start] = bytes[position] & used[frame.logical + position - frame.payload];
  }
  return {bytes: normalized.buffer, mime: 'audio/mpeg', duration: frames.length * samplesPerFrame / sampleRate};
}
