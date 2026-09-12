import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  reviewPricingTiers,
  reviewQueueEntries,
  reviewReviewers,
  reviewReviews,
  reviewSubmissions,
  reviewTransactions,
  reviewWorkspaces,
} from "../../../db/schema.js";
import { assertSameOrigin, MemberError, memberFailure, memberJSON, requireMember } from "./member-auth.mts";

const BAD_TEXT = /[\u0000-\u001f\u007f<>]/;
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]);
const TIERS = [
  { code: "free", name: "Free", description: "Standard queue", priceCents: 0, priorityWeight: 100, guaranteed: false },
  { code: "priority", name: "Priority", description: "Moves ahead of standard submissions", priceCents: 2500, priorityWeight: 500, guaranteed: false },
  { code: "premium", name: "Premium", description: "Highest placement with a guaranteed review", priceCents: 5000, priorityWeight: 900, guaranteed: true },
  { code: "custom", name: "Custom", description: "Reviewer-specific routing rules", priceCents: 0, priorityWeight: 300, guaranteed: false },
] as const;

function cleanText(value: unknown, max: number, required = false): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if ((required && text.length < 1) || text.length > max || BAD_TEXT.test(text)) throw new MemberError(400, "Check the information you entered and try again.");
  return text;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "review-room";
}

function safeUrl(value: unknown, required = false): string {
  const text = String(value ?? "").trim();
  if (!text && !required) return "";
  if (text.length > 1000) throw new MemberError(400, "Use a shorter link.");
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new MemberError(400, "Use a full secure https link.");
  }
}

function tagsOf(value: unknown): string[] {
  return String(value ?? "").split(",").map(tag => cleanText(tag, 28)).filter(Boolean).slice(0, 8);
}

async function ensureWorkspace(member: { id: string; name: string }) {
  let [workspace] = await db.select().from(reviewWorkspaces).where(eq(reviewWorkspaces.ownerId, member.id)).limit(1);
  if (!workspace) {
    const slug = `${slugify(member.name)}-${member.id.slice(0, 6)}`;
    await db.insert(reviewWorkspaces).values({ ownerId: member.id, slug, name: `${member.name} Review Room` }).onConflictDoNothing();
    [workspace] = await db.select().from(reviewWorkspaces).where(eq(reviewWorkspaces.ownerId, member.id)).limit(1);
  }
  if (!workspace) throw new MemberError(503, "Your Review Room could not open. Please try again.");
  await db.insert(reviewReviewers).values({ workspaceId: workspace.id, memberId: member.id, displayName: member.name, isAdmin: true }).onConflictDoNothing();
  for (const tier of TIERS) await db.insert(reviewPricingTiers).values({ workspaceId: workspace.id, ...tier }).onConflictDoNothing();
  const [reviewer] = await db.select().from(reviewReviewers).where(and(eq(reviewReviewers.workspaceId, workspace.id), eq(reviewReviewers.memberId, member.id))).limit(1);
  return { workspace, reviewer };
}

async function requireRoomAdmin(member: { id: string; name: string }) {
  const room = await ensureWorkspace(member);
  if (!room.reviewer?.isAdmin || room.reviewer.status !== "active") throw new MemberError(403, "You cannot manage this Review Room.");
  return { workspace: room.workspace, reviewer: room.reviewer };
}

function reviewPayload(row: any) {
  return row.review ? {
    overall_score: row.review.overallScore,
    scores: row.review.scores,
    feedback: row.review.feedback,
    visibility: row.review.visibility,
    decision: row.review.decision,
    published_at: row.review.publishedAt ? new Date(row.review.publishedAt).toISOString() : null,
  } : null;
}

