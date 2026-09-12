import { createHash } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { chicagoDay } from "./music-plays.mts";
import { publishedSongSnapshot, type SongStores } from "./member-songs.mts";

const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RECEIPT_AGE = 86400000;
const MAX_RECEIPTS = 1000;
const MAX_ATTEMPTS = 10;

type CurrentSong = { slot: number; revision: string };
type MemberPlayState = {
  version: 1;
  member_id: string;
  counts: Record<string, number>;
  total: number;
  day: string;
  today: number;
  today_counts: Record<string, number>;
  receipts: Record<string, number>;
};

export interface MemberPlayStore {
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: unknown; etag: string } | null>;
  setJSON(key: string, data: unknown, options: { onlyIfNew: true } | { onlyIfMatch: string }): Promise<{ modified: boolean }>;
}

export function memberPlayStore(context: Context): MemberPlayStore {
  const options = { name: "member-music-play-counts", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options)
    : getDeployStore({ ...options, deployID: context.deploy.id });
}

const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const stateKey = (memberId: string) => `counts-v1/${memberId}`;

function validDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function counterMap(value: unknown): value is Record<string, number> {
  return record(value) && Object.keys(value).length <= 3 &&
    Object.entries(value).every(([revision, count]) => MEMBER_ID.test(revision) && counter(count));
}

function initialState(memberId: string, now: number): MemberPlayState {
  return { version: 1, member_id: memberId, counts: {}, total: 0, day: chicagoDay(now), today: 0, today_counts: {}, receipts: {} };
}

function stateFrom(value: unknown, memberId: string): MemberPlayState {
  if (!record(value) || value.version !== 1 || value.member_id !== memberId || !counterMap(value.counts) || !counter(value.total) ||
      !validDay(value.day) || !counter(value.today) || value.today > value.total || !counterMap(value.today_counts) || !record(value.receipts) ||
      Object.keys(value.receipts).length > MAX_RECEIPTS ||
      Object.entries(value.receipts).some(([key, stamp]) => !/^[a-f0-9]{64}$/.test(key) || !counter(stamp)) ||
      Object.entries(value.today_counts).some(([revision, count]) => !Object.hasOwn(value.counts, revision) || count > (value.counts[revision] as number)) ||
      Object.values(value.counts).reduce((sum, count) => sum + count, 0) > value.total ||
      Object.values(value.today_counts).reduce((sum, count) => sum + count, 0) > value.today) {
    throw new Error("Invalid member play count state");
  }
  return {
    version: 1, member_id: memberId,
    counts: Object.fromEntries(Object.entries(value.counts)) as Record<string, number>,
    total: value.total, day: value.day, today: value.today,
    today_counts: Object.fromEntries(Object.entries(value.today_counts)) as Record<string, number>,
    receipts: Object.fromEntries(Object.entries(value.receipts)) as Record<string, number>,
  };
}

async function snapshot(store: MemberPlayStore, memberId: string, now: number) {
  const saved = await store.getWithMetadata(stateKey(memberId), { type: "json" });
  if (saved && (typeof saved.etag !== "string" || !saved.etag)) throw new Error("Missing member play count version");
  return { state: saved ? stateFrom(saved.data, memberId) : initialState(memberId, now), etag: saved?.etag ?? null };
}

function publicCounts(state: MemberPlayState, songs: CurrentSong[], now: number) {
  const counts = Object.fromEntries(songs.map(song => [song.revision, state.counts[song.revision] ?? 0]));
  return { counts, total: state.total, today: state.day === chicagoDay(now) ? state.today : 0, max_songs: 3 };
}

export function memberPlaysFailure(error?: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Play counts are unavailable right now. Please try again shortly." }, 503);
}

async function currentSongs(req: Request, stores: SongStores, requestedId: string): Promise<{ memberId: string; songs: CurrentSong[] }> {
  const current = await publishedSongSnapshot(req, stores, requestedId);
  if (!current.memberId) throw new MemberError(404, "This member's music is not available.");
  const songs = current.songs.map(song => ({ slot: song.slot, revision: song.revision }));
  if (songs.length > 3 || songs.some(song => !Number.isInteger(song.slot) || song.slot < 1 || song.slot > 3 ||
      typeof song.revision !== "string" || !MEMBER_ID.test(song.revision)) ||
      new Set(songs.map(song => song.slot)).size !== songs.length || new Set(songs.map(song => song.revision)).size !== songs.length) {
    throw new Error("Invalid published song list");
  }
  return { memberId: current.memberId, songs: songs as CurrentSong[] };
}

