// Bounded container inspection. Media timelines are checked on the server; a
// filename, MIME label or client-provided duration is never proof of duration.
// This is not a transcoder. Ancillary metadata is replaced with equal-sized
// padding so MP4 sample offsets and WebM seek offsets remain valid.
export const MAX_PRIVATE_VIDEO_BYTES = 4 * 1024 * 1024;
export const MAX_PRIVATE_VIDEO_SECONDS = 30;
export type PreparedVideo = { bytes: ArrayBuffer; mime: "video/mp4" | "video/webm"; width: number; height: number; duration: number };
const INVALID = "Choose a valid MP4 or WebM video recorded with H.264, VP8 or VP9.";
const fail = (message = INVALID): never => { throw new Error(message); };
const dimensions = (width: number, height: number) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1920 || height > 1920 || width * height > 4000000) fail("Choose a video no larger than 1920 pixels on each side.");
};
const durationLimit = (duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0) fail("This video's duration could not be verified. Try recording a new clip.");
  if (duration > MAX_PRIVATE_VIDEO_SECONDS) fail("Videos must be 30 seconds or shorter.");
};
type Box = { kind: string; start: number; data: number; end: number };
type Track = { id: number; kind: string; scale: number; width: number; height: number; start: number; end: number; samples: number; edits: Array<{ duration: number; time: number }>; defaultDuration: number; defaultSize: number };