export async function dashboard(req: Request): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const member = await requireMember();
    const { workspace, reviewer } = await ensureWorkspace(member);
    const tiers = await db.select().from(reviewPricingTiers).where(eq(reviewPricingTiers.workspaceId, workspace.id)).orderBy(asc(reviewPricingTiers.priorityWeight));
    const incoming = await db.select({ submission: reviewSubmissions, queue: reviewQueueEntries })
      .from(reviewSubmissions).innerJoin(reviewQueueEntries, eq(reviewQueueEntries.submissionId, reviewSubmissions.id))
      .where(eq(reviewSubmissions.workspaceId, workspace.id))
      .orderBy(desc(reviewQueueEntries.priorityScore), asc(reviewQueueEntries.availableAt), asc(reviewQueueEntries.createdAt));
    const mine = await db.select({
      submission: reviewSubmissions,
      review: reviewReviews,
      queue: reviewQueueEntries,
      roomName: reviewWorkspaces.name,
      queuePosition: sql<number | null>`case when ${reviewQueueEntries.status} = 'waiting' then (select count(*) from review_queue_entries ahead where ahead.workspace_id = ${reviewQueueEntries.workspaceId} and ahead.status = 'waiting' and (ahead.priority_score > ${reviewQueueEntries.priorityScore} or (ahead.priority_score = ${reviewQueueEntries.priorityScore} and ahead.created_at <= ${reviewQueueEntries.createdAt}))) else null end`,
    }).from(reviewSubmissions)
      .innerJoin(reviewQueueEntries, eq(reviewQueueEntries.submissionId, reviewSubmissions.id))
      .innerJoin(reviewWorkspaces, eq(reviewWorkspaces.id, reviewSubmissions.workspaceId))
      .leftJoin(reviewReviews, eq(reviewReviews.submissionId, reviewSubmissions.id))
      .where(eq(reviewSubmissions.artistId, member.id)).orderBy(desc(reviewSubmissions.createdAt));
    const positions = new Map<number, number>();
    incoming.filter(row => row.queue.status === "waiting").forEach((row, index) => positions.set(row.submission.id, index + 1));
    const [money] = await db.select({
      settled: sql<number>`coalesce(sum(case when ${reviewTransactions.status} = 'settled' and ${reviewTransactions.kind} = 'charge' then ${reviewTransactions.amountCents} when ${reviewTransactions.status} = 'settled' and ${reviewTransactions.kind} = 'refund' then -${reviewTransactions.amountCents} else 0 end), 0)`,
      pending: sql<number>`coalesce(sum(case when ${reviewTransactions.status} = 'pending' then ${reviewTransactions.amountCents} else 0 end), 0)`,
    }).from(reviewTransactions).where(eq(reviewTransactions.workspaceId, workspace.id));
    return memberJSON({
      member,
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name, bio: workspace.bio, social_links: workspace.socialLinks },
      permissions: { reviewer: !!reviewer, admin: !!reviewer?.isAdmin },
      tiers: tiers.map(tier => ({ code: tier.code, name: tier.name, description: tier.description, price_cents: tier.priceCents, priority_weight: tier.priorityWeight, guaranteed: tier.guaranteed, active: tier.active })),
      stats: { waiting: incoming.filter(row => row.queue.status === "waiting").length, reviewed: incoming.filter(row => row.submission.status === "reviewed").length, revenue_cents: Number(money?.settled ?? 0), pending_cents: Number(money?.pending ?? 0) },
      queue: incoming.map(({ submission, queue }) => ({
        id: submission.id, public_id: submission.publicId, artist_name: submission.artistName, title: submission.title, genre: submission.genre, mood: submission.mood, tags: submission.tags,
        song_info: submission.songInfo, social_links: submission.socialLinks, tier_code: submission.tierCode, status: submission.status, source_type: submission.sourceType,
        source_url: submission.sourceUrl, audio_url: submission.audioKey ? `/api/review-room/audio?id=${encodeURIComponent(submission.publicId)}` : "", featured: submission.featured,
        queue_key: queue.queueKey, priority_score: queue.priorityScore, queue_status: queue.status, queue_position: positions.get(submission.id) ?? null,
        available_at: new Date(queue.availableAt).toISOString(), created_at: new Date(submission.createdAt).toISOString(),
      })),
      submissions: mine.map(row => ({
        id: row.submission.id, public_id: row.submission.publicId, room_name: row.roomName,
        title: row.submission.title, artist_name: row.submission.artistName, tier_code: row.submission.tierCode, status: row.submission.status,
        // An artist can hear their own submission back. The audio route checks
        // that again before it streams a byte; this only says where to ask.
        source_type: row.submission.sourceType, source_url: row.submission.sourceUrl,
        audio_url: row.submission.audioKey ? `/api/review-room/audio?id=${encodeURIComponent(row.submission.publicId)}` : "",
        genre: row.submission.genre, mood: row.submission.mood, tags: row.submission.tags, song_info: row.submission.songInfo, social_links: row.submission.socialLinks,
        payment_status: row.submission.paymentStatus, queue_position: Number(row.queuePosition) || null, created_at: new Date(row.submission.createdAt).toISOString(), review: reviewPayload(row),
      })),
    });
  } catch (error) { return memberFailure(error); }
}

