import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {validateMemberSongAudio as validate, MAX_MEMBER_SONG_BYTES, MAX_MEMBER_SONG_SECONDS} from '../netlify/functions/_shared/member-song-audio.mts';

// Local fixtures, not copyrighted recordings:
// ffmpeg -f lavfi -i sine=frequency=440:duration=0.35 -ac 2 -ar 44100 -codec:a libmp3lame -b:a 64k -metadata title=Fixture member-song.mp3
// ffmpeg -f lavfi -i sine=frequency=660:duration=0.3 -ac 1 -ar 22050 -codec:a libmp3lame -q:a 6 -metadata title=SecondFixture member-song-alt.mp3
const source = fs.readFileSync(new URL('./fixtures/member-song.mp3', import.meta.url));
const alternate = fs.readFileSync(new URL('./fixtures/member-song-alt.mp3', import.meta.url));
const clean = Buffer.from(validate(source).bytes);
const other = Buffer.from(validate(alternate).bytes);
const mpeg1Rates = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
const mpeg2Rates = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
function frames(bytes) {
  const result = [];
  for (let p = 0; p < bytes.length;) {
    const version = (bytes[p + 1] >> 3) & 3, mpeg1 = version === 3;
    const channels = bytes[p + 3] >> 6 === 3 ? 1 : 2;
    const sampleRate = [44100,48000,32000][(bytes[p + 2] >> 2) & 3] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
    const size = Math.floor((mpeg1 ? 144000 : 72000) * (mpeg1 ? mpeg1Rates : mpeg2Rates)[bytes[p + 2] >> 4] / sampleRate) + ((bytes[p + 2] >> 1) & 1);
    const side = p + 4 + (bytes[p + 1] & 1 ? 0 : 2);
    const payload = side + (mpeg1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17);
    result.push({start:p, end:p + size, side, payload, size}); p += size;
  }
  return result;
}
function setBits(bytes, start, count, value) {
  for (let i = 0; i < count; i++) {
    const position = start + i, mask = 1 << (7 - (position & 7));
    bytes[position >> 3] = (bytes[position >> 3] & ~mask) | (((value >> (count - i - 1)) & 1) ? mask : 0);
  }
}
function tag(body, version = 4, footer = false) {
  const header = Buffer.from([73,68,51,version,0,footer ? 0x10 : 0,0,0,0,0]);
  let n = body.length;
  for (let i = 9; i >= 6; i--) { header[i] = n & 127; n = Math.floor(n / 128); }
  const ending = Buffer.from(header); ending.write('3DI');
  return Buffer.concat([header, body, ...(footer ? [ending] : [])]);
}
function crc(header, side) {
  let value = 65535;
  for (const b of [...header, ...side]) for (let bit = 7; bit >= 0; bit--) {
    const high = ((value >> 15) ^ (b >> bit)) & 1;
    value = (value << 1) & 65535;
    if (high) value ^= 0x8005;
  }
  return value;
}
function silentFrame({protectedCRC = false, lowRate = false} = {}) {
  // MPEG 1 32kbps/48kHz mono, or MPEG 2.5 8kbps/8kHz mono.
  const result = Buffer.alloc(lowRate ? 72 : 96);
  result.set([255, lowRate ? 0xe3 : protectedCRC ? 0xfa : 0xfb, lowRate ? 0x18 : 0x14, 0xc0]);
  if (protectedCRC) result.writeUInt16BE(crc(result.subarray(2,4), result.subarray(6,23)),4);
  return result;
}

test('real CBR stereo and VBR mono MP3s return normalized audio with frame-derived durations', () => {
  for (const input of [source, alternate]) {
    const output = validate(input, 'audio/mpeg');
    assert.equal(output.mime, 'audio/mpeg');
    assert.ok(output.bytes instanceof ArrayBuffer);
    assert.ok(output.duration > .3 && output.duration < .5);
    assert.ok(output.bytes.byteLength < input.length);
  }
  assert.ok(new Set(frames(other).map(frame => frame.size)).size > 1);
});