function mp4(bytes: Buffer): Omit<PreparedVideo, "bytes" | "mime"> {
  let budget = 0;
  const u32 = (p: number) => { if (p < 0 || p + 4 > bytes.length) fail(); return bytes.readUInt32BE(p); };
  const u64 = (p: number) => { if (p < 0 || p + 8 > bytes.length) fail(); const n = bytes.readBigUInt64BE(p); if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail(); return Number(n); };
  const boxes = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    for (let p = start; p < end;) {
      if (++budget > 50000 || end - p < 8) fail();
      const size32 = u32(p); let kind = bytes.toString("latin1", p + 4, p + 8);
      const header = size32 === 1 ? 16 : 8;
      const size = size32 === 1 ? u64(p + 8) : size32 === 0 ? end - p : size32;
      if (size < header || p + size > end) fail();
      if (["udta", "meta", "uuid"].includes(kind)) {
        bytes.write("free", p + 4, "ascii"); bytes.fill(0, p + header, p + size); kind = "free";
      }
      result.push({ kind, start: p, data: p + header, end: p + size }); p += size;
    }
    return result;
  };
  const one = (items: Box[], kind: string, required = true): Box | undefined => {
    const found = items.filter(box => box.kind === kind);
    if (found.length > 1 || (required && !found.length)) fail();
    return found[0];
  };
  const need = (box: Box, count: number, offset = 0) => { if (box.data + offset + count > box.end) fail(); };
  const version = (box: Box, allowed = [0, 1]) => { need(box, 4); const value = bytes[box.data]; if (!allowed.includes(value)) fail(); return value; };
  const timingHeader = (box: Box) => {
    const v = version(box), p = box.data + (v ? 20 : 12); need(box, v ? 32 : 20);
    const scale = u32(p), duration = v ? u64(p + 4) : u32(p + 4);
    if (!scale || scale > 1000000000) fail();
    return { scale, duration };
  };
  const top = boxes(0, bytes.length);
  if (top[0]?.kind !== "ftyp" || top.some(box => !["ftyp", "moov", "mdat", "moof", "free", "wide", "skip", "sidx", "mfra", "styp", "prft"].includes(box.kind))) fail();
  const ftyp = one(top, "ftyp")!; need(ftyp, 8);
  const brands: string[] = [];
  for (let p = ftyp.data; p + 4 <= ftyp.end; p += 4) if (p !== ftyp.data + 4) brands.push(bytes.toString("latin1", p, p + 4));
  if (!brands.some(brand => ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "qt  "].includes(brand))) fail();
  const moov = boxes(one(top, "moov")!.data, one(top, "moov")!.end);
  const movie = timingHeader(one(moov, "mvhd")!);
  const mdats = top.filter(box => box.kind === "mdat");
  if (!mdats.length) fail();
  const ranges: Array<[number, number]> = [];
  let nalBudget = 0;
  const validateVideoSample = (start: number, size: number, track: Track) => {
    if (!mdats.some(box => start >= box.data && start + size <= box.end)) fail();
    let slice = false;
    for (let p = start; p < start + size;) {
      if (++nalBudget > 200000 || p + 4 > start + size) fail();
      const length = u32(p); p += 4;
      if (!length || p + length > start + size || bytes[p] & 0x80) fail();
      const kind = bytes[p] & 31;
      if (!kind || kind >= 24) fail();
      if (kind === 7) { const coded = h264Dimensions(bytes.subarray(p, p + length)); if (coded.width !== track.width || coded.height !== track.height) fail(); }
      if (kind >= 1 && kind <= 5) slice = true;
      p += length;
    }
    if (!slice) fail();
  };
  const addRange = (start: number, size: number) => {
    if (!Number.isSafeInteger(start) || !size || !mdats.some(box => start >= box.data && start + size <= box.end)) fail();
    ranges.push([start, start + size]);
  };
  const table = (box: Box, size: number, limit = 100000) => {
    version(box); need(box, 8); const count = u32(box.data + 4);
    if (count > limit || box.end - box.data !== 8 + count * size) fail();
    return count;
  };
  const tracks = new Map<number, Track>();
  for (const trak of moov.filter(box => box.kind === "trak")) {
    if (tracks.size >= 4) fail();
    const children = boxes(trak.data, trak.end), tkhd = one(children, "tkhd")!, tkversion = version(tkhd);
    need(tkhd, tkversion ? 96 : 84);
    const id = u32(tkhd.data + (tkversion ? 20 : 12));
    if (!id || tracks.has(id)) fail();
    const mdiaBox = one(children, "mdia")!, mdia = boxes(mdiaBox.data, mdiaBox.end);
    const mdhd = timingHeader(one(mdia, "mdhd")!), hdlr = one(mdia, "hdlr")!; need(hdlr, 12);
    const kind = bytes.toString("latin1", hdlr.data + 8, hdlr.data + 12);
    if (!["vide", "soun"].includes(kind)) fail();
    const minfBox = one(mdia, "minf")!, minf = boxes(minfBox.data, minfBox.end), stblBox = one(minf, "stbl")!, stbl = boxes(stblBox.data, stblBox.end);
    const dinf = one(minf, "dinf")!, dref = one(boxes(dinf.data, dinf.end), "dref")!;
    version(dref, [0]); need(dref, 8); if (u32(dref.data + 4) !== 1) fail();
    const references = boxes(dref.data + 8, dref.end);
    if (references.length !== 1 || references[0].kind !== "url " || references[0].end - references[0].data !== 4 || u32(references[0].data) !== 1) fail();
    const stsd = one(stbl, "stsd")!; version(stsd, [0]); need(stsd, 8);
    if (u32(stsd.data + 4) !== 1) fail();
    const sampleEntries = boxes(stsd.data + 8, stsd.end);
    if (sampleEntries.length !== 1) fail();
    const entry = sampleEntries[0];
    need(entry, 8); if (bytes.readUInt16BE(entry.data + 6) !== 1) fail();
    let width = 0, height = 0;
    if (kind === "vide") {
      if (entry.kind !== "avc1") fail(); need(entry, 78);
      width = bytes.readUInt16BE(entry.data + 24); height = bytes.readUInt16BE(entry.data + 26); dimensions(width, height);
      const avcC = one(boxes(entry.data + 78, entry.end), "avcC")!; need(avcC, 7);
      if (bytes[avcC.data] !== 1 || (bytes[avcC.data + 4] & 3) !== 3) fail();
      let p = avcC.data + 6; const spsCount = bytes[avcC.data + 5] & 31;
      if (!spsCount) fail();
      for (let i = 0; i < spsCount; i++) {
        if (p + 2 > avcC.end) fail(); const length = bytes.readUInt16BE(p); p += 2;
        if (!length || p + length > avcC.end) fail();
        const size = h264Dimensions(bytes.subarray(p, p + length));
        if (size.width !== width || size.height !== height) fail(); p += length;
      }
      if (p >= avcC.end) fail(); const pps = bytes[p++]; if (!pps) fail();
      for (let i = 0; i < pps; i++) { if (p + 2 > avcC.end) fail(); const size = bytes.readUInt16BE(p); p += 2; if (!size || p + size > avcC.end || (bytes[p] & 31) !== 8) fail(); p += size; }
    } else {
      if (entry.kind !== "mp4a") fail(); need(entry, 28);
      if (bytes.readUInt16BE(entry.data + 8) !== 0 || ![1, 2].includes(bytes.readUInt16BE(entry.data + 16))) fail();
      const esds = one(boxes(entry.data + 28, entry.end), "esds")!;
      version(esds, [0]); let p = esds.data + 4;
      const descriptor = (end: number) => {
        if (p >= end) fail(); const tag = bytes[p++]; let size = 0, complete = false;
        for (let i = 0; i < 4; i++) { if (p >= end) fail(); const part = bytes[p++]; size = size * 128 + (part & 127); if (!(part & 128)) { complete = true; break; } }
        if (!complete || p + size > end) fail(); return { tag, end: p + size };
      };
      const es = descriptor(esds.end); if (es.tag !== 3 || p + 3 > es.end) fail();
      p += 2; const flags = bytes[p++]; if (flags & 0xe0) fail();
      const decoder = descriptor(es.end); if (decoder.tag !== 4 || p + 13 > decoder.end || bytes[p] !== 0x40 || (bytes[p + 1] >> 2) !== 5) fail();
      p += 13; const config = descriptor(decoder.end); if (config.tag !== 5 || p + 2 > config.end || (bytes[p] >> 3) !== 2) fail();
    }
    const track: Track = { id, kind, scale: mdhd.scale, width, height, start: Infinity, end: 0, samples: 0, edits: [], defaultDuration: 0, defaultSize: 0 };
    const edts = one(children, "edts", false);
    if (edts) {
      const elst = one(boxes(edts.data, edts.end), "elst")!, v = version(elst), count = table(elst, v ? 20 : 12, 2);
      for (let i = 0, p = elst.data + 8; i < count; i++, p += v ? 20 : 12) {
        const segmentDuration = v ? u64(p) : u32(p), time = v ? Number(bytes.readBigInt64BE(p + 8)) : bytes.readInt32BE(p + 4), rate = u32(p + (v ? 16 : 8));
        if (!segmentDuration || !Number.isSafeInteger(time) || time < -1 || rate !== 65536) fail();
        track.edits.push({ duration: segmentDuration / movie.scale, time: time === -1 ? -1 : time / track.scale });
      }
    }
    const stsz = one(stbl, "stsz")!; version(stsz, [0]); need(stsz, 12);
    const fixedSize = u32(stsz.data + 4), sampleCount = u32(stsz.data + 8);
    if (sampleCount > 100000 || stsz.end - stsz.data !== 12 + (fixedSize ? 0 : sampleCount * 4)) fail();
    const sizes = Array.from({ length: sampleCount }, (_, i) => fixedSize || u32(stsz.data + 12 + i * 4));
    if (sizes.some(size => !size)) fail();
    const stts = one(stbl, "stts")!, sttsCount = table(stts, 8);
    const durations: number[] = [];
    for (let i = 0, p = stts.data + 8; i < sttsCount; i++, p += 8) {
      const count = u32(p), delta = u32(p + 4);
      if (!count || !delta || durations.length + count > sampleCount) fail();
      for (let j = 0; j < count; j++) durations.push(delta);
    }
    if (durations.length !== sampleCount) fail();
    const offsets = new Array(sampleCount).fill(0), ctts = one(stbl, "ctts", false);
    if (ctts) {
      const v = version(ctts), count = table(ctts, 8); let sample = 0;
      for (let i = 0, p = ctts.data + 8; i < count; i++, p += 8) {
        const n = u32(p), offset = v ? bytes.readInt32BE(p + 4) : u32(p + 4);
        if (!n || sample + n > sampleCount) fail(); for (let j = 0; j < n; j++) offsets[sample++] = offset;
      }
      if (sample !== sampleCount) fail();
    }
    let decode = 0;
    for (let i = 0; i < sampleCount; i++) { track.start = Math.min(track.start, (decode + offsets[i]) / track.scale); track.end = Math.max(track.end, (decode + offsets[i] + durations[i]) / track.scale); decode += durations[i]; }
    const stsc = one(stbl, "stsc")!, stscCount = table(stsc, 12), chunkMap: Array<{ first: number; count: number }> = [];
    for (let i = 0, p = stsc.data + 8; i < stscCount; i++, p += 12) { const first = u32(p), count = u32(p + 4); if (!count || (i === 0 ? first !== 1 : first <= chunkMap[i - 1].first) || u32(p + 8) !== 1) fail(); chunkMap.push({ first, count }); }
    const stco = one(stbl, "stco", false), co64 = one(stbl, "co64", false); if (Boolean(stco) === Boolean(co64)) fail();
    const chunkBox = (stco || co64)!, chunkCount = table(chunkBox, stco ? 4 : 8); let sample = 0, mapping = 0;
    if (Boolean(sampleCount) !== Boolean(chunkCount) || Boolean(sampleCount) !== Boolean(chunkMap.length)) fail();
    for (let i = 0; i < chunkCount; i++) {
      while (mapping + 1 < chunkMap.length && chunkMap[mapping + 1].first <= i + 1) mapping++;
      const count = chunkMap[mapping].count; if (sample + count > sampleCount) fail();
      const p = chunkBox.data + 8 + i * (stco ? 4 : 8), start = stco ? u32(p) : u64(p);
      let length = 0;
      for (let j = 0; j < count; j++) { const size = sizes[sample++]; if (track.kind === "vide") validateVideoSample(start + length, size, track); length += size; }
      addRange(start, length);
    }
    if (sample !== sampleCount) fail(); track.samples = sampleCount; tracks.set(id, track);
  }
  if ([...tracks.values()].filter(track => track.kind === "vide").length !== 1) fail();
  const mvex = one(moov, "mvex", false);
  if (mvex) for (const trex of boxes(mvex.data, mvex.end).filter(box => box.kind === "trex")) {
    version(trex, [0]); need(trex, 24); const track = tracks.get(u32(trex.data + 4));
    if (!track || u32(trex.data + 8) !== 1) fail(); track.defaultDuration = u32(trex.data + 12); track.defaultSize = u32(trex.data + 16);
  }
  for (const moof of top.filter(box => box.kind === "moof")) {
    if (!mvex) fail(); const trafs = boxes(moof.data, moof.end).filter(box => box.kind === "traf");
    for (const traf of trafs) {
      const child = boxes(traf.data, traf.end), tfhd = one(child, "tfhd")!; version(tfhd, [0]); need(tfhd, 8);
      const flags = u32(tfhd.data) & 0xffffff, track = tracks.get(u32(tfhd.data + 4)); if (!track || flags & ~0x03003b || flags & 0x010000) fail();
      let p = tfhd.data + 8, base = moof.start, defaultDuration = track.defaultDuration, defaultSize = track.defaultSize;
      if (flags & 1) { need(tfhd, 8, p - tfhd.data); base = u64(p); p += 8; } else if (!(flags & 0x020000) && trafs.length > 1) fail();
      if (flags & 2) { need(tfhd, 4, p - tfhd.data); if (u32(p) !== 1) fail(); p += 4; }
      if (flags & 8) { need(tfhd, 4, p - tfhd.data); defaultDuration = u32(p); p += 4; }
      if (flags & 16) { need(tfhd, 4, p - tfhd.data); defaultSize = u32(p); p += 4; }
      if (flags & 32) p += 4; if (p !== tfhd.end) fail();
      const tfdt = one(child, "tfdt")!, tv = version(tfdt); need(tfdt, tv ? 12 : 8);
      let decode = tv ? u64(tfdt.data + 4) : u32(tfdt.data + 4), dataEnd: number | undefined;
      const runs = child.filter(box => box.kind === "trun"); if (!runs.length) fail();
      for (const run of runs) {
        const v = version(run), flags = u32(run.data) & 0xffffff; need(run, 8);
        if (flags & ~0x000f05) fail(); const count = u32(run.data + 4); if (!count || track.samples + count > 100000) fail();
        let p = run.data + 8, offset = dataEnd;
        if (flags & 1) { need(run, 4, p - run.data); offset = base + bytes.readInt32BE(p); p += 4; }
        if (flags & 4) p += 4;
        if (offset === undefined) fail();
        let size = 0;
        for (let i = 0; i < count; i++) {
          const fields = ((flags & 0x100) ? 1 : 0) + ((flags & 0x200) ? 1 : 0) + ((flags & 0x400) ? 1 : 0) + ((flags & 0x800) ? 1 : 0); need(run, fields * 4, p - run.data);
          const delta = flags & 0x100 ? u32(p) : defaultDuration; if (flags & 0x100) p += 4;
          const length = flags & 0x200 ? u32(p) : defaultSize; if (flags & 0x200) p += 4;
          if (flags & 0x400) p += 4;
          const composition = flags & 0x800 ? (v ? bytes.readInt32BE(p) : u32(p)) : 0; if (flags & 0x800) p += 4;
          if (!delta || !length) fail();
          if (track.kind === "vide") validateVideoSample(offset! + size, length, track);
          track.start = Math.min(track.start, (decode + composition) / track.scale); track.end = Math.max(track.end, (decode + composition + delta) / track.scale);
          decode += delta; size += length;
        }
        if (p !== run.end) fail(); addRange(offset!, size); dataEnd = offset! + size; track.samples += count;
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail();
  if (!ranges.length) fail();
  let duration = movie.duration / movie.scale;
  for (const track of tracks.values()) {
    if (!track.samples || track.start < -0.25) fail();
    // A short movie/metadata duration or edit must not conceal a longer sample
    // timeline. Only a leading encoder-delay trim is discounted.
    const leadingTrim = track.edits.find(edit => edit.time >= 0)?.time ?? 0;
    if (track.end - leadingTrim > 30) fail("Videos must be 30 seconds or shorter.");
    let end = track.end;
    if (track.edits.length) {
      for (const edit of track.edits) if (edit.time !== -1 && edit.time + edit.duration > track.end + 0.001) fail();
      end = track.edits.reduce((sum, edit) => sum + edit.duration, 0);
    }
    duration = Math.max(duration, end);
  }
  durationLimit(duration);
  const video = [...tracks.values()].find(track => track.kind === "vide")!;
  return { width: video.width, height: video.height, duration };
}

// Decode the H.264 sequence parameter set so oversized coded dimensions cannot
// be hidden behind a small MP4 display-size field.
function h264Dimensions(nal: Buffer): { width: number; height: number } {
  if ((nal[0] & 31) !== 7 || nal.length > 65535) fail();
  const rbsp: number[] = [];
  for (let i = 1; i < nal.length; i++) { if (i >= 3 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue; rbsp.push(nal[i]); }
  let bit = 0;
  const read = (count: number) => { if (count < 0 || count > 32 || bit + count > rbsp.length * 8) fail(); let n = 0; for (let i = 0; i < count; i++, bit++) n = n * 2 + ((rbsp[bit >> 3] >> (7 - (bit & 7))) & 1); return n; };
  const ue = () => { let zeros = 0; while (!read(1)) if (++zeros > 24) fail(); return (2 ** zeros - 1) + read(zeros); };
  const se = () => { const v = ue(); return v & 1 ? (v + 1) / 2 : -v / 2; };
  const profile = read(8); read(16); ue(); let chroma = 1, separate = 0;
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    chroma = ue(); if (chroma > 3) fail(); if (chroma === 3) separate = read(1);
    if (ue() > 2 || ue() > 2) fail(); read(1);
    if (read(1)) for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) if (read(1)) { let last = 8, next = 8; for (let j = 0; j < (i < 6 ? 16 : 64); j++) { if (next) next = (last + se() + 256) % 256; last = next || last; } }
  }
  if (ue() > 12) fail(); const order = ue();
  if (order === 0) { if (ue() > 12) fail(); }
  else if (order === 1) { read(1); se(); se(); const cycles = ue(); if (cycles > 256) fail(); for (let i = 0; i < cycles; i++) se(); }
  else if (order !== 2) fail();
  ue(); read(1); const macroWidth = ue() + 1, mapHeight = ue() + 1, frameOnly = read(1);
  if (!frameOnly) read(1); read(1); let left = 0, right = 0, top = 0, bottom = 0;
  if (read(1)) { left = ue(); right = ue(); top = ue(); bottom = ue(); }
  const chromaArray = separate ? 0 : chroma, cropX = chromaArray === 0 || chromaArray === 3 ? 1 : 2, cropY = (chromaArray === 1 ? 2 : 1) * (2 - frameOnly);
  const width = macroWidth * 16 - cropX * (left + right), height = mapHeight * 16 * (2 - frameOnly) - cropY * (top + bottom);
  dimensions(width, height); return { width, height };
}

type Element = { id: number; start: number; data: number; end: number; unknown: boolean };
type WebTrack = { number: number; type: number; codec: string; width: number; height: number; defaultDuration: number; end: number; lastStart: number; frames: number; knownEnd: boolean; keyframe: boolean };
function webm(bytes: Buffer): Omit<PreparedVideo, "bytes" | "mime"> {
  let budget = 0;
  const vint = (p: number, end: number, identifier = false) => {
    if (p >= end || bytes[p] === 0) fail(); let length = 1, mask = 128;
    while (!(bytes[p] & mask)) { length++; mask >>= 1; }
    if (length > (identifier ? 4 : 8) || p + length > end) fail();
    let n = identifier ? bytes[p] : bytes[p] & (mask - 1), unknown = !identifier && n === mask - 1;
    for (let i = 1; i < length; i++) { n = n * 256 + bytes[p + i]; unknown = unknown && bytes[p + i] === 255; }
    if (!unknown && !Number.isSafeInteger(n)) fail(); return { n, length, unknown };
  };
  const element = (p: number, end: number): Element => {
    if (++budget > 100000) fail(); const id = vint(p, end, true), size = vint(p + id.length, end); const data = p + id.length + size.length;
    if (!size.unknown && data + size.n > end) fail();
    return { id: id.n, start: p, data, end: size.unknown ? end : data + size.n, unknown: size.unknown };
  };
  const removeMetadata = (item: Element) => {
    if (item.unknown) fail(); const total = item.end - item.start;
    for (let length = 1; length <= 8; length++) {
      let size = total - 1 - length; if (size < 0 || size >= 2 ** (length * 7) - 1) continue;
      bytes.fill(0, item.start, item.end); bytes[item.start] = 0xec;
      for (let i = length; i > 0; i--) { bytes[item.start + i] = size & 255; size = Math.floor(size / 256); }
      bytes[item.start + 1] |= 1 << (8 - length); item.id = 0xec; return;
    }
    fail();
  };
  const children = (item: Element): Element[] => { const result: Element[] = []; for (let p = item.data; p < item.end;) { const child = element(p, item.end); if (child.unknown) fail(); if (child.id === 0xbf) removeMetadata(child); result.push(child); p = child.end; } return result; };
  const one = (list: Element[], id: number, required = true) => { const result = list.filter(item => item.id === id); if (result.length > 1 || (required && !result.length)) fail(); return result[0]; };
  const uint = (item: Element | undefined, fallback = 0) => { if (!item) return fallback; if (item.end - item.data < 1 || item.end - item.data > 8) fail(); let n = 0; for (let p = item.data; p < item.end; p++) n = n * 256 + bytes[p]; if (!Number.isSafeInteger(n)) fail(); return n; };
  const str = (item: Element) => bytes.toString("utf8", item.data, item.end);
  const header = element(0, bytes.length); if (header.id !== 0x1a45dfa3 || header.unknown) fail();
  const headerFields = children(header); if (str(one(headerFields, 0x4282)!) !== "webm" || uint(one(headerFields, 0x42f7, false), 1) > 1 || uint(one(headerFields, 0x42f2, false), 4) > 4 || uint(one(headerFields, 0x42f3, false), 8) > 8) fail();
  const segment = element(header.end, bytes.length); if (segment.id !== 0x18538067 || segment.end !== bytes.length) fail();
  const items: Element[] = [], clusters: Element[] = [];
  const segmentIds = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1254c367, 0xec, 0xbf]);
  for (let p = segment.data; p < segment.end;) {
    const item = element(p, segment.end); if (!segmentIds.has(item.id)) fail();
    if (item.unknown) {
      if (item.id !== 0x1f43b675) fail(); let end = item.data;
      while (end < segment.end) { const child = element(end, segment.end); if (segmentIds.has(child.id) && child.id !== 0xec && child.id !== 0xbf) break; if (child.unknown) fail(); end = child.end; }
      if (end === item.data) fail(); item.end = end;
    }
    if (item.id === 0x1254c367 || item.id === 0xbf) removeMetadata(item);
    (item.id === 0x1f43b675 ? clusters : items).push(item); p = item.end;
  }
  const info = children(one(items, 0x1549a966)!), scale = uint(one(info, 0x2ad7b1, false), 1000000);
  for (const item of info) if ([0x7ba9, 0x4461].includes(item.id)) removeMetadata(item);
  if (!scale || scale > 1000000000 || !clusters.length) fail();
  const declared = one(info, 0x4489, false); let declaredDuration = 0;
  if (declared) { const size = declared.end - declared.data; if (![4, 8].includes(size)) fail(); declaredDuration = (size === 4 ? bytes.readFloatBE(declared.data) : bytes.readDoubleBE(declared.data)) * scale / 1e9; durationLimit(declaredDuration); }
  const tracks = new Map<number, WebTrack>();
  for (const entry of children(one(items, 0x1654ae6b)!)) {
    if (entry.id === 0xec || entry.id === 0xbf) continue; if (entry.id !== 0xae || tracks.size >= 4) fail();
    const fields = children(entry), number = uint(one(fields, 0xd7)), type = uint(one(fields, 0x83)), codec = str(one(fields, 0x86)!);
    for (const item of fields) if (item.id === 0x536e) removeMetadata(item);
    if (!number || number > 127 || tracks.has(number) || one(fields, 0x6d80, false)) fail();
    let width = 0, height = 0;
    if (type === 1) { if (!["V_VP8", "V_VP9"].includes(codec)) fail(); const video = children(one(fields, 0xe0)!); width = uint(one(video, 0xb0)); height = uint(one(video, 0xba)); dimensions(width, height); }
    else if (type === 2) { if (codec !== "A_OPUS") fail(); const privateData = one(fields, 0x63a2)!; if (privateData.end - privateData.data < 19 || bytes.toString("ascii", privateData.data, privateData.data + 8) !== "OpusHead" || ![1, 2].includes(bytes[privateData.data + 9])) fail(); }
    else fail();
    const defaultDuration = uint(one(fields, 0x23e383, false)) / 1e9; if (defaultDuration > 1) fail();
    tracks.set(number, { number, type, codec, width, height, defaultDuration, end: 0, lastStart: -1, frames: 0, knownEnd: false, keyframe: false });
  }
  if ([...tracks.values()].filter(track => track.type === 1).length !== 1) fail();
  for (const cluster of clusters) {
    const fields = children(cluster), clusterTime = uint(one(fields, 0xe7));
    for (const field of fields) {
      if ([0xe7, 0xa7, 0xab, 0xec, 0xbf].includes(field.id)) continue;
      let block: Element, blockDuration = 0;
      if (field.id === 0xa3) block = field;
      else if (field.id === 0xa0) { const group = children(field); block = one(group, 0xa1)!; blockDuration = uint(one(group, 0x9b, false)) * scale / 1e9; if (group.some(item => ![0xa1, 0x9b, 0xfb, 0x75a2, 0xec, 0xbf].includes(item.id))) fail(); }
      else fail();
      const number = vint(block.data, block.end), track = tracks.get(number.n), p = block.data + number.length;
      if (!track || p + 3 >= block.end || bytes[p + 2] & 0x06) fail(); // laced blocks are intentionally unsupported
      const start = (clusterTime + bytes.readInt16BE(p)) * scale / 1e9, packet = bytes.subarray(p + 3, block.end);
      if (start < 0 || start < track.lastStart || start > 30 || ++track.frames > 100000) fail();
      let packetDuration = blockDuration || track.defaultDuration;
      if (track.type === 2) {
        const actual = opusDuration(packet); if (packetDuration && Math.abs(packetDuration - actual) > 0.001) fail(); packetDuration = actual;
      } else {
        const coded = track.codec === "V_VP8" ? vp8Dimensions(packet) : vp9Dimensions(packet);
        if (coded) { dimensions(coded.width, coded.height); if (coded.width !== track.width || coded.height !== track.height) fail(); track.keyframe = true; }
        if (!track.keyframe) fail();
      }
      if (packetDuration > 1 || packetDuration < 0) fail();
      track.lastStart = start; track.knownEnd = packetDuration > 0; track.end = Math.max(track.end, start + packetDuration);
    }
  }
  let duration = 0;
  const audioEnd = Math.max(0, ...[...tracks.values()].filter(track => track.type === 2).map(track => track.end));
  for (const track of tracks.values()) {
    if (!track.frames) fail();
    if (!track.knownEnd) {
      // MediaRecorder may omit both Duration and DefaultDuration. Its Opus
      // packets still provide exact end times. Do not guess from frame spacing.
      if (track.type !== 1 || audioEnd <= track.lastStart) fail("This video's duration could not be verified. Record a new clip with sound.");
      track.end = Math.max(track.end, audioEnd);
    }
    duration = Math.max(duration, track.end);
  }
  duration = Math.max(duration, declaredDuration); durationLimit(duration);
  const video = [...tracks.values()].find(track => track.type === 1)!;
  return { width: video.width, height: video.height, duration };
}

