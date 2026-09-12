import { createHash, randomUUID } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { moderateComment, POLICY_VERSION, type ModerationDecision } from "./comment-moderation.mts";
import { MEMBER_ID } from "./member-auth.mts";

import { identityReader, profileLink, type IdentityDependencies } from "./wall-identity.mts";
import { resolveCommunityProfileMember } from "./roster-access.mts";

export type Comment = {
  id: string;
  name: string;
  message: string;
  published_at: string;
  /** The member this comment belongs to, or null for an older unattached post. */
  author_id: string | null;
  photo_url: string | null;
  verified: boolean;
  verified_owner: boolean;
  profile_url: string | null;
};

type StoredComment = {
  id: string;
  name: string;
  message: string;
  created_at: string;
  published_at?: string;
  author_id?: string;
  author_is_owner?: boolean;
  moderation: ModerationDecision;
};

export type MainWallDependencies = IdentityDependencies & {
  resolveMember?: () => Promise<{ id: string; isOwner?: boolean }>;
};

/** The signed-in member, when there is one. The wall still takes comments from
 * visitors who are not logged in; those stay unattached to any profile. */
async function signedInAuthor(dependencies?: MainWallDependencies): Promise<{ id: string; isOwner: boolean } | null> {
  if (!dependencies?.profiles) return null;
  try {
    const member = await (dependencies.resolveMember ?? resolveCommunityProfileMember)();
    if (!member || typeof member.id !== "string" || !MEMBER_ID.test(member.id)) return null;
    return { id: member.id.toLowerCase(), isOwner: member.isOwner === true };
  } catch {
    return null;
  }
}

/** Replaces the stored name with the member's current name, picture and badge.
 * The join is by member ID only, so a comment with no member ID keeps its
 * stored name and never borrows another member's profile. */
async function withIdentity(comment: Comment, lookup: (id: unknown) => Promise<any>): Promise<Comment> {
  if (!comment.author_id) return comment;
  const identity = await lookup(comment.author_id);
  if (!identity) return comment;
  const name = identity.name.trim();
  return {
    ...comment,
    name: name.length >= 2 && name.length <= 60 ? name : comment.name,
    photo_url: identity.photo_url,
    verified: identity.verified,
    verified_owner: identity.verified_owner,
    profile_url: identity.profile_url,
  };
}

type Moderator = (input: { name: string; message: string }) => Promise<ModerationDecision>;

async function reviewComment(input: { name: string; message: string }, moderator: Moderator): Promise<ModerationDecision> {
  try {
    const moderation = await moderator(input);
    if (!moderation || moderation.policy_version !== POLICY_VERSION ||
        !["approved", "rejected", "pending"].includes(moderation.status) ||
        typeof moderation.reason !== "string" || typeof moderation.checked_at !== "string" ||
        !Number.isFinite(Date.parse(moderation.checked_at))) throw new Error("Invalid moderation decision");
    return moderation;
  } catch {
    return { status: "pending", reason: "moderation_unavailable", policy_version: POLICY_VERSION, checked_at: new Date().toISOString() };
  }
}

export interface WallStore {
  list(options: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
  get(key: string, options: { type: "json" }): Promise<unknown>;
  setJSON(key: string, value: StoredComment, options: { onlyIfNew: true }): Promise<{ modified: boolean }>;
}

export function storageScope(context: Pick<Context, "deploy">): "site" | "deploy" {
  return context.deploy.context === "production" ? "site" : "deploy";
}

export function commentStore(context: Context): WallStore {
  const options = { name: "comment-wall-live", consistency: "strong" as const };
  return storageScope(context) === "site"
    ? getStore(options)
    : getDeployStore({ ...options, deployID: context.deploy.id });
}

export function originalComments(): Comment[] {
  // Existing visitor submissions, retained when the old review queue was replaced.
  // These predate member accounts, so they carry no member ID. They keep their
  // name and show initials rather than being guessed onto somebody's profile.
  const unattached = { author_id: null, photo_url: null, verified: false, verified_owner: false, profile_url: null };
  return [
    {
      id: "6a9bca7dc15e69bfede3d3ca",
      name: "JWhite",
      message: "More hits on the way!!",
      published_at: "2026-09-05T07:53:33.893Z",
      ...unattached,
    },
    {
      id: "6a9bc9c5c27a3ebf75324226",
      name: "Kubla",
      message: "I know they’re definitely not getting skipped! 😤",
      published_at: "2026-09-05T07:50:29.771Z",
      ...unattached,
    },
  ];
}

function responseHeaders(contentType = "application/json; charset=utf-8"): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Netlify-CDN-Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders() });
}