export async function submitTrack(req: Request): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await requireMember();
    const form = await req.formData();
    const roomSlug = cleanText(form.get("room_slug"), 64);
    let workspace;
    if (roomSlug) [workspace] = await db.select().from(reviewWorkspaces).where(eq(reviewWorkspaces.slug, roomSlug)).limit(1);
    if (roomSlug && !workspace) throw new MemberError(404, "That Review Room code was not found.");
    if (!workspace) workspace = (await ensureWorkspace(member)).workspace;
    const tierCode = cleanText(form.get("tier"), 24, true).toLowerCase();
    const [tier] = await db.select().from(reviewPricingTiers).where(and(eq(reviewPricingTiers.workspaceId, workspace.id), eq(reviewPricingTiers.code, tierCode), eq(reviewPricingTiers.active, true))).limit(1);
    if (!tier) throw new MemberError(400, "That submission tier is not available.");
    const title = cleanText(form.get("title"), 120, true);
    const artistName = cleanText(form.get("artist_name"), 80, true);
    const genre = cleanText(form.get("genre"), 50, true);
    const mood = cleanText(form.get("mood"), 50);
    const songInfo = cleanText(form.get("song_info"), 1200);
    const socialLinks = { instagram: safeUrl(form.get("instagram")), website: safeUrl(form.get("website")) };
    const file = form.get("audio");
    const streamUrl = safeUrl(form.get("stream_url"));
    let sourceType = "link";
    let sourceUrl = streamUrl;
    let audioKey = "";
    let audioMime = "";
    if (file instanceof File && file.size > 0) {
      if (file.size > 12 * 1024 * 1024 || !AUDIO_TYPES.has(file.type)) throw new MemberError(400, "Upload an MP3 or WAV up to 12 MB.");
      const bytes = await file.arrayBuffer();
      const head = new Uint8Array(bytes.slice(0, 12));
      const wav = String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WAVE";
      const mp3 = String.fromCharCode(...head.slice(0, 3)) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
      if (!wav && !mp3) throw new MemberError(400, "That file does not appear to be a valid MP3 or WAV.");
      sourceType = "upload";
      sourceUrl = "";
      audioMime = file.type === "audio/x-wav" ? "audio/wav" : file.type;
      audioKey = `submissions/${workspace.id}/${member.id}/${randomUUID()}`;
      await getStore("review-room-audio").set(audioKey, bytes);
    } else if (!streamUrl) {
      throw new MemberError(400, "Upload an MP3/WAV or add a secure streaming link.");
    }
    const publicId = randomUUID();
    const [submission] = await db.insert(reviewSubmissions).values({
      publicId, workspaceId: workspace.id, artistId: member.id, artistName, title, sourceType, sourceUrl, audioKey, audioMime,
      genre, mood, tags: tagsOf(form.get("tags")), songInfo, socialLinks, tierCode: tier.code, priceCents: tier.priceCents,
      paymentStatus: tier.priceCents > 0 ? "pending" : "not_required",
    }).returning();
    await db.insert(reviewQueueEntries).values({ submissionId: submission.id, workspaceId: workspace.id, queueKey: tier.code === "free" ? "standard" : tier.code, priorityScore: tier.priorityWeight });
    if (tier.priceCents > 0) await db.insert(reviewTransactions).values({ workspaceId: workspace.id, submissionId: submission.id, artistId: member.id, amountCents: tier.priceCents, status: "pending" });
    return memberJSON({ ok: true, public_id: publicId, room_slug: workspace.slug }, 201);
  } catch (error) { return memberFailure(error); }
}