function opusDuration(packet: Buffer): number {
  if (packet.length < 1) fail(); const toc = packet[0], config = toc >> 3, code = toc & 3;
  const frame = config >= 16 ? 0.0025 * 2 ** (config & 3) : config >= 12 ? 0.01 * 2 ** (config & 1) : [0.01, 0.02, 0.04, 0.06][config & 3];
  const count = code === 0 ? 1 : code === 3 ? (packet.length > 1 ? packet[1] & 63 : 0) : 2;
  if (!count || frame * count > 0.12 || packet.length <= (code === 3 ? 2 : 1)) fail(); return frame * count;
}
function vp8Dimensions(packet: Buffer): { width: number; height: number } | undefined {
  if (packet.length < 3) fail(); if (packet[0] & 1) return;
  if (packet.length < 10 || packet[3] !== 0x9d || packet[4] !== 1 || packet[5] !== 0x2a) fail();
  return { width: packet.readUInt16LE(6) & 16383, height: packet.readUInt16LE(8) & 16383 };
}
function vp9Dimensions(packet: Buffer): { width: number; height: number } | undefined {
  let offset = 0;
  const read = (count: number) => { if (offset + count > packet.length * 8) fail(); let value = 0; for (let i = 0; i < count; i++, offset++) value = value * 2 + ((packet[offset >> 3] >> (7 - (offset & 7))) & 1); return value; };
  if (read(2) !== 2) fail(); const profile = read(1) + 2 * read(1); if (profile === 3 && read(1)) fail();
  if (read(1)) { read(3); return; }
  const frameType = read(1); read(1); read(1); if (frameType) return;
  if (read(24) !== 0x498342) fail(); if (profile >= 2) read(1);
  const color = read(3);
  if (color !== 7) { read(1); if (profile === 1 || profile === 3) { read(2); if (read(1)) fail(); } }
  else { if (profile !== 1 && profile !== 3) fail(); if (read(1)) fail(); }
  return { width: read(16) + 1, height: read(16) + 1 };
}

