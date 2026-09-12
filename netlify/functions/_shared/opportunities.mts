/** Creator Opportunities: the part of ROOSTER where somebody can actually find
 * a person to create with. Reading the board needs no account and applying
 * needs no invite, so every visitor-supplied field is cleaned and bounded here
 * before it reaches Postgres, and only the person who posted an opportunity
 * (or the site owner) can read the applications it received. */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getUser, type User } from "@netlify/identity";
import { db } from "../../../db/index.js";
import { opportunities, opportunityApplications } from "../../../db/schema.js";
import { assertSameOrigin, requireMember, MemberError, memberJSON, type Member } from "./member-auth.mts";

export const POSTER_ROLES = [
  { value: "artist", label: "Artist" },
  { value: "producer", label: "Producer" },
  { value: "songwriter", label: "Songwriter" },
  { value: "engineer", label: "Mixing/mastering engineer" },
  { value: "dj", label: "DJ" },
  { value: "manager_anr", label: "Manager / A&R" },
  { value: "videographer", label: "Videographer / photographer" },
] as const;

export const SEEKING_ROLES = [
  { value: "producer", label: "Producer" },
  { value: "artist", label: "Artist" },
  { value: "rapper", label: "Rapper" },
  { value: "singer", label: "Singer" },
  { value: "songwriter", label: "Songwriter" },
  { value: "engineer", label: "Mixing/mastering engineer" },
  { value: "dj", label: "DJ" },
  { value: "manager_anr", label: "Manager / A&R" },
  { value: "videographer", label: "Videographer / photographer" },
  { value: "talent", label: "Talent" },
  { value: "placements", label: "Placements" },
  { value: "clients", label: "Clients" },
  { value: "remixes", label: "Remixes" },
] as const;

export const WORK_MODES = [
  { value: "either", label: "Remote or in person" },
  { value: "remote", label: "Remote" },
  { value: "in_person", label: "In person" },
] as const;

export const GENRES = [
  "Hip-Hop", "Rap", "R&B", "Pop", "Afrobeats", "Drill", "Trap", "Soul",
  "Gospel", "Country", "Dance", "Latin", "Rock", "Alternative", "Any",
] as const;

export const FEATURED_SLUG = "jspace-female-group-2026";

/** The first official opportunity on the board. Written once, on demand, so a
 * fresh database serves the same featured card the promo links to. */
const FEATURED = {
  slug: FEATURED_SLUG,
  title: "New female music group — More Hits On The Way",
  headline: "I’m looking for 3 female rappers + 1 female R&B singer.",
  description:
    "I am building a new female music group through ROOSTER and More Hits On The Way. "
    + "Three female rappers and one female R&B singer. "
    + "Think you got what it takes? Apply through ROOSTER and show me what you do. "
    + "You do not need an invite code to apply. If it’s a fit, we’ll connect.",
  posterRole: "producer",
  seekingRole: "artist",
  lanes: ["Female Rapper", "Female R&B Singer"],
  genre: "Hip-Hop",
  city: "",
  region: "United States",
  workMode: "either",
  postedByKind: "owner",
  postedByMemberId: null,
  postedByName: "J.White Did It",
  featured: true,
  status: "open",
};

const SLUG = /^[a-z0-9][a-z0-9-]{2,60}$/;
const LIMITS = {
  title: 90, headline: 160, description: 1200, genre: 30, city: 60, region: 60,
  name: 80, artist: 80, handle: 80, links: 500, pitch: 900, email: 254, lane: 60,
};

function env(key: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get?.(key) ?? process.env[key];
}

function failure(error: unknown): Response {
  return error instanceof MemberError
    ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Opportunities are unavailable right now. Please try again in a moment." }, 503);
}

function publicJSON(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Netlify-CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Collapse control characters and runs of whitespace, then bound the length.
 * A field that is over the limit is refused rather than silently truncated. */
function clean(value: unknown, max: number, label: string, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new MemberError(400, `Please fill in ${label}.`);
    return "";
  }
  const out = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !out) throw new MemberError(400, `Please fill in ${label}.`);
  if (out.length > max) throw new MemberError(400, `Please shorten ${label}.`);
  return out;
}

/** Longer free text keeps its line breaks so a pitch reads the way it was typed. */
function cleanText(value: unknown, max: number, label: string, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new MemberError(400, `Please fill in ${label}.`);
    return "";
  }
  const out = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (required && !out) throw new MemberError(400, `Please fill in ${label}.`);
  if (out.length > max) throw new MemberError(400, `Please shorten ${label}.`);
  return out;
}

/** Links are stored as text but only http(s) addresses are accepted, so a
 * saved link can never become a javascript: or data: target on the page. */