export async function queueAction(req: Request): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await requireMember();
    const { workspace, reviewer } = await requireRoomAdmin(member);
    const input = await req.json().catch(() => ({}));
    const submissionId = Number(input.submission_id);
    if (!Number.isInteger(submissionId) || submissionId < 1) throw new MemberError(400, "Choose a submission.");
    const [submission] = await db.select().from(reviewSubmissions).where(and(eq(reviewSubmissions.id, submissionId), eq(reviewSubmissions.workspaceId, workspace.id))).limit(1);
    if (!submission) throw new MemberError(404, "Submission not found.");
    if (input.action === "skip") {
      await db.update(reviewQueueEntries).set({ availableAt: new Date(Date.now() + 30 * 60 * 1000), priorityScore: sql`${reviewQueueEntries.priorityScore} - 1`, updatedAt: new Date() }).where(eq(reviewQueueEntries.submissionId, submission.id));
    } else if (input.action === "feature") {
      await db.update(reviewSubmissions).set({ featured: !submission.featured }).where(eq(reviewSubmissions.id, submission.id));
    } else if (input.action === "refund") {
      if (submission.priceCents < 1) throw new MemberError(400, "This submission has no payment to refund.");
      await db.insert(reviewTransactions).values({ workspaceId: workspace.id, submissionId: submission.id, artistId: submission.artistId, kind: "refund", amountCents: submission.priceCents, status: "pending" });
      await db.update(reviewSubmissions).set({ paymentStatus: "refund_pending" }).where(eq(reviewSubmissions.id, submission.id));
    } else if (input.action === "review") {
      const scores = {
        songwriting: Number(input.scores?.songwriting),
        production: Number(input.scores?.production),
        originality: Number(input.scores?.originality),
        replay: Number(input.scores?.replay),
      };
      if (Object.values(scores).some(score => !Number.isInteger(score) || score < 1 || score > 10)) throw new MemberError(400, "Score every category from 1 to 10.");
      const overall = Math.round(Object.values(scores).reduce((sum, score) => sum + score, 0) / 4);
      const feedback = cleanText(input.feedback, 4000, true);
      const visibility = input.visibility === "private" ? "private" : "public";
      const decision = input.decision === "rejected" ? "rejected" : "approved";
      await db.insert(reviewReviews).values({ submissionId: submission.id, reviewerId: reviewer.id, scores, overallScore: overall, feedback, visibility, decision, publishedAt: visibility === "public" ? new Date() : null }).onConflictDoUpdate({
        target: reviewReviews.submissionId,
        set: { reviewerId: reviewer.id, scores, overallScore: overall, feedback, visibility, decision, updatedAt: new Date(), publishedAt: visibility === "public" ? new Date() : null },
      });
      await db.update(reviewSubmissions).set({ status: "reviewed", assignedReviewerId: reviewer.id, reviewedAt: new Date() }).where(eq(reviewSubmissions.id, submission.id));
      await db.update(reviewQueueEntries).set({ status: "completed", reviewerId: reviewer.id, updatedAt: new Date() }).where(eq(reviewQueueEntries.submissionId, submission.id));
    } else throw new MemberError(400, "Choose a valid queue action.");
    return memberJSON({ ok: true });
  } catch (error) { return memberFailure(error); }
}

