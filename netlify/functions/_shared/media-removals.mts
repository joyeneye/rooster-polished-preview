// Removing photos and videos, from one place.
//
// Members remove their own pictures and videos. The site owner can also take
// down anything that does not belong on ROOSTER. Every removal takes the item
// off the member's profile, the photo gallery, the wall and the video section
// straight away and keeps it off after a refresh, because the record that
// publishes it is deleted, not hidden. The file itself is kept for a few
// seconds behind a removal record so Undo can put it back, then deleted.
import type { Context } from "@netlify/functions";
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { profileStore, type ProfileMember, type ProfileStore } from "./member-profiles.mts";
import {
  albumStore, listAlbumPhotos, listAlbumTrash, presentAlbumPhoto, purgeAlbumPhoto,
  readAlbumCaption, removeAlbumPhoto, restoreAlbumPhoto, MAX_ALBUM_PHOTOS,
} from "./member-albums.mts";
import {
  clipsStore, findClipRecord, isSiteOwner, listClipTrash, listMemberClips,
  purgeClip, removeClip, restoreClip, type ClipsStore,
} from "./member-clips.mts";
import { boundedBytes } from "./video-transfers.mts";
import { MAX_MEDIA_BATCH, MEDIA_UNDO_MS, MEDIA_UNDO_SECONDS } from "./media-undo.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";

export type MediaStores = { album: any; clips: ClipsStore; profiles: ProfileStore };
type Options = { resolveMember?: () => Promise<ProfileMember> };
type Actor = ProfileMember & { isAdmin: boolean };
type Item = { kind: "photo" | "video"; id: string; member_id: string | null };
const HASH = /^[a-f0-9]{64}$/;
// The page hides Undo after undo_seconds, then clears the file once the
// server will accept it. Anything whose page closed first is swept hourly.
const PURGE_AFTER_SECONDS = Math.ceil(MEDIA_UNDO_MS / 1000) + 1;

export function mediaStores(context: Context): MediaStores {
  return { album: albumStore(context), clips: clipsStore(context), profiles: profileStore(context) };
}
export function mediaFailure(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Your photos and videos could not connect. Please try again in a moment." }, 503);
}
async function actor(stores: MediaStores, options: Options): Promise<Actor> {
  const member = await (options.resolveMember ?? resolveCommunityProfileMember)();
  // Only the account bound to this site as its owner can remove other
  // people's content. Everybody else is limited to their own uploads.
  return { ...member, isAdmin: await isSiteOwner(member, stores.profiles) };
}
async function body(req: Request): Promise<any> {
  if (!(req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase().startsWith("application/json")) {
    throw new MemberError(415, "Your request could not be read. Refresh the page and try again.");
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(await boundedBytes(req, 8192)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof MemberError) throw error;
    throw new MemberError(400, "Your request could not be read. Refresh the page and try again.");
  }
}
function items(value: any): Item[] {
  const supplied = Array.isArray(value?.items) ? value.items : null;
  if (!supplied || !supplied.length) throw new MemberError(400, "Choose a photo or video first.");
  if (supplied.length > MAX_MEDIA_BATCH) throw new MemberError(400, `Choose up to ${MAX_MEDIA_BATCH} photos or videos at a time.`);
  const chosen = new Map<string, Item>();
  for (const entry of supplied) {
    if (!entry || typeof entry !== "object" || (entry.kind !== "photo" && entry.kind !== "video") || typeof entry.id !== "string" || !HASH.test(entry.id)) {
      throw new MemberError(400, "Choose a photo or video from this page.");
    }
    if (entry.member_id !== undefined && entry.member_id !== null && (typeof entry.member_id !== "string" || !MEMBER_ID.test(entry.member_id))) {
      throw new MemberError(400, "Choose a photo or video from this page.");
    }
    const member = typeof entry.member_id === "string" ? entry.member_id.toLowerCase() : null;
    chosen.set(`${entry.kind}:${entry.id}:${member ?? ""}`, { kind: entry.kind, id: entry.id, member_id: member });
  }
  return [...chosen.values()];
}
function report(done: unknown[], failed: { status: number }[], extra: Record<string, unknown> = {}): Response {
  const problems = failed.map(({ status, ...rest }) => rest);
  // Nothing done and a single reason: answer with that reason's own status so
  // a refused removal reads as refused, not as a success with a note.
  const status = !done.length && failed.length ? failed[0].status : 200;
  return memberJSON({ ...extra, failed: problems, undo_seconds: MEDIA_UNDO_SECONDS, purge_after_seconds: PURGE_AFTER_SECONDS }, status);
}
function trouble(error: unknown, item: Item, fallback: string) {
  return { kind: item.kind, id: item.id, error: error instanceof MemberError ? error.message : fallback, status: error instanceof MemberError ? error.status : 503 };
}
function allowed(person: Actor, ownerId: string, kind: Item["kind"]): void {
  if (ownerId === person.id || person.isAdmin) return;
  throw new MemberError(403, kind === "photo" ? "You can only remove your own photos." : "You can only remove your own videos.");
}

/** Everything the signed-in member may remove, for the Manage Media list. The
 * owner can pass a member id to review and take down somebody else's uploads. */
export async function manageMedia(req: Request, stores: MediaStores, options: Options = {}): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const person = await actor(stores, options);
    const requested = new URL(req.url).searchParams.get("member");
    if (requested !== null && !MEMBER_ID.test(requested)) throw new MemberError(400, "Choose a member to manage.");
    const target = requested ? requested.toLowerCase() : person.id;
    if (target !== person.id && !person.isAdmin) throw new MemberError(403, "You can only manage your own photos and videos.");
    const stored = await listAlbumPhotos(stores.album, target);
    const photos = await Promise.all(stored.map(async (photo: any) => ({
      ...presentAlbumPhoto(photo, await readAlbumCaption(stores.album, target, photo.id)), kind: "photo" as const, member_id: target,
    })));
    const videos = await listMemberClips(stores.clips, target);
    return memberJSON({ member_id: target, is_admin: person.isAdmin, viewer_id: person.id,
      photo_limit: MAX_ALBUM_PHOTOS, undo_seconds: MEDIA_UNDO_SECONDS, purge_after_seconds: PURGE_AFTER_SECONDS, photos, videos });
  } catch (error) { return mediaFailure(error); }
}