function cleanLinks(value: unknown, label: string): string {
  const raw = clean(value, LIMITS.links, label);
  if (!raw) return "";
  const parts = raw.split(/[\s,]+/).filter(Boolean).slice(0, 6);
  const kept: string[] = [];
  for (const part of parts) {
    const candidate = /^https?:\/\//i.test(part) ? part : `https://${part}`;
    let url: URL;
    try { url = new URL(candidate); } catch { throw new MemberError(400, `Please check the links in ${label}.`); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new MemberError(400, `Please check the links in ${label}.`);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new MemberError(400, `Please check the links in ${label}.`);
    kept.push(url.toString().slice(0, 200));
  }
  return kept.join(" ");
}

function cleanHandle(value: unknown, label: string): string {
  const raw = clean(value, LIMITS.handle, label);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.includes("/")) return cleanLinks(raw, label);
  const handle = raw.replace(/^@+/, "");
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(handle)) throw new MemberError(400, `Please check ${label}.`);
  return `@${handle}`;
}

function pick(value: unknown, allowed: readonly string[], label: string, fallback?: string): string {
  if (typeof value === "string" && allowed.includes(value)) return value;
  if (fallback !== undefined && (value === undefined || value === null || value === "")) return fallback;
  throw new MemberError(400, `Please choose ${label}.`);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if ((req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new MemberError(415, "Send this form from the ROOSTER page.");
  }
  if (Number(req.headers.get("content-length") || 0) > 64 * 1024) throw new MemberError(413, "That is longer than this form accepts.");
  let input: unknown;
  try { input = await req.json(); } catch { throw new MemberError(400, "That form could not be read. Please try again."); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MemberError(400, "That form could not be read. Please try again.");
  return input as Record<string, unknown>;
}

/** Signed in is optional everywhere on the board except posting and reading
 * applications, so a failed session read returns null instead of throwing. */
async function viewer(load: () => Promise<User | null> = getUser): Promise<(Member & { isOwner: boolean }) | null> {
  try {
    const user = await load();
    const basic = await requireMember(async () => user);
    const ownerEmail = env("SITE_OWNER_EMAIL")?.trim().toLowerCase();
    const isOwner = !!ownerEmail && typeof user?.email === "string" && user.email.trim().toLowerCase() === ownerEmail;
    return { ...basic, isOwner };
  } catch {
    return null;
  }
}

let featuredReady: Promise<void> | null = null;
/** Idempotent: the unique slug means a repeat call adds nothing. */
export async function ensureFeaturedOpportunity(): Promise<void> {
  featuredReady ??= (async () => {
    await db.insert(opportunities).values(FEATURED).onConflictDoNothing({ target: opportunities.slug });
  })().catch(error => { featuredReady = null; throw error; });
  await featuredReady;
}

function card(row: typeof opportunities.$inferSelect) {
  return {
    slug: row.slug,
    title: row.title,
    headline: row.headline,
    description: row.description,
    poster_role: row.posterRole,
    seeking_role: row.seekingRole,
    lanes: Array.isArray(row.lanes) ? row.lanes.slice(0, 8) : [],
    genre: row.genre,
    city: row.city,
    region: row.region,
    work_mode: row.workMode,
    posted_by_kind: row.postedByKind,
    posted_by_member_id: row.postedByMemberId,
    posted_by_name: row.postedByName,
    featured: row.featured,
    status: row.status,
    application_count: row.applicationCount,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export function opportunityVocabulary(): Response {
  return publicJSON({
    poster_roles: POSTER_ROLES, seeking_roles: SEEKING_ROLES, work_modes: WORK_MODES,
    genres: GENRES, featured_slug: FEATURED_SLUG,
  });
}

export async function listOpportunities(req: Request): Promise<Response> {
  if (req.method !== "GET") return publicJSON({ error: "Method not allowed." }, 405);
  try {
    await ensureFeaturedOpportunity();
    const params = new URL(req.url).searchParams;
    const role = params.get("role") || "";
    const genre = params.get("genre") || "";
    const place = clean(params.get("place"), LIMITS.city, "the location filter");
    const mode = params.get("mode") || "";
    const sort = params.get("sort") === "trending" ? "trending" : "newest";
    const filters = [eq(opportunities.status, "open")];
    if (role) filters.push(eq(opportunities.seekingRole, pick(role, SEEKING_ROLES.map(r => r.value), "a role")));
    if (genre) filters.push(eq(opportunities.genre, pick(genre, GENRES as readonly string[], "a genre")));
    if (mode) {
      const chosen = pick(mode, WORK_MODES.map(m => m.value), "remote or in person");
      // A "remote or in person" posting answers both sides of the filter.
      if (chosen !== "either") filters.push(or(eq(opportunities.workMode, chosen), eq(opportunities.workMode, "either"))!);
    }
    if (place) filters.push(or(ilike(opportunities.city, `%${place}%`), ilike(opportunities.region, `%${place}%`))!);
    const order = sort === "trending"
      ? [desc(sql`${opportunities.applicationCount} * 3 + ${opportunities.viewCount}`), desc(opportunities.createdAt)]
      : [desc(opportunities.createdAt)];
    const rows = await db.select().from(opportunities)
      .where(and(...filters))
      .orderBy(desc(opportunities.featured), ...order)
      .limit(60);
    return publicJSON({ opportunities: rows.map(card), sort, total: rows.length });
  } catch (error) {
    return failure(error);
  }
}

export async function getOpportunity(req: Request): Promise<Response> {
  if (req.method !== "GET") return publicJSON({ error: "Method not allowed." }, 405);
  try {
    await ensureFeaturedOpportunity();
    const slug = new URL(req.url).searchParams.get("slug") || "";
    if (!SLUG.test(slug)) throw new MemberError(400, "That opportunity could not be found.");
    const [row] = await db.select().from(opportunities).where(eq(opportunities.slug, slug)).limit(1);
    if (!row) throw new MemberError(404, "That opportunity could not be found.");
    // Views feed the trending sort. A failed count must not block the page.
    try {
      await db.update(opportunities)
        .set({ viewCount: sql`${opportunities.viewCount} + 1` })
        .where(eq(opportunities.id, row.id));
    } catch {
      console.warn("opportunity_view_count_skipped");
    }
    return publicJSON({ opportunity: card(row) });
  } catch (error) {
    return failure(error);
  }
}

/** Applying is open to anybody, member or not. No invite code, no account. */
export async function applyToOpportunity(req: Request): Promise<Response> {
  if (req.method !== "POST") return publicJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    await ensureFeaturedOpportunity();
    const input = await readBody(req);
    const slug = typeof input.slug === "string" ? input.slug : "";
    if (!SLUG.test(slug)) throw new MemberError(400, "That opportunity could not be found.");
    const [row] = await db.select().from(opportunities).where(eq(opportunities.slug, slug)).limit(1);
    if (!row) throw new MemberError(404, "That opportunity could not be found.");
    if (row.status !== "open") throw new MemberError(409, "This opportunity is closed. Check the board for what is open now.");

    const lanes = Array.isArray(row.lanes) ? row.lanes.filter(lane => typeof lane === "string" && lane) : [];
    const lane = lanes.length
      ? pick(input.lane, lanes, "whether you are a rapper or a singer")
      : clean(input.lane, LIMITS.lane, "what you are applying as");
    if (input.age_confirmed !== true) throw new MemberError(400, "Please confirm you are 18 or older.");

    const email = clean(input.contact_email, LIMITS.email, "your email");
    if (email && !/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw new MemberError(400, "Please check your email address.");
    const signedIn = await viewer();
    const record = {
      opportunityId: row.id,
      lane,
      name: clean(input.name, LIMITS.name, "your name", true),
      artistName: clean(input.artist_name, LIMITS.artist, "your artist or stage name", true),
      ageConfirmed: true,
      city: clean(input.city, LIMITS.city, "your city", true),
      region: clean(input.region, LIMITS.region, "your state or country", true),
      contactEmail: email,
      instagram: cleanHandle(input.instagram, "your Instagram"),
      tiktok: cleanHandle(input.tiktok, "your TikTok"),
      streamingLinks: cleanLinks(input.streaming_links, "your Spotify, Apple Music or YouTube links"),
      workSamples: cleanLinks(input.work_samples, "your music or work samples"),
      performanceVideo: cleanLinks(input.performance_video, "your performance video"),
      canPerform: pick(input.can_perform, ["yes", "learning", "no"], "whether you dance or perform"),
      willTravel: pick(input.will_travel, ["yes", "maybe", "no"], "whether you can travel"),
      pitch: cleanText(input.pitch, LIMITS.pitch, "why you should be part of this", true),
      memberId: signedIn?.id ?? null,
    };
    if (!record.instagram && !record.tiktok && !record.contactEmail) {
      throw new MemberError(400, "Add an Instagram, a TikTok or an email so we can reach you.");
    }
    if (!record.streamingLinks && !record.workSamples) {
      throw new MemberError(400, "Add at least one link to your music or work samples.");
    }
    await db.insert(opportunityApplications).values(record);
    try {
      await db.update(opportunities)
        .set({ applicationCount: sql`${opportunities.applicationCount} + 1` })
        .where(eq(opportunities.id, row.id));
    } catch {
      // The application is saved. A missed counter only affects the trending sort.
      console.warn("opportunity_application_count_skipped");
    }
    return publicJSON({
      ok: true,
      message: "Your application is in. If it’s a fit, we’ll connect. Welcome to the ROOSTER",
    }, 201);
  } catch (error) {
    return failure(error);
  }
}

/** Posting is the member-facing half of the board: artist looking for producer,
 * producer looking for artist, engineer looking for clients, and so on. */
export async function postOpportunity(req: Request): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await viewer();
    if (!member) throw new MemberError(401, "Log in with a confirmed email to post an opportunity.");
    const input = await readBody(req);
    const title = clean(input.title, LIMITS.title, "a short title", true);
    const mine = await db.select({ id: opportunities.id }).from(opportunities)
      .where(and(eq(opportunities.postedByMemberId, member.id), eq(opportunities.status, "open")));
    if (mine.length >= 5) throw new MemberError(429, "You have 5 open opportunities. Close one before posting another.");
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "opportunity";
    const slug = `${base}-${member.id.slice(0, 8)}-${Date.now().toString(36)}`.slice(0, 60);
    if (!SLUG.test(slug)) throw new MemberError(400, "Please use letters and numbers in the title.");
    const values = {
      slug,
      title,
      headline: clean(input.headline, LIMITS.headline, "what you are looking for", true),
      description: cleanText(input.description, LIMITS.description, "the details", true),
      posterRole: pick(input.poster_role, POSTER_ROLES.map(role => role.value), "what you do"),
      seekingRole: pick(input.seeking_role, SEEKING_ROLES.map(role => role.value), "who you need"),
      lanes: [] as string[],
      genre: pick(input.genre, GENRES as readonly string[], "a genre", "Any"),
      city: clean(input.city, LIMITS.city, "your city"),
      region: clean(input.region, LIMITS.region, "your state or country"),
      workMode: pick(input.work_mode, WORK_MODES.map(mode => mode.value), "remote or in person", "either"),
      postedByKind: "member",
      postedByMemberId: member.id,
      postedByName: member.name,
      featured: false,
      status: "open",
    };
    const [saved] = await db.insert(opportunities).values(values).returning();
    return memberJSON({ ok: true, opportunity: card(saved), message: "Your opportunity is on the board." }, 201);
  } catch (error) {
    return failure(error);
  }
}

/** Only the person who posted, or the site owner, reads the applications. */
export async function listApplications(req: Request): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await viewer();
    if (!member) throw new MemberError(401, "Log in to read applications.");
    const slug = new URL(req.url).searchParams.get("slug") || "";
    if (!SLUG.test(slug)) throw new MemberError(400, "That opportunity could not be found.");
    const [row] = await db.select().from(opportunities).where(eq(opportunities.slug, slug)).limit(1);
    if (!row) throw new MemberError(404, "That opportunity could not be found.");
    if (!member.isOwner && row.postedByMemberId !== member.id) {
      throw new MemberError(403, "Applications are private to the person who posted this.");
    }
    const rows = await db.select().from(opportunityApplications)
      .where(eq(opportunityApplications.opportunityId, row.id))
      .orderBy(desc(opportunityApplications.createdAt))
      .limit(200);
    return memberJSON({
      opportunity: card(row),
      applications: rows.map(application => ({
        id: application.id, lane: application.lane, name: application.name,
        artist_name: application.artistName, age_confirmed: application.ageConfirmed,
        city: application.city, region: application.region,
        contact_email: application.contactEmail, instagram: application.instagram,
        tiktok: application.tiktok, streaming_links: application.streamingLinks,
        work_samples: application.workSamples, performance_video: application.performanceVideo,
        can_perform: application.canPerform, will_travel: application.willTravel,
        pitch: application.pitch, member_id: application.memberId,
        created_at: application.createdAt instanceof Date ? application.createdAt.toISOString() : String(application.createdAt),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

/** The board only shows open postings, so closing one takes it off the board
 * without deleting the applications it already received. */
export async function closeOpportunity(req: Request): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const member = await viewer();
    if (!member) throw new MemberError(401, "Log in to manage your opportunities.");
    const input = await readBody(req);
    const slug = typeof input.slug === "string" ? input.slug : "";
    if (!SLUG.test(slug)) throw new MemberError(400, "That opportunity could not be found.");
    const [row] = await db.select().from(opportunities).where(eq(opportunities.slug, slug)).limit(1);
    if (!row) throw new MemberError(404, "That opportunity could not be found.");
    if (!member.isOwner && row.postedByMemberId !== member.id) {
      throw new MemberError(403, "Only the person who posted this can change it.");
    }
    const status = input.reopen === true ? "open" : "closed";
    await db.update(opportunities).set({ status }).where(eq(opportunities.id, row.id));
    return memberJSON({ ok: true, status, message: status === "open" ? "Back on the board." : "Closed. It is off the board." });
  } catch (error) {
    return failure(error);
  }
}
