import { createHash } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";

export const VIDEO_IDS = [
  "NSZ26l3DIKE", "phtcAd8j6Ro", "GEsObsmLS8U", "Zj2cK8wymIA", "iMQKzsOIFbM", "fioIdmPrQIg",
  "b_Kx8tx88oQ", "XvinPCCGSxc", "M5ApFrZSFh0", "is7I3xqVnQo", "cyhbvJtNqv4", "1nq1ZLYYxx4",
  "jUEyjE92fG4", "kjfSPX3JW_4", "2BMZNs_BQDo", "PEGccV-NOm8", "xTlNMmZKwpA", "lEIqjoO0-Bs",
  "DmWWqogr_r8", "NEnephbahLA", "meFxq3-mNEc", "2Gy8eGr7AfM", "flPCk8Z5XS0", "8B2iv-7bNDQ",
  "qONfVYziSZw", "LtCfBdmxR_M",
] as const;
const TRACKS = new Set<string>(VIDEO_IDS);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const STATE_KEY = "counts-v1";
const RECEIPT_AGE = 86400000;
const MAX_RECEIPTS = 5000;
const MAX_ATTEMPTS = 10;

type PlayState = {
  version: 1;
  counts: Record<string, number>;
  total: number;
  day: string;
  today: number;
  receipts: Record<string, number>;
};
export interface PlayStore {
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: unknown; etag: string } | null>;
  setJSON(key: string, data: unknown, options: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<{ modified: boolean }>;
}
export function playStore(context: Context): PlayStore {
  const options = { name: "music-play-counts", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options)
    : getDeployStore({ ...options, deployID: context.deploy.id });
}

class PlayError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Netlify-CDN-Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
export function playsUnavailable(error?: unknown): Response {
  return error instanceof PlayError ? json({ error: error.message }, error.status)
    : json({ error: "Play counts are unavailable right now. Please try again shortly." }, 503);
}
export function chicagoDay(now: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function initialState(now: number): PlayState {
  return { version: 1, counts: Object.fromEntries(VIDEO_IDS.map(id => [id, 0])), total: 0, day: chicagoDay(now), today: 0, receipts: {} };
}
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

function stateFrom(value: unknown): PlayState {
  if (!record(value) || value.version !== 1 || !record(value.counts) || !record(value.receipts) ||
      !counter(value.total) || !counter(value.today) || value.today > value.total ||
      typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
      !Number.isFinite(Date.parse(`${value.day}T00:00:00Z`)) ||
      new Date(`${value.day}T00:00:00Z`).toISOString().slice(0, 10) !== value.day ||
      Object.keys(value.counts).length !== VIDEO_IDS.length ||
      Object.keys(value.counts).some(id => !TRACKS.has(id)) ||
      VIDEO_IDS.some(id => !counter(value.counts[id])) ||
      VIDEO_IDS.reduce((sum, id) => sum + (value.counts[id] as number), 0) !== value.total ||
      Object.keys(value.receipts).length > MAX_RECEIPTS ||
      Object.entries(value.receipts).some(([key, stamp]) => !/^[a-f0-9]{64}$/.test(key) || !counter(stamp))) {
    // Never replace damaged or unrecognized state with zeros.
    throw new Error("Invalid play count state");
  }
  return {
    version: 1, counts: Object.fromEntries(VIDEO_IDS.map(id => [id, value.counts[id] as number])),
    total: value.total, day: value.day, today: value.today,
    receipts: Object.fromEntries(Object.entries(value.receipts)) as Record<string, number>,
  };
}
function publicCounts(state: PlayState, now: number) {
  return { counts: state.counts, total: state.total, today: state.day === chicagoDay(now) ? state.today : 0 };
}
async function snapshot(store: PlayStore, now: number) {
  const saved = await store.getWithMetadata(STATE_KEY, { type: "json" });
  if (saved && (typeof saved.etag !== "string" || !saved.etag)) throw new Error("Missing play count version");
  return { state: saved ? stateFrom(saved.data) : initialState(now), etag: saved?.etag ?? null };
}

export async function getMusicPlays(req: Request, store: PlayStore, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  try { return json(publicCounts((await snapshot(store, now)).state, now)); }
  catch (error) { return playsUnavailable(error); }
}

async function submission(req: Request): Promise<{ video_id: string; session_id: string }> {
  if (!req.headers.get("origin") || req.headers.get("origin") !== new URL(req.url).origin ||
      req.headers.get("sec-fetch-site") === "cross-site") throw new PlayError(403, "Please play music from this website.");
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new PlayError(415, "This play count format is not supported.");
  }
  if (Number(req.headers.get("content-length") || 0) > 2048) throw new PlayError(413, "This play request is too large.");
  if (!req.body) throw new PlayError(400, "This play request is incomplete.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new PlayError(413, "This play request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new PlayError(400, "This play request could not be read."); }
  if (!record(body) || typeof body.video_id !== "string" || !TRACKS.has(body.video_id) ||
      typeof body.session_id !== "string" || !UUID.test(body.session_id)) throw new PlayError(400, "This play request is invalid.");
  return { video_id: body.video_id, session_id: body.session_id.toLowerCase() };
}

export async function postMusicPlay(
  req: Request, store: PlayStore, now = Date.now(),
  pause: (attempt: number) => Promise<void> = attempt => new Promise(resolve => setTimeout(resolve, Math.min(80, 4 * 2 ** attempt) * (0.5 + Math.random()))),
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const input = await submission(req);
    const receipt = createHash("sha256").update(`${input.video_id}:${input.session_id}`).digest("hex");
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { state, etag } = await snapshot(store, now);
      if (Object.hasOwn(state.receipts, receipt) && state.receipts[receipt] > now - RECEIPT_AGE) {
        return json(publicCounts(state, now));
      }
      if (state.total >= Number.MAX_SAFE_INTEGER || state.counts[input.video_id] >= Number.MAX_SAFE_INTEGER) throw new Error("Play count capacity exceeded");
      const day = chicagoDay(now);
      state.today = state.day === day ? state.today + 1 : 1;
      state.day = day;
      state.counts[input.video_id]++;
      state.total++;
      // Receipts and counters commit in the SAME document, so a CAS conflict
      // cannot count a retry twice. Retain at most 5,000 recent receipts for
      // 24 hours; oldest eviction can shorten dedupe during high traffic.
      const retained = Object.entries(state.receipts)
        .filter(([key, stamp]) => key !== receipt && stamp > now - RECEIPT_AGE)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_RECEIPTS - 1);
      state.receipts = Object.fromEntries([...retained, [receipt, now]]);
      const written = await store.setJSON(STATE_KEY, state, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      if (written.modified) return json(publicCounts(state, now), 201);
      if (attempt + 1 < MAX_ATTEMPTS) await pause(attempt);
    }
    throw new Error("Play count write contention");
  } catch (error) { return playsUnavailable(error); }
}