/** Removes one item or a whole selection. Each item is judged on its own, so
 * one refusal never stops the rest of the selection. */
export async function removeMedia(req: Request, stores: MediaStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const person = await actor(stores, options);
    const chosen = items(await body(req));
    const removed: unknown[] = []; const failed: any[] = [];
    for (const item of chosen) {
      try {
        if (item.kind === "photo") {
          const target = item.member_id ?? person.id;
          allowed(person, target, "photo");
          removed.push(await removeAlbumPhoto(stores.album, target, item.id, person.id));
        } else {
          const clip = await findClipRecord(stores.clips, item.id);
          if (!clip) throw new MemberError(404, "This video is no longer available.");
          allowed(person, clip.member_id, "video");
          removed.push(await removeClip(stores.clips, clip, person.id));
        }
      } catch (error) { failed.push(trouble(error, item, "This item could not be removed. Please try again.")); }
    }
    return report(removed, failed, { removed });
  } catch (error) { return mediaFailure(error); }
}

/** Undo. Puts the chosen items back where they were. */
export async function restoreMedia(req: Request, stores: MediaStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const person = await actor(stores, options);
    const chosen = items(await body(req));
    const restored: unknown[] = []; const failed: any[] = [];
    for (const item of chosen) {
      try {
        if (item.kind === "photo") {
          const target = item.member_id ?? person.id;
          allowed(person, target, "photo");
          restored.push({ kind: "photo", id: item.id, member_id: target, photo: await restoreAlbumPhoto(stores.album, target, item.id) });
        } else {
          const clip = await findClipRecord(stores.clips, item.id);
          if (!clip) throw new MemberError(404, "This video can no longer be brought back.");
          allowed(person, clip.member_id, "video");
          restored.push({ kind: "video", id: item.id, member_id: clip.member_id, video: await restoreClip(stores.clips, item.id) });
        }
      } catch (error) { failed.push(trouble(error, item, "This item could not be brought back. Please try again.")); }
    }
    return report(restored, failed, { restored });
  } catch (error) { return mediaFailure(error); }
}

/** Called once the Undo offer has gone, so the file leaves storage without
 * waiting for the hourly cleanup. Items still inside the window are left. */
export async function purgeRemovedMedia(req: Request, stores: MediaStores, options: Options = {}): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const person = await actor(stores, options);
    const chosen = items(await body(req));
    let purged = 0; const failed: any[] = [];
    for (const item of chosen) {
      try {
        if (item.kind === "photo") {
          const target = item.member_id ?? person.id;
          allowed(person, target, "photo");
          if (await purgeAlbumPhoto(stores.album, target, item.id)) purged++;
        } else {
          allowed(person, (await findClipRecord(stores.clips, item.id))?.member_id ?? person.id, "video");
          if (await purgeClip(stores.clips, item.id)) purged++;
        }
      } catch (error) { failed.push(trouble(error, item, "This item could not be cleared. It will be cleared automatically.")); }
    }
    return report(purged ? [purged] : [], failed, { purged });
  } catch (error) { return mediaFailure(error); }
}

/** The scheduled sweep. Anything whose undo window has passed leaves storage
 * here, including removals whose browser closed before it could confirm. */
export async function purgeExpiredMedia(stores: MediaStores): Promise<{ photos: number; videos: number }> {
  let photos = 0; let videos = 0;
  for (const entry of await listAlbumTrash(stores.album)) {
    if (await purgeAlbumPhoto(stores.album, entry.member_id, entry.photo_id)) photos++;
  }
  for (const entry of await listClipTrash(stores.clips)) {
    if (await purgeClip(stores.clips, entry.clip_id)) videos++;
  }
  return { photos, videos };
}
