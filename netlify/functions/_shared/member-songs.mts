import { createHash, randomUUID } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { getPublicProfile, profileStore, type ProfileMember, type ProfileStore } from "./member-profiles.mts";
import { communityDirectory, type CommunityReader } from "./community-members.mts";
import { friendStore } from "./friends.mts";
import { validateMemberSongAudio, MAX_MEMBER_SONG_BYTES, MAX_MEMBER_SONG_SECONDS } from "./member-song-audio.mts";
import { readAudioUpload, type TransferStore } from "./audio-transfers.mts";
import { moderateSong, SONG_MODERATION_POLICY_VERSION } from "./video-moderation.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";
import { ownerCatalogSongs } from "./owner-music-catalog.mts";

export interface SongsStore {
  get(key: string, options: { type: "json" | "arrayBuffer" }): Promise<any>;
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: any; etag: string } | null>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean }>;
  set(key: string, bytes: ArrayBuffer, options: { onlyIfNew: true }): Promise<{ modified: boolean }>;
}
export type SongStores = { songs: SongsStore; profiles: ProfileStore; directory?: CommunityReader; friends?: CommunityReader };
type SongStatus = "empty" | "pending" | "approved" | "rejected";
type SongSource = "upload" | "link";
type MusicProvider = "apple" | "spotify" | "youtube";
type Song = {
  member_id: string; slot: number; revision: string; status: SongStatus;
  title: string | null; duration: number | null; asset_id: string | null; digest: string | null; size: number | null;
  source: SongSource; provider: MusicProvider | null; external_url: string | null;
  name: string; request_id: string; input_digest: string; created_at: string;
  policy_version: string; reason: string; playback_digest?: string; playback_size?: number;
};
type Options = {
  preparePlayback?: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  transfers?: TransferStore;
  resolveMember?: () => Promise<ProfileMember>;
  fetchMusic?: typeof fetch;
  moderate?: (input: { bytes: ArrayBuffer; mime: "audio/mpeg"; name: string; caption: string; duration: number }) => Promise<unknown>;
};
const HASH = /^[a-f0-9]{64}$/;
const BAD_TEXT = /[\u0000-\u001f\u007f]/;
const MAX_BODY = 4.25 * 1024 * 1024;
export const MUSIC_LINK_POLICY_VERSION = "music-link-v1";
const PROVIDERS = new Set<MusicProvider>(["apple", "spotify", "youtube"]);
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const keyFor = (id: string, slot: number) => `slots/${id}/${slot}`;
const blobKey = (song: Song) => `audio/${song.member_id}/${song.slot}/${song.asset_id}`;
const audioURL = (song: Song) => `/api/member-song-audio/${song.member_id}/${song.slot}/${song.asset_id}`;
const approved = (song: Song | null): song is Song => !!song && song.status === "approved" &&
  (song.source === "link" ? song.policy_version === MUSIC_LINK_POLICY_VERSION : song.policy_version === SONG_MODERATION_POLICY_VERSION);

export function parseMusicLink(value: unknown): { provider: MusicProvider; url: string } {
  if (typeof value !== "string" || !value.trim() || value.length > 1000 || BAD_TEXT.test(value)) {
    throw new MemberError(400, "Paste an Apple Music, Spotify or YouTube song link.");
  }
  let input: URL;
  try { input = new URL(value.trim()); }
  catch { throw new MemberError(400, "Paste a full Apple Music, Spotify or YouTube song link."); }
  if (input.protocol !== "https:" || input.username || input.password || input.port) {
    throw new MemberError(400, "Use a secure Apple Music, Spotify or YouTube link.");
  }
  const host = input.hostname.toLowerCase();
  if (host === "open.spotify.com") {
    const match = /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?track\/([a-zA-Z0-9]{22})\/?$/i.exec(input.pathname);
    if (!match) throw new MemberError(400, "Paste a Spotify link to one song, not an album or playlist.");
    return { provider: "spotify", url: `https://open.spotify.com/track/${match[1]}` };
  }
  if (host === "music.apple.com" || host === "embed.music.apple.com") {
    const match = /^\/([a-z]{2})\/(album|song)\/([a-zA-Z0-9._~%-]+)\/(\d+)\/?$/i.exec(input.pathname);
    const songId = input.searchParams.get("i");
    if (!match || (match[2].toLowerCase() === "album" && (!songId || !/^\d+$/.test(songId)))) {
      throw new MemberError(400, "Paste an Apple Music link to one song, not an album or playlist.");
    }
    const base = `https://music.apple.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}/${match[3]}/${match[4]}`;
    return { provider: "apple", url: songId && /^\d+$/.test(songId) ? `${base}?i=${songId}` : base };
  }
  const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
  let videoId: string | null = null;
  if (host === "youtu.be") videoId = input.pathname.slice(1).split("/")[0] || null;
  else if (youtubeHosts.has(host)) {
    if (input.pathname === "/watch") videoId = input.searchParams.get("v");
    else videoId = /^\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})\/?$/.exec(input.pathname)?.[1] ?? null;
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new MemberError(400, "Paste a YouTube link to one song or video.");
  }
  return { provider: "youtube", url: `https://www.youtube.com/watch?v=${videoId}` };
}