export async function saveRoom(req: Request): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await requireMember();
    const { workspace } = await requireRoomAdmin(member);
    const input = await req.json().catch(() => ({}));
    if (input.type === "workspace") {
      const name = cleanText(input.name, 80, true);
      const bio = cleanText(input.bio, 600);
      await db.update(reviewWorkspaces).set({ name, bio, updatedAt: new Date() }).where(eq(reviewWorkspaces.id, workspace.id));
    } else if (input.type === "tier") {
      const code = cleanText(input.code, 24, true).toLowerCase();
      const priceCents = Math.max(0, Math.min(100000, Math.round(Number(input.price_cents) || 0)));
      const priorityWeight = Math.max(1, Math.min(10000, Math.round(Number(input.priority_weight) || 1)));
      await db.update(reviewPricingTiers).set({ priceCents, priorityWeight, active: input.active !== false, updatedAt: new Date() }).where(and(eq(reviewPricingTiers.workspaceId, workspace.id), eq(reviewPricingTiers.code, code)));
    } else throw new MemberError(400, "Choose a valid setting.");
    return memberJSON({ ok: true });
  } catch (error) { return memberFailure(error); }
}

export async function audio(req: Request): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const member = await requireMember();
    const id = new URL(req.url).searchParams.get("id") || "";
    const [submission] = await db.select().from(reviewSubmissions).where(eq(reviewSubmissions.publicId, id)).limit(1);
    if (!submission?.audioKey) throw new MemberError(404, "Audio not found.");
    const [workspace] = await db.select().from(reviewWorkspaces).where(eq(reviewWorkspaces.id, submission.workspaceId)).limit(1);
    const [reviewer] = await db.select().from(reviewReviewers).where(and(eq(reviewReviewers.workspaceId, submission.workspaceId), eq(reviewReviewers.memberId, member.id), eq(reviewReviewers.status, "active"))).limit(1);
    const allowed = submission.artistId === member.id || workspace?.ownerId === member.id || !!reviewer;
    if (!allowed) throw new MemberError(403, "This audio is private to the artist and reviewer.");
    const blob = await getStore("review-room-audio").get(submission.audioKey, { type: "blob" });
    if (!(blob instanceof Blob)) throw new MemberError(404, "Audio not found.");
    return new Response(blob.stream(), { headers: { "Content-Type": submission.audioMime || "audio/mpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return memberFailure(error); }
}

export async function publicRoom(req: Request): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const url = new URL(req.url);
    const slug = cleanText(url.searchParams.get("room"), 64, true);
    const [workspace] = await db.select().from(reviewWorkspaces).where(eq(reviewWorkspaces.slug, slug)).limit(1);
    if (!workspace) throw new MemberError(404, "Review Room not found.");
    const rows = await db.select({ submission: reviewSubmissions, review: reviewReviews, reviewer: reviewReviewers })
      .from(reviewReviews)
      .innerJoin(reviewSubmissions, eq(reviewSubmissions.id, reviewReviews.submissionId))
      .innerJoin(reviewReviewers, eq(reviewReviewers.id, reviewReviews.reviewerId))
      .where(and(eq(reviewSubmissions.workspaceId, workspace.id), eq(reviewReviews.visibility, "public")))
      .orderBy(desc(reviewReviews.publishedAt));
    return memberJSON({
      workspace: { slug: workspace.slug, name: workspace.name, bio: workspace.bio, social_links: workspace.socialLinks },
      reviews: rows.map(({ submission, review, reviewer }) => ({ public_id: submission.publicId, artist_name: submission.artistName, title: submission.title, genre: submission.genre, mood: submission.mood, tags: submission.tags, featured: submission.featured, reviewer_name: reviewer.displayName, overall_score: review.overallScore, scores: review.scores, feedback: review.feedback, decision: review.decision, published_at: review.publishedAt ? new Date(review.publishedAt).toISOString() : null })),
    });
  } catch (error) { return memberFailure(error); }
}