test('normalization strips ID3 and unused encoder/seek metadata, preserves input, and is idempotent', () => {
  const before = Buffer.from(source);
  assert.ok(source.includes(Buffer.from('Fixture')));
  assert.ok(source.includes(Buffer.from('Info')));
  const output = validate(source);
  for (const text of ['Fixture','Lavf','LAME','Lavc','Info','Xing']) assert.equal(Buffer.from(output.bytes).includes(Buffer.from(text)), false);
  assert.deepEqual(source, before);
  assert.deepEqual(validate(output.bytes).bytes, output.bytes);
  assert.deepEqual(validate(new Uint8Array(output.bytes)).bytes, output.bytes);
});

test('bounded ID3v2.2, v2.3, v2.4/footer and trailing ID3v1 metadata is removed', () => {
  const marker = Buffer.from('Private artwork and location metadata');
  const id3v1 = Buffer.alloc(128); id3v1.write('TAG'); marker.copy(id3v1, 3);
  for (const [version, footer] of [[2,false],[3,false],[4,false],[4,true]]) {
    const result = validate(Buffer.concat([tag(marker,version,footer),clean,id3v1]));
    assert.deepEqual(Buffer.from(result.bytes), clean);
  }
});

test('large, recursive, corrupt and truncated ID3 metadata is rejected', () => {
  const invalidSize = tag(Buffer.from('x')); invalidSize[6] = 0x80;
  const badFooter = tag(Buffer.from('x'),4,true); badFooter[badFooter.length - 10] = 0;
  const invalidFlags = tag(Buffer.from('x'),3); invalidFlags[5] = 1;
  const oversized = tag(Buffer.alloc(512 * 1024));
  const repeated = Buffer.concat(Array.from({length:5},() => tag(Buffer.from('x'))));
  for (const prefix of [invalidSize,badFooter,invalidFlags,oversized,repeated,Buffer.from('ID3')]) assert.throws(() => validate(Buffer.concat([prefix, clean])));
});

test('non-MP3 labels/content, empty and oversized inputs are rejected', () => {
  for (const mime of ['video/mp4','text/html','image/jpeg','audio/wav']) assert.throws(() => validate(source,mime));
  for (const mime of ['', 'audio/mp3','audio/x-mp3','application/octet-stream','Audio/MPEG; codecs=mp3']) assert.equal(validate(source,mime).mime,'audio/mpeg');
  for (const input of [new Uint8Array(),new Uint8Array(MAX_MEMBER_SONG_BYTES + 1),Buffer.from('<html>not mp3</html>'),Buffer.from('RIFF0000WAVE'),null,{},'audio']) assert.throws(() => validate(input));
});

test('array-buffer views honor their real offset and length', () => {
  const combined = Buffer.concat([Buffer.from('garbage'),clean,Buffer.from('garbage')]);
  assert.deepEqual(Buffer.from(validate(combined.subarray(7,-7)).bytes),clean);
  assert.throws(() => validate(combined));
});

test('unparsed prefixes, suffixes, extra tags and ZIP/HTML polyglot trailers are rejected', () => {
  for (const extra of [Buffer.from('PK\x03\x04payload'),Buffer.from('<script>alert(1)</script>'),tag(Buffer.from('extra')),Buffer.alloc(10)]) {
    assert.throws(() => validate(Buffer.concat([clean,extra])));
    if (!extra.subarray(0,3).equals(Buffer.from('ID3'))) assert.throws(() => validate(Buffer.concat([extra,clean])));
  }
  const tag1 = Buffer.alloc(128); tag1.write('TAG');
  assert.throws(() => validate(Buffer.concat([clean,tag1,tag1])));
});