function spotifyShareLink(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 1000 || BAD_TEXT.test(value)) return null;
  let input: URL;
  try { input = new URL(value.trim()); } catch { return null; }
  if (input.protocol !== "https:" || input.username || input.password || input.port || input.hostname.toLowerCase() !== "spotify.link") return null;
  const match = /^\/([a-zA-Z0-9_-]{2,200})\/?$/.exec(input.pathname);
  return match ? `https://spotify.link/${match[1]}` : null;
}

export async function resolveMusicLink(value: unknown, load: typeof fetch = fetch): Promise<{ provider: MusicProvider; url: string }> {
  try { return parseMusicLink(value); }
  catch (error) {
    const short = spotifyShareLink(value);
    if (!short) throw error;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await load(`https://spotify.link/oembed?url=${encodeURIComponent(short)}`, {
        method: "GET", redirect: "error", headers: { Accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok || Number(response.headers.get("content-length") || 0) > 65536) throw new Error("Spotify link unavailable");
      const text = await response.text();
      if (text.length > 65536) throw new Error("Spotify response too large");
      const data = JSON.parse(text);
      if (data?.provider_name !== "Spotify" || typeof data.html !== "string") throw new Error("Invalid Spotify response");
      const id = /https:\/\/open\.spotify\.com\/embed\/track\/([a-zA-Z0-9]{22})(?=[\/?'"<\s]|&quot;|$)/.exec(data.html)?.[1];
      if (!id) throw new Error("Spotify song unavailable");
      return { provider: "spotify", url: `https://open.spotify.com/track/${id}` };
    } catch {
      throw new MemberError(400, "That Spotify share link could not open. Copy the link from the song and try it again.");
    } finally { clearTimeout(timeout); }
  }
}

export function songStores(context: Context): SongStores {
  const options = { name: "member-profile-songs", consistency: "strong" as const };
  return {
    songs: context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id }),
    profiles: profileStore(context), directory: communityDirectory(context), friends: friendStore(context),
  };
}
export function songsFailure(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Your music could not connect. Please try again." }, 503);
}
function readSong(value: any, id: string, slot: number): Song | null {
  if (!value || typeof value !== "object" || value.member_id !== id || value.slot !== slot ||
      !MEMBER_ID.test(value.revision) || !MEMBER_ID.test(value.request_id) || !HASH.test(value.input_digest) ||
      !["empty", "pending", "approved", "rejected"].includes(value.status) ||
      typeof value.name !== "string" || !value.name || value.name.length > 60 || BAD_TEXT.test(value.name) ||
      typeof value.policy_version !== "string" || typeof value.reason !== "string" || value.reason.length > 160 || BAD_TEXT.test(value.reason) ||
      typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) return null;
  const source: SongSource = value.source === "link" ? "link" : "upload";
  if (value.status === "empty") {
    if (value.title !== null || value.duration !== null || value.asset_id !== null || value.digest !== null || value.size !== null) return null;
  } else if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 100 || BAD_TEXT.test(value.title)) return null;
  if (value.status !== "empty" && source === "link") {
    let link: ReturnType<typeof parseMusicLink>;
    try { link = parseMusicLink(value.external_url); } catch { return null; }
    if (value.status !== "approved" || value.duration !== null || value.asset_id !== null || value.digest !== null || value.size !== null ||
        value.playback_digest !== undefined || value.playback_size !== undefined || !PROVIDERS.has(value.provider) ||
        link.provider !== value.provider || link.url !== value.external_url || value.policy_version !== MUSIC_LINK_POLICY_VERSION) return null;
  } else if (value.status !== "empty" && (!Number.isFinite(value.duration) || value.duration <= 0 || value.duration > MAX_MEMBER_SONG_SECONDS ||
      !HASH.test(value.asset_id) || !HASH.test(value.digest) || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_MEMBER_SONG_BYTES)) return null;
  if (source === "upload" && value.playback_digest !== undefined && (!HASH.test(value.playback_digest) || !Number.isSafeInteger(value.playback_size) || value.playback_size < 1 || value.playback_size > 18 * 1024 * 1024)) return null;
  return { ...value, source, provider: source === "link" ? value.provider : null, external_url: source === "link" ? value.external_url : null };
}
function projection(song: Song | null, slot: number) {
  return { slot, revision: song?.revision ?? null,
    status: song?.status === "approved" && !approved(song) ? "pending" : song?.status ?? "empty",
    title: song?.title ?? null, duration: song?.duration ?? null,
    source: song?.status === "empty" ? null : song?.source ?? null,
    provider: song?.source === "link" ? song.provider : null,
    external_url: song?.source === "link" ? song.external_url : null,
    url: approved(song) && song.source === "upload" ? audioURL(song) : null };
}
function responseFor(song: Song, isUpload = false, processingIssue?: 'review_unavailable' | 'preparation_failed' | 'needs_review') {
  const status = projection(song, song.slot).status;
  return memberJSON({ status, slot: projection(song, song.slot), ...(status === "pending" && processingIssue ? {processing_issue:processingIssue} : {}) }, status === "pending" ? 202 : status === "rejected" ? 422 : isUpload ? 201 : 200);
}
async function ownMember(stores: SongStores, options: Options, bind = false): Promise<ProfileMember> {
  const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
  const binding = await stores.profiles.get("owner-binding", { type: "json" });
  if (binding !== null && (!binding || !MEMBER_ID.test(binding.id))) throw new Error("Invalid owner binding");
  const bound = binding?.id ?? null;
  if ((bound === member.id && !member.isOwner) || (member.isOwner && bound && bound !== member.id)) {
    throw new MemberError(403, "This account cannot edit the site owner's profile.");
  }
  if (bind && member.isOwner && !bound) {
    await stores.profiles.setJSON("owner-binding", { id: member.id }, { onlyIfNew: true });
    const saved = await stores.profiles.get("owner-binding", { type: "json" });
    if (saved?.id !== member.id) throw new MemberError(403, "This account cannot edit the site owner's profile.");
  }
  return member;
}
async function current(stores: SongStores, id: string, slot: number) {
  const saved = await stores.songs.getWithMetadata(keyFor(id, slot), { type: "json" });
  const song = readSong(saved?.data, id, slot);
  return { saved, song };
}
async function publishedMember(req: Request, stores: SongStores, id: string): Promise<string | null> {
  const request = new Request(new URL(`/api/profile?id=${encodeURIComponent(id)}`, req.url));
  const response = await getPublicProfile(request, stores.profiles, { directory: stores.directory, friends: stores.friends });
  if (!response.ok) throw new MemberError(response.status === 503 ? 503 : 404, "This member's music is not available.");
  const { profile } = await response.json();
  if (MEMBER_ID.test(profile?.id)) return profile.id.toLowerCase();
  if (profile?.id === "owner") {
    const binding = await stores.profiles.get("owner-binding", { type: "json" });
    if (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id)) return null;
    const bound = binding.id.toLowerCase();
    return id === "owner" || id.toLowerCase() === bound ? bound : null;
  }
  return null;
}
export async function publishedSongSnapshot(req: Request, stores: SongStores, requestedId: string) {
  const memberId = await publishedMember(req, stores, requestedId);
  const slots = memberId ? await Promise.all([1, 2, 3].map(async slot => (await current(stores, memberId, slot)).song)) : [];
  return { memberId, songs: slots.filter(approved).map(song => projection(song, song.slot)) };
}
type FeaturedSong = { id:string; source_member_id:string; slot:number; revision:string; catalog_video_id?:string };
const featuredKey = (id:string) => `featured/${id}`;
function featuredRecords(value:any): FeaturedSong[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3 || value.some(item => !item || !MEMBER_ID.test(item.id)
    || !(MEMBER_ID.test(item.source_member_id) || item.source_member_id === 'owner')
    || !Number.isSafeInteger(item.slot) || item.slot < 1 || (!item.catalog_video_id && item.slot > 3)
    || (item.catalog_video_id ? typeof item.catalog_video_id !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(item.catalog_video_id)
      || item.revision !== `catalog:${item.catalog_video_id}` || item.source_member_id !== 'owner' : !MEMBER_ID.test(item.revision)))
    || new Set(value.map(item => item.id)).size !== value.length) throw new Error('Invalid featured music');
  return value;
}
async function resolveFeaturedSong(req:Request, stores:SongStores, item:FeaturedSong) {
  try {
    if (item.catalog_video_id) {
      await publishedMember(req, stores, 'owner');
      return ownerCatalogSongs().find(song => song.catalog_video_id === item.catalog_video_id) || null;
    }
    const snapshot = await publishedSongSnapshot(req, stores, item.source_member_id);
    const song = snapshot.songs.find(song => song.slot === item.slot && song.revision === item.revision);
    if (!song || snapshot.memberId !== item.source_member_id) return null;
    const response = await getPublicProfile(new Request(new URL(`/api/profile?id=${item.source_member_id}`, req.url)), stores.profiles, {directory:stores.directory,friends:stores.friends});
    if (!response.ok) return null;
    const {profile} = await response.json();
    return {...song, origin:{member_id:item.source_member_id,name:profile.name,slot:item.slot,revision:item.revision}};
  } catch (error) {
    if (error instanceof MemberError && error.status === 404) return null;
    throw error;
  }
}
async function ownFeaturedSongs(req:Request, stores:SongStores, memberId:string) {
  const records = featuredRecords(await stores.songs.get(featuredKey(memberId), {type:'json'}));
  return Promise.all(records.map(async item => ({id:item.id, song:await resolveFeaturedSong(req, stores, item)})));
}
export async function manageFeaturedSongs(req:Request, stores:SongStores, options:Options = {}):Promise<Response> {
  if (!['GET','POST','DELETE'].includes(req.method)) return memberJSON({error:'Method not allowed.'},405);
  try {
    assertSameOrigin(req);
    const member = await ownMember(stores, options);
    if (req.method === 'GET') return memberJSON({user:{id:member.id},featured:await ownFeaturedSongs(req,stores,member.id),max_featured:3});
    if (await publishedMember(req,stores,member.id) !== member.id) throw new MemberError(400,'Save your profile once before adding music.');
    if (!(req.headers.get('content-type') || '').startsWith('application/json')) throw new MemberError(415,'Use the profile music controls.');
    const text = await req.text(); if (text.length > 2048) throw new MemberError(413,'This music update is too large.');
    let body:any; try { body = JSON.parse(text); } catch { throw new MemberError(400,'Choose a song to feature.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MemberError(400,'Choose a song to feature.');
    let reference:FeaturedSong | null = null;
    if (req.method === 'POST') {
      if (Object.keys(body).sort().join(',') === 'catalog_video_id') {
        const song = ownerCatalogSongs().find(song => song.catalog_video_id === body.catalog_video_id);
        if (!song) throw new MemberError(404,'This song is no longer available.');
        reference = {id:randomUUID(),source_member_id:'owner',slot:song.slot,revision:song.revision,catalog_video_id:song.catalog_video_id};
      } else {
        if (Object.keys(body).sort().join(',') !== 'revision,slot,source_member_id' || !MEMBER_ID.test(body.source_member_id)
          || ![1,2,3].includes(body.slot) || !MEMBER_ID.test(body.revision)) throw new MemberError(400,'Choose an available song on a member’s profile.');
        if (body.source_member_id.toLowerCase() === member.id) throw new MemberError(400,'Your own song is already in your Profile Music.');
        reference = {id:randomUUID(),source_member_id:body.source_member_id.toLowerCase(),slot:body.slot,revision:body.revision.toLowerCase()};
      }
      if (!await resolveFeaturedSong(req,stores,reference)) throw new MemberError(404,'This song changed or is no longer available.');
    } else if (Object.keys(body).join(',') !== 'feature_id' || !MEMBER_ID.test(body.feature_id)) throw new MemberError(400,'Choose a featured song to remove.');
    for (let attempt = 0; attempt < 5; attempt++) {
      const saved = await stores.songs.getWithMetadata(featuredKey(member.id),{type:'json'});
      const records = featuredRecords(saved?.data);
      if (reference && records.some(item => item.source_member_id === reference!.source_member_id && item.slot === reference!.slot && item.revision === reference!.revision)) {
        return memberJSON({status:'featured',featured:await ownFeaturedSongs(req,stores,member.id)});
      }
      if (reference && records.length >= 3) throw new MemberError(409,'You have 3 featured songs. Remove one in Profile Music settings, then add this song.');
      const updated = reference ? [...records,reference] : records.filter(item => item.id !== body.feature_id);
      const written = await stores.songs.setJSON(featuredKey(member.id),updated,saved ? {onlyIfMatch:saved.etag} : {onlyIfNew:true});
      if (written.modified) return memberJSON({status:reference?'featured':'removed',featured:await ownFeaturedSongs(req,stores,member.id)},reference?201:200);
    }
    throw new MemberError(409,'Your featured music changed. Try again.');
  } catch (error) { return songsFailure(error); }
}
export async function getOwnSongs(req: Request, stores: SongStores, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await ownMember(stores, options);
    const slots = await Promise.all([1, 2, 3].map(async slot => projection((await current(stores, member.id, slot)).song, slot)));
    const featured = await ownFeaturedSongs(req, stores, member.id);
    return memberJSON({ slots, max_songs: 3, featured, user: { id: member.id } });
  } catch (error) { return songsFailure(error); }
}
export async function getMemberSongs(req: Request, stores: SongStores): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const values = new URL(req.url).searchParams.getAll("id");
    if (values.length !== 1 || (values[0] !== "owner" && !MEMBER_ID.test(values[0]))) throw new MemberError(400, "Choose a valid profile.");
    const snapshot = await publishedSongSnapshot(req, stores, values[0]);
    const binding = await stores.profiles.get('owner-binding', {type:'json'});
    const isOwner = values[0] === 'owner' || (snapshot.memberId && binding?.id === snapshot.memberId);
    const featured = snapshot.memberId ? await ownFeaturedSongs(req, stores, snapshot.memberId) : [];
    return memberJSON({ songs: snapshot.songs, max_songs: 3, member_id: snapshot.memberId,
      catalog_songs: isOwner ? ownerCatalogSongs() : [], featured_songs: featured.filter(item => item.song).map(item => ({...item.song, feature_id:item.id})) });
  } catch (error) { return songsFailure(error); }
}
async function bodyBytes(req: Request, limit: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length") || 0) > limit) throw new MemberError(413, "Choose an MP3 up to 100 MB. For larger files, refresh the page to use the updated uploader.");
  if (!req.body) throw new MemberError(400, "Your music update could not be read.");
  const reader = req.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new MemberError(413, "Choose an MP3 up to 100 MB. For larger files, refresh the page to use the updated uploader."); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
function fields(input: any, needsRequest = true) {
  const slot = typeof input.slot === "string" && /^[1-3]$/.test(input.slot) ? Number(input.slot) : input.slot;
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new MemberError(400, "Choose one of your three song slots.");
  if (needsRequest && (typeof input.request_id !== "string" || !MEMBER_ID.test(input.request_id))) throw new MemberError(400, "Refresh your music editor and try again.");
  const revision = input.revision === "" || input.revision === null ? null : input.revision;
  if (revision !== null && (typeof revision !== "string" || !MEMBER_ID.test(revision))) throw new MemberError(400, "Refresh your music editor and try again.");
  return { slot, revision, requestId: needsRequest ? input.request_id.toLowerCase() : "" };
}
async function jsonBody(req: Request): Promise<any> {
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new MemberError(415, "Use your music editor to update songs.");
  try { const value = JSON.parse(new TextDecoder().decode(await bodyBytes(req, 4000))); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch (error) { if (error instanceof MemberError) throw error; throw new MemberError(400, "Your music update could not be read."); }
}
async function reserve(stores: SongStores, member: ProfileMember, input: { slot: number; revision: string | null; requestId: string }, kind: "upload" | "link" | "delete", digest: string) {
  const state = await current(stores, member.id, input.slot);
  const opKey = `operations/${member.id}/${input.requestId}`;
  const existing = await stores.songs.get(opKey, { type: "json" });
  if (existing && (existing.member_id !== member.id || !MEMBER_ID.test(existing.revision) || existing.kind !== kind || existing.slot !== input.slot || existing.input_digest !== digest || existing.base_revision !== input.revision)) {
    throw new MemberError(409, "This request was already used. Start a new music update.");
  }
  if (existing && state.song?.revision === existing.revision && state.song.input_digest === digest) return { ...state, op: existing, repeated: true };
  if ((state.song?.revision ?? null) !== input.revision) throw new MemberError(409, "This song changed in another window. Refresh before saving again.");
  const candidate = { member_id: member.id, kind, slot: input.slot, revision: randomUUID(), input_digest: digest, base_revision: input.revision, base_etag: state.saved?.etag ?? null };
  const inserted = await stores.songs.setJSON(opKey, candidate, { onlyIfNew: true });
  const op = inserted.modified ? candidate : await stores.songs.get(opKey, { type: "json" });
  if (!op || op.member_id !== member.id || op.kind !== kind || op.slot !== input.slot || op.input_digest !== digest ||
      op.base_revision !== input.revision || !MEMBER_ID.test(op.revision) || op.base_etag !== (state.saved?.etag ?? null)) {
    throw new MemberError(409, "This song changed in another window. Refresh before saving again.");
  }
  return { ...state, op, repeated: false };
}
async function saveSlot(stores: SongStores, song: Song, etag: string | null): Promise<Song> {
  const write = await stores.songs.setJSON(keyFor(song.member_id, song.slot), song, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
  if (write.modified) return song;
  const winning = (await current(stores, song.member_id, song.slot)).song;
  if (winning?.revision === song.revision && winning.input_digest === song.input_digest) return winning;
  throw new MemberError(409, "This song changed in another window. Refresh before saving again.");
}
export async function uploadMemberSong(req: Request, stores: SongStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await ownMember(stores, options);
    try { if (await publishedMember(req, stores, member.id) !== member.id) throw new MemberError(404, "Profile not found."); }
    catch (error) { if (error instanceof MemberError && error.status === 404) throw new MemberError(400, "Save your profile once before adding a song."); throw error; }
    const contentType = req.headers.get("content-type") || "";
    let input: Record<string, any> = {};
    if (contentType.split(";",1)[0].trim().toLowerCase() === "application/json") {
      input = await jsonBody(req);
      input.audio = await readAudioUpload(options.transfers, member.id, input.upload_id, "profile");
    } else {
      if (contentType.split(";",1)[0].trim().toLowerCase() !== "multipart/form-data") throw new MemberError(415, "Use your music editor to upload an MP3.");
      let form: FormData;
      try { form = await new Response(await bodyBytes(req, MAX_BODY), { headers: { "Content-Type": contentType } }).formData(); }
      catch (error) { if (error instanceof MemberError) throw error; throw new MemberError(400, "Your song upload could not be read."); }
      for (const name of ["slot", "title", "request_id", "revision", "audio"]) {
        const entries = form.getAll(name); if (entries.length !== 1) throw new MemberError(400, "Upload one song at a time."); input[name] = entries[0];
      }
    }
    const update = fields(input), title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 100 || BAD_TEXT.test(input.title)) throw new MemberError(400, "Your song title needs 1 to 100 characters.");
    if (!(input.audio instanceof File) || !input.audio.size || input.audio.size > MAX_MEMBER_SONG_BYTES) throw new MemberError(413, "Choose an MP3 up to 100 MB. For larger files, refresh the page to use the updated uploader.");
    const source = await input.audio.arrayBuffer(); let audio: ReturnType<typeof validateMemberSongAudio>;
    try { audio = validateMemberSongAudio(source, input.audio.type); }
    catch (error) { throw new MemberError(415, error instanceof Error ? error.message : "Choose a valid MP3 up to 10 minutes."); }
    const inputDigest = sha(JSON.stringify([update.slot, update.revision, title, sha(new Uint8Array(source))]));
    const state = await reserve(stores, member, update, "upload", inputDigest);
    if (state.repeated) return responseFor(state.song!);
    await ownMember(stores, { resolveMember: async () => member }, true);
    const digest = sha(new Uint8Array(audio.bytes)), assetId = sha(`${member.id}:${update.slot}:${state.op.revision}:${digest}`);
    const song: Song = { member_id: member.id, slot: update.slot, revision: state.op.revision, status: "pending", title, duration: audio.duration,
      asset_id: assetId, digest, size: audio.bytes.byteLength, name: member.name, request_id: update.requestId, input_digest: inputDigest,
      source: "upload", provider: null, external_url: null,
      created_at: new Date().toISOString(), policy_version: SONG_MODERATION_POLICY_VERSION, reason: "Waiting for the song safety check." };
    const write = await stores.songs.set(blobKey(song), audio.bytes, { onlyIfNew: true });
    if (!write.modified) { const saved = await stores.songs.get(blobKey(song), { type: "arrayBuffer" }); if (!saved || sha(new Uint8Array(saved)) !== digest) throw new Error("Invalid saved song bytes"); }
    return responseFor(await saveSlot(stores, song, state.op.base_etag), true);
  } catch (error) { return songsFailure(error); }
}
export async function saveMemberSongLink(req: Request, stores: SongStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await ownMember(stores, options);
    try { if (await publishedMember(req, stores, member.id) !== member.id) throw new MemberError(404, "Profile not found."); }
    catch (error) { if (error instanceof MemberError && error.status === 404) throw new MemberError(400, "Save your profile once before adding a song."); throw error; }
    const body = await jsonBody(req), update = fields(body);
    const title = typeof body.title === "string" ? body.title.trim().replace(/\s+/g, " ") : "";
    if (!title || title.length > 100 || BAD_TEXT.test(body.title)) throw new MemberError(400, "Your song title needs 1 to 100 characters.");
    const link = await resolveMusicLink(body.url, options.fetchMusic ?? fetch);
    const inputDigest = sha(JSON.stringify([update.slot, update.revision, title, link.provider, link.url]));
    const state = await reserve(stores, member, update, "link", inputDigest);
    if (state.repeated) return responseFor(state.song!);
    await ownMember(stores, { resolveMember: async () => member }, true);
    const song: Song = { member_id: member.id, slot: update.slot, revision: state.op.revision, status: "approved", title, duration: null,
      asset_id: null, digest: null, size: null, source: "link", provider: link.provider, external_url: link.url,
      name: member.name, request_id: update.requestId, input_digest: inputDigest, created_at: new Date().toISOString(),
      policy_version: MUSIC_LINK_POLICY_VERSION, reason: "Shared from a supported music service." };
    return responseFor(await saveSlot(stores, song, state.op.base_etag), true);
  } catch (error) { return songsFailure(error); }
}
export async function deleteMemberSong(req: Request, stores: SongStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await ownMember(stores, options), update = fields(await jsonBody(req));
    const digest = sha(JSON.stringify(["delete", update.slot, update.revision]));
    const state = await reserve(stores, member, update, "delete", digest);
    if (state.repeated) return memberJSON({ status: "deleted", slot: projection(state.song, update.slot) });
    await ownMember(stores, { resolveMember: async () => member }, true);
    const song: Song = { member_id: member.id, slot: update.slot, revision: state.op.revision, status: "empty", title: null, duration: null, asset_id: null, digest: null, size: null,
      source: "upload", provider: null, external_url: null,
      name: member.name, request_id: update.requestId, input_digest: digest, created_at: new Date().toISOString(), policy_version: SONG_MODERATION_POLICY_VERSION, reason: "Removed by the member." };
    const saved = await saveSlot(stores, song, state.op.base_etag);
    return memberJSON({ status: "deleted", slot: projection(saved, update.slot) });
  } catch (error) { return songsFailure(error); }
}
function validDecision(value: any) {
  return !!value && ["pending", "approved", "rejected"].includes(value.status) && value.policy_version === SONG_MODERATION_POLICY_VERSION &&
    typeof value.reason === "string" && !!value.reason.trim() && value.reason.length <= 160 && !BAD_TEXT.test(value.reason);
}
export async function checkMemberSong(req: Request, stores: SongStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req); const member = await ownMember(stores, options), input = fields(await jsonBody(req), false);
    const state = await current(stores, member.id, input.slot), song = state.song;
    if (!song || song.revision !== input.revision || song.status === "empty") throw new MemberError(409, "This song changed. Refresh your music editor.");
    if (approved(song) || (song.status === "rejected" && song.policy_version === SONG_MODERATION_POLICY_VERSION)) return responseFor(song);
    const bytes = await stores.songs.get(blobKey(song), { type: "arrayBuffer" });
    if (!bytes || bytes.byteLength !== song.size || sha(new Uint8Array(bytes)) !== song.digest) throw new Error("Invalid saved audio");
    let decision: any;
    try { decision = await (options.moderate ?? moderateSong)({ bytes, mime: "audio/mpeg", name: song.name, caption: song.title!, duration: song.duration! }); }
    catch { decision = null; }
    if (!validDecision(decision) || decision.status === "pending") {
      const latest = (await current(stores, member.id, input.slot)).song;
      if (!latest || latest.revision !== input.revision) throw new MemberError(409, "This song changed. Refresh your music editor.");
      const issue = !validDecision(decision) || ['moderation_unavailable','moderation_timeout'].includes(decision.reason)
        ? 'review_unavailable' : decision.reason === 'audio_preparation_failed' ? 'preparation_failed' : 'needs_review';
      return responseFor(latest, false, issue);
    }
    const checked: Song = { ...song, status: decision.status, policy_version: SONG_MODERATION_POLICY_VERSION, reason: decision.reason };
    if (decision.status === 'approved' && bytes.byteLength > 18 * 1024 * 1024) {
      try {
        const prepare = options.preparePlayback ?? (await import('./media-normalize.mts')).prepareSongPlayback;
        const playback = await prepare(bytes);
        const verified = validateMemberSongAudio(playback, 'audio/mpeg');
        if (playback.byteLength > 18 * 1024 * 1024 || Math.abs(verified.duration - song.duration!) > 0.35) throw new Error('Invalid playback copy');
        checked.playback_digest = sha(new Uint8Array(playback));
        checked.playback_size = playback.byteLength;
        await stores.songs.set(`playback/${song.member_id}/${song.slot}/${song.asset_id}`, playback, {onlyIfNew:true});
        const savedPlayback=await stores.songs.get(`playback/${song.member_id}/${song.slot}/${song.asset_id}`,{type:'arrayBuffer'});
        if (!(savedPlayback instanceof ArrayBuffer) || sha(new Uint8Array(savedPlayback)) !== checked.playback_digest) throw new Error('Playback copy not confirmed');
      } catch { return responseFor(song, false, "preparation_failed"); }
    }
    return responseFor(await saveSlot(stores, checked, state.saved!.etag));
  } catch (error) { return songsFailure(error); }
}
function audioHeaders(response: Response): Response {
  for (const [key, value] of Object.entries({ "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store", "CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer" })) response.headers.set(key, value);
  return response;
}
export async function getMemberSongAudio(req: Request, stores: SongStores): Promise<Response> {
  if (req.method !== "GET") return audioHeaders(memberJSON({ error: "Method not allowed." }, 405));
  try {
    const match = /^\/api\/member-song-audio\/([a-f0-9-]+)\/([1-3])\/([a-f0-9]{64})$/.exec(new URL(req.url).pathname);
    if (!match || !MEMBER_ID.test(match[1])) throw new MemberError(404, "Song not found.");
    const [, id, slotText, asset] = match, slot = Number(slotText);
    await publishedMember(req, stores, id);
    const song = (await current(stores, id, slot)).song;
    if (!approved(song) || song.asset_id !== asset) throw new MemberError(404, "Song not found.");
    const bytes = await stores.songs.get(song.playback_digest ? `playback/${song.member_id}/${song.slot}/${song.asset_id}` : blobKey(song), { type: "arrayBuffer" });
    if (!bytes || bytes.byteLength !== (song.playback_size ?? song.size) || sha(new Uint8Array(bytes)) !== (song.playback_digest ?? song.digest)) throw new MemberError(404, "Song not found.");
    // Deletion/replacement while a blob is loading must revoke this response.
    const latest = (await current(stores, id, slot)).song;
    if (!approved(latest) || latest.asset_id !== asset || latest.revision !== song.revision || latest.digest !== song.digest) throw new MemberError(404, "Song not found.");
    const headers = new Headers({ "Content-Type": "audio/mpeg", "Content-Disposition": 'inline; filename="member-song.mp3"', "Accept-Ranges": "bytes", "Content-Length": String(bytes.byteLength) });
    const range = req.headers.get("range"); let start = 0, end = bytes.byteLength - 1;
    if (range) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(range.trim()); let valid = !!parsed && !!(parsed[1] || parsed[2]);
      if (valid && parsed) {
        if (!parsed[1]) { const count = Number(parsed[2]); valid = Number.isSafeInteger(count) && count > 0; start = Math.max(0, bytes.byteLength - count); }
        else { start = Number(parsed[1]); const requestedEnd = parsed[2] ? Number(parsed[2]) : end; valid = Number.isSafeInteger(start) && Number.isSafeInteger(requestedEnd) && start < bytes.byteLength && requestedEnd >= start; end = Math.min(end, requestedEnd); }
      }
      if (!valid) return audioHeaders(new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } }));
      end = Math.min(end, start + 2 * 1024 * 1024 - 1);
      headers.set("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`); headers.set("Content-Length", String(end - start + 1));
    }
    return audioHeaders(new Response(range ? bytes.slice(start, end + 1) : new Blob([bytes]).stream(), { status: range ? 206 : 200, headers }));
  } catch (error) { return audioHeaders(songsFailure(error)); }
}