export function validatePrivateMessageVideo(value: Uint8Array | ArrayBuffer, suppliedMime = "", options: { maxBytes?: number } = {}): PreparedVideo {
  const bytes = Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value));
  const limit = options.maxBytes === 12 * 1024 * 1024 ? options.maxBytes : MAX_PRIVATE_VIDEO_BYTES;
  if (!bytes.length || bytes.length > limit) fail(`Choose a video up to ${limit / 1024 / 1024} MB.`);
  const label = suppliedMime.split(";", 1)[0].trim().toLowerCase();
  try {
    if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
      if (label && !["video/mp4", "video/quicktime", "application/mp4"].includes(label)) fail();
      const metadata = mp4(bytes);
      return { bytes: new Uint8Array(bytes).buffer, mime: "video/mp4", ...metadata };
    }
    if (bytes.length >= 12 && bytes.readUInt32BE(0) === 0x1a45dfa3) {
      if (label && label !== "video/webm") fail();
      const metadata = webm(bytes);
      return { bytes: new Uint8Array(bytes).buffer, mime: "video/webm", ...metadata };
    }
    fail();
  } catch (error) {
    if (error instanceof Error && [INVALID, "Choose a video no larger than 1920 pixels on each side.", "Videos must be 30 seconds or shorter.", "This video's duration could not be verified. Try recording a new clip.", "This video's duration could not be verified. Record a new clip with sound."].includes(error.message)) throw error;
    fail();
  }
}
