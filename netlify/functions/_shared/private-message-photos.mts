import { createHash } from "node:crypto";
import { MemberError } from "./member-auth.mts";

export type MessagePhoto = { url: string; mime: "image/jpeg"; width: number; height: number };
export type PreparedPhoto = {
  bytes: ArrayBuffer; mime: "image/jpeg"; width: number; height: number;
  digest: string; sourceDigest: string;
};

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_PIXELS = 16000000;
const INVALID = "Choose a valid JPG, PNG or WebP photo.";
const invalid = () => new MemberError(415, INVALID);

// The raster decoder is a native image library. It is loaded the first time a
// photo is actually prepared, so reading, sending and listing plain messages
// never depends on it being installed for that runtime.
let decoderModule: Promise<typeof import("sharp").default> | undefined;
function imageDecoder(): Promise<typeof import("sharp").default> {
  decoderModule ??= import("sharp").then((module) => module.default);
  return decoderModule;
}

// Reject concatenated files, trailing payloads and animated containers before
// decoding. The actual pixel decoder then validates the complete raster and
// writes a new JPEG. Uploaded filenames, EXIF, GPS and comments are never kept.
function rasterFormat(data: Buffer): "jpeg" | "png" | "webp" {
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    let offset = 2, frame = false, scan = false;
    while (offset < data.length) {
      if (data[offset++] !== 0xff) throw invalid();
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xd9) {
        if (!frame || !scan || offset !== data.length) throw invalid();
        return "jpeg";
      }
      if (!marker || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > data.length) throw invalid();
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) throw invalid();
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) frame = true;
      offset += length;
      if (marker === 0xda) {
        scan = true;
        while (offset < data.length) {
          if (data[offset] !== 0xff) { offset++; continue; }
          const next = data[offset + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
          break;
        }
      }
    }
    throw invalid();
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8, pixels = false, first = true;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset);
      const kind = data.toString("ascii", offset + 4, offset + 8);
      if (offset + length + 12 > data.length || (first && (kind !== "IHDR" || length !== 13)) || kind === "acTL") throw invalid();
      if (kind === "IDAT") pixels = true;
      offset += length + 12;
      first = false;
      if (kind === "IEND") {
        if (length || !pixels || offset !== data.length) throw invalid();
        return "png";
      }
    }
    throw invalid();
  }
  if (data.length >= 20 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    if (data.readUInt32LE(4) + 8 !== data.length) throw invalid();
    let offset = 12, rasters = 0;
    while (offset + 8 <= data.length) {
      const kind = data.toString("ascii", offset, offset + 4);
      const length = data.readUInt32LE(offset + 4);
      if (kind === "ANIM" || kind === "ANMF") throw invalid();
      if (kind === "VP8 " || kind === "VP8L") rasters++;
      offset += 8 + length + (length % 2);
      if (offset > data.length) throw invalid();
    }
    if (offset !== data.length || rasters !== 1) throw invalid();
    return "webp";
  }
  throw invalid();
}

export async function normalizeMessagePhoto(value: FormDataEntryValue): Promise<PreparedPhoto> {
  if (!(value instanceof File)) throw invalid();
  if (!value.size || value.size > MAX_BYTES) throw new MemberError(413, "Choose a photo up to 3 MB.");
  const input = Buffer.from(await value.arrayBuffer());
  const format = rasterFormat(input);
  if (value.type && value.type !== `image/${format}`) throw invalid();
  const sharp = await imageDecoder();
  try {
    const decoder = sharp(input, { failOn: "warning", limitInputPixels: MAX_PIXELS, limitInputChannels: 4 });
    const metadata = await decoder.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1 ||
        !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 ||
        metadata.width * metadata.height > MAX_PIXELS) {
      throw new MemberError(415, "Choose a still photo no larger than 4096 pixels on each side.");
    }
    const { data, info } = await decoder
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 86, progressive: false })
      .toBuffer({ resolveWithObject: true });
    if (!data.length || data.length > MAX_BYTES) throw new MemberError(413, "Choose a smaller photo and try again.");
    return {
      bytes: new Uint8Array(data).buffer,
      mime: "image/jpeg", width: info.width, height: info.height,
      digest: createHash("sha256").update(data).digest("hex"),
      sourceDigest: createHash("sha256").update(input).digest("hex"),
    };
  } catch (error) {
    if (error instanceof MemberError) throw error;
    throw invalid();
  }
}