function requestedMember(req: Request): string {
  const values = new URL(req.url).searchParams.getAll("id");
  if (values.length !== 1 || (values[0] !== "owner" && !MEMBER_ID.test(values[0]))) throw new MemberError(400, "Choose a valid profile.");
  return values[0].toLowerCase();
}

export async function getMemberMusicPlays(req: Request, store: MemberPlayStore, songsStore: SongStores, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const current = await currentSongs(req, songsStore, requestedMember(req));
    return memberJSON(publicCounts((await snapshot(store, current.memberId, now)).state, current.songs, now));
  } catch (error) { return memberPlaysFailure(error); }
}

async function jsonSubmission(req: Request): Promise<{ member_id: string; slot: number; revision: string; session_id: string }> {
  if (!req.headers.get("origin") || req.headers.get("origin") !== new URL(req.url).origin ||
      req.headers.get("sec-fetch-site") === "cross-site") throw new MemberError(403, "Please play music from this website.");
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MemberError(415, "This play count format is not supported.");
  }
  if (Number(req.headers.get("content-length") || 0) > 2048 || !req.body) throw new MemberError(413, "This play request is too large.");
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new MemberError(413, "This play request is too large."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MemberError(400, "This play request could not be read."); }
  if (!record(body) || Object.keys(body).sort().join(",") !== "member_id,revision,session_id,slot" ||
      typeof body.member_id !== "string" || !MEMBER_ID.test(body.member_id) ||
      !Number.isInteger(body.slot) || body.slot < 1 || body.slot > 3 ||
      typeof body.revision !== "string" || !MEMBER_ID.test(body.revision) ||
      typeof body.session_id !== "string" || !SESSION_ID.test(body.session_id)) {
    throw new MemberError(400, "This play request is invalid.");
  }
  return { member_id: body.member_id.toLowerCase(), slot: body.slot, revision: body.revision.toLowerCase(), session_id: body.session_id.toLowerCase() };
}

export async function postMemberMusicPlay(
  req: Request, store: MemberPlayStore, songsStore: SongStores, now = Date.now(),
  pause: (attempt: number) => Promise<void> = attempt => new Promise(resolve => setTimeout(resolve, Math.min(80, 4 * 2 ** attempt) * (0.5 + Math.random()))),
): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const input = await jsonSubmission(req);
    const current = await currentSongs(req, songsStore, input.member_id);
    if (current.memberId !== input.member_id || !current.songs.some(song => song.slot === input.slot && song.revision === input.revision)) {
      throw new MemberError(409, "This song changed. Refresh the profile and try again.");
    }
    const receipt = createHash("sha256").update(`${input.member_id}:${input.revision}:${input.session_id}`).digest("hex");
    const revisions = new Set(current.songs.map(song => song.revision));
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { state, etag } = await snapshot(store, current.memberId, now);
      if (Object.hasOwn(state.receipts, receipt) && state.receipts[receipt] > now - RECEIPT_AGE) {
        return memberJSON(publicCounts(state, current.songs, now));
      }
      const day = chicagoDay(now);
      const counts = Object.fromEntries([...revisions].map(revision => [revision, state.counts[revision] ?? 0]));
      const todayCounts = Object.fromEntries([...revisions].map(revision => [revision, state.day === day ? state.today_counts[revision] ?? 0 : 0]));
      const today = state.day === day ? state.today : 0;
      if (state.total >= Number.MAX_SAFE_INTEGER || today >= Number.MAX_SAFE_INTEGER ||
          counts[input.revision] >= Number.MAX_SAFE_INTEGER || todayCounts[input.revision] >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Member play count capacity exceeded");
      }
      counts[input.revision]++; todayCounts[input.revision]++;
      const retained = Object.entries(state.receipts)
        .filter(([key, stamp]) => key !== receipt && stamp > now - RECEIPT_AGE)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_RECEIPTS - 1);
      const next: MemberPlayState = {
        version: 1, member_id: current.memberId, counts, total: state.total + 1, day, today: today + 1, today_counts: todayCounts,
        receipts: Object.fromEntries([...retained, [receipt, now]]),
      };
      const written = await store.setJSON(stateKey(current.memberId), next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      if (written.modified) return memberJSON(publicCounts(next, current.songs, now), 201);
      if (attempt + 1 < MAX_ATTEMPTS) await pause(attempt);
    }
    throw new Error("Member play count write contention");
  } catch (error) { return memberPlaysFailure(error); }
}