class WallError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(error: unknown, isForm = false): Response {
  const status = error instanceof WallError ? error.status : 503;
  const message = error instanceof WallError
    ? error.message
    : "The wall is having trouble connecting. Please try again in a moment.";
  return isForm
    ? new Response(`${message}\n\nUse your browser’s Back button to return to your comment.`, {
        status,
        headers: responseHeaders("text/plain; charset=utf-8"),
      })
    : json({ error: message }, status);
}

function isApproved(record: Record<string, unknown>): boolean {
  const moderation = record.moderation as Partial<ModerationDecision> | undefined;
  return moderation?.status === "approved" && moderation.policy_version === POLICY_VERSION;
}

function publicComment(value: unknown): Comment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isApproved(record)) return null;
  if (
    typeof record.id !== "string" || record.id.length > 128 ||
    typeof record.name !== "string" || record.name.length < 2 || record.name.length > 60 ||
    typeof record.message !== "string" || record.message.length < 2 || record.message.length > 1000 ||
    typeof record.published_at !== "string" || !Number.isFinite(Date.parse(record.published_at))
  ) return null;
  const authorId = typeof record.author_id === "string" && MEMBER_ID.test(record.author_id)
    ? record.author_id.toLowerCase()
    : null;
  const isOwner = authorId !== null && record.author_is_owner === true;
  // Whitelist public fields even if a future stored record gains private data.
  return {
    id: record.id,
    name: record.name,
    message: record.message,
    published_at: new Date(record.published_at).toISOString(),
    author_id: authorId,
    photo_url: null,
    verified: isOwner,
    verified_owner: isOwner,
    profile_url: authorId ? profileLink(authorId, isOwner) : null,
  };
}

export async function getComments(req: Request, store: WallStore, dependencies?: MainWallDependencies): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  try {
    const { blobs } = await store.list({ prefix: "comments/" });
    const comments = new Map(originalComments().map(comment => [comment.id, comment]));
    // Bound parallel reads so a larger wall does not open one connection per post.
    for (let offset = 0; offset < blobs.length; offset += 12) {
      const page = await Promise.all(blobs.slice(offset, offset + 12).map(blob =>
        store.get(blob.key, { type: "json" })
      ));
      for (const value of page) {
        const comment = publicComment(value);
        if (comment) comments.set(comment.id, comment);
      }
    }
    const sorted = [...comments.values()].sort((a, b) =>
      Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id)
    );
    // One profile read per member per request, however many comments they left.
    const lookup = identityReader(req, dependencies);
    const shown = await Promise.all(sorted.map(comment => withIdentity(comment, lookup)));
    return json({ comments: shown, total: shown.length });
  } catch (error) {
    return fail(error);
  }
}

async function readBody(req: Request): Promise<string> {
  const maxBytes = 8192;
  const advertisedLength = Number(req.headers.get("content-length") || 0);
  if (advertisedLength > maxBytes) throw new WallError(413, "Your comment is too large.");
  if (!req.body) throw new WallError(400, "Please enter your name and a comment.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new WallError(413, "Your comment is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function submission(req: Request, isForm: boolean): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  if (isForm) return Object.fromEntries(new URLSearchParams(body));
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new WallError(400, "Your comment could not be read. Please try again.");
  }
}