test('truncated final frames and changed frame boundaries never resynchronize silently', () => {
  const last = frames(clean).at(-1);
  for (let size = last.start + 1; size < clean.length; size++) assert.throws(() => validate(clean.subarray(0,size)));
  const gap = Buffer.concat([clean.subarray(0,frames(clean)[0].end),Buffer.from([0]),clean.subarray(frames(clean)[0].end)]);
  assert.throws(() => validate(gap));
  assert.throws(() => validate(clean.subarray(0,frames(clean)[0].end)));
});

test('reserved sync, version, layer, bitrate, rate and emphasis values are rejected', () => {
  for (const [index,value] of [[0,0xfe],[1,0xeb],[1,0xfd],[2,0],[2,0xf0],[2,0x4c],[3,2]]) {
    const changed = Buffer.from(clean); changed[index] = value;
    assert.throws(() => validate(changed), `index ${index}, value ${value}`);
  }
});

test('sample rate, MPEG version and channel-count changes are rejected', () => {
  const second = frames(clean)[1].start;
  for (const [offset,mask,value] of [[1,0x18,0x10],[2,0x0c,4],[3,0xc0,0xc0]]) {
    const changed = Buffer.from(clean); changed[second + offset] = (changed[second + offset] & ~mask) | value;
    assert.throws(() => validate(changed));
  }
});

test('impossible side information and reserved Huffman tables are rejected', () => {
  const side = frames(clean)[0].side * 8;
  for (const [position,count,value] of [[32,9,511],[20,12,4095],[54,5,4],[54,5,14]]) {
    const changed = Buffer.from(clean); setBits(changed,side + position,count,value);
    assert.throws(() => validate(changed));
  }
  const switched = Buffer.from(clean); setBits(switched,side + 53,1,1);
  assert.throws(() => validate(switched));
});

test('reservoir underflow and overlapping coded spans are rejected', () => {
  const underflow = Buffer.from(clean); setBits(underflow,frames(clean)[0].side * 8,9,511);
  assert.throws(() => validate(underflow));
  const overlap = Buffer.from(clean); const third = frames(clean)[2];
  setBits(overlap,third.side * 8,9,511);
  assert.throws(() => validate(overlap));
});

test('CRC-protected frames are accepted only with a correct header/side-information checksum', () => {
  const valid = Buffer.concat([silentFrame({protectedCRC:true}),silentFrame({protectedCRC:true})]);
  assert.equal(validate(valid).duration,.048);
  const changed = Buffer.from(valid); changed[4] ^= 1;
  assert.throws(() => validate(changed));
  const sideChanged = Buffer.from(valid); sideChanged[8] ^= 1;
  assert.throws(() => validate(sideChanged));
});

test('MPEG 2.5 low sample rate has the correct frame-derived duration', () => {
  const input = Buffer.concat([silentFrame({lowRate:true}),silentFrame({lowRate:true})]);
  assert.equal(validate(input).duration,.144);
});

test('forged Xing duration and ancillary scripts are discarded and cannot affect duration', () => {
  const raw = Buffer.from(source);
  const info = raw.indexOf(Buffer.from('Info'));
  raw.write('Xing',info); raw.fill(0xff,info + 4,info + 16);
  const result = validate(raw);
  assert.equal(result.duration,validate(source).duration);
  assert.deepEqual(result.bytes,validate(source).bytes);
  const ancillary = Buffer.from(clean);
  ancillary.write('<script>private metadata</script>',frames(clean)[0].payload);
  assert.deepEqual(validate(ancillary).bytes,validate(clean).bytes);
});

test('ten-minute boundary is computed from all frames without trusting metadata', () => {
  assert.equal(MAX_MEMBER_SONG_SECONDS,600);
  const exact = Buffer.concat(Array.from({length:25000},() => silentFrame()));
  assert.ok(exact.length < MAX_MEMBER_SONG_BYTES);
  assert.equal(validate(exact).duration,600);
  assert.throws(() => validate(Buffer.concat([exact,silentFrame()])),/10 minutes/);
});