export async function postComment(req: Request, store: WallStore, moderator: Moderator = moderateComment, dependencies?: MainWallDependencies): Promise<Response> {
  const type = (req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const isForm = type === "application/x-www-form-urlencoded";
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) {
      throw new WallError(403, "Please post your comment from the website.");
    }
    if (!isForm && type !== "application/json") {
      throw new WallError(415, "This comment format is not supported.");
    }
    const input = await submission(req, isForm);
    if (input["bot-field"] !== undefined && input["bot-field"] !== "") {
      throw new WallError(400, "Your comment could not be posted.");
    }
    if (typeof input.name !== "string" || typeof input.message !== "string") {
      throw new WallError(400, "Please enter your name and a comment.");
    }
    const name = input.name.trim();
    const message = input.message.trim().replace(/\r\n?/g, "\n");
    if (name.length < 2 || name.length > 60) {
      throw new WallError(400, "Your name needs to be between 2 and 60 characters.");
    }
    if (message.length < 2 || message.length > 1000) {
      throw new WallError(400, "Your comment needs to be between 2 and 1,000 characters.");
    }
    if (/[\u0000-\u001f\u007f]/u.test(name) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) {
      throw new WallError(400, "Please remove unsupported characters from your comment.");
    }
    const requestId = isForm && !input.request_id ? randomUUID() : input.request_id;
    if (typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId)) {
      throw new WallError(400, "Please refresh the page and try posting again.");
    }
    // A read-only moderation check lets deployment checks exercise the real
    // classifier without creating test posts or revealing private review data.
    if (!isForm && input.check_only === true) {
      const moderation = await reviewComment({ name, message }, moderator);
      return json({ status: moderation.status, check_only: true, published: false });
    }
    // A retry reuses its record. Reusing an ID with other content cannot replace it.
    const id = createHash("sha256").update(JSON.stringify([requestId.toLowerCase(), name, message])).digest("hex");
    const key = `comments/${id}`;
    let record = await store.get(key, { type: "json" }) as StoredComment | null;
    let created = false;
    if (!record) {
      const moderation = await reviewComment({ name, message }, moderator);
      const now = new Date().toISOString();
      // The author comes from the session, never from the submitted body, so a
      // comment can never be attached to a member who did not write it.
      const author = await signedInAuthor(dependencies);
      const candidate: StoredComment = {
        id, name, message, created_at: now, moderation,
        ...(author ? { author_id: author.id, author_is_owner: author.isOwner } : {}),
        ...(moderation.status === "approved" ? { published_at: now } : {}),
      };
      const result = await store.setJSON(key, candidate, { onlyIfNew: true });
      created = result.modified;
      record = created ? candidate : await store.get(key, { type: "json" }) as StoredComment | null;
    }
    if (!record) throw new Error("Saved comment could not be read");
    const stored = publicComment(record);
    const comment = stored ? await withIdentity(stored, identityReader(req, dependencies)) : null;
    if (!comment) {
      if (record.moderation?.status === "rejected") {
        const message = "This wall is for love and respect. Negative comments or personal attacks about anyone are not published.";
        return isForm ? fail(new WallError(422, message), true) : json({ status: "rejected", error: message }, 422);
      }
      if (isForm) return new Response(null, { status: 303, headers: { ...responseHeaders(), Location: "/comment-received.html" } });
      return json({ status: "pending", message: "Your comment is saved for review and is not public yet." }, 202);
    }
    if (isForm) {
      return new Response(null, {
        status: 303,
        headers: { ...responseHeaders(), Location: "/#comments" },
      });
    }
    return json({ status: "approved", comment }, created ? 201 : 200);
  } catch (error) {
    return fail(error, isForm);
  }
}

export function unavailable(): Response {
  return fail(new Error("Store unavailable"));
}
