import { createHash, randomUUID } from "node:crypto";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { getUser, type User } from "@netlify/identity";
import { MEMBER_ID, MemberError, memberJSON, requireMember, type Member, type MemberResolver } from "./member-auth.mts";
import { getPublicProfile, type ProfileStore } from "./member-profiles.mts";
import { chicagoDay } from "./music-plays.mts";
import type { CommunityReader } from "./community-members.mts";
import { requireCommunityMember } from "./roster-access.mts";

/** Estimated unique visitors per profile. Visitor identities are only ever
 * stored as a keyed hash: no fingerprinting, no IP addresses, no user agents. */
export const CHART_SIZE = 25;
export const CHART_TTL = 45_000;
export const MAX_HISTORY = 8;
const MAX_ATTEMPTS = 10;
/** A visitor's own mark is contended only by that visitor's duplicate
 * requests, but a profile's counter and the week's ranking index are contended
 * by everyone arriving at once, so a crowd gets a far longer queue there. */
const SHARED_ATTEMPTS = 48;
const MIN_DWELL = 2500;
const MAX_DWELL = 3_600_000;
const BODY_LIMIT = 512;
const SCAN_PAGES = 100;
const SCAN_KEYS = 10_000;
const BATCH = 12;
const PEPPER_KEY = "secret/visitor-pepper";
const CACHE_KEY = "weeks/current-cache";
/** The ranking index only ever needs chart contenders, so the long tail of
 * quiet profiles is evicted. Each profile's own counters stay authoritative. */
const INDEX_LIMIT = 500;
const weekIndexKey = (week: string) => `weeks/index/${week}`;
const DAY_ID = /^\d{4}-\d{2}-\d{2}$/;
export const WEEK_ID = /^\d{4}-\d{2}-\d{2}$/;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
/** Automated traffic is dropped before it can reach a counter. */
const AUTOMATED = /bot|crawl|spider|slurp|scrape|fetcher|curl|wget|python-requests|node-fetch|axios|okhttp|java\/|libwww|perl|ruby|go-http|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|monitor|prerender|preview|facebookexternalhit|embedly|semrush|ahrefs|mj12|dotbot|petalbot|bingpreview|archive\.org/i;

export type Visitors = { today: number; this_week: number; all_time: number };
export type VisitorCounts = {
  version: 1; subject: string; all_time: number;
  day: string; today: number; week: string; week_uniques: number;
  history: Record<string, number>;
};
export type ChartEntry = {
  position: number; subject: string; name: string; photo_url: string | null;
  profile_url: string; visitors: number;
};
export type Movement = { kind: "up" | "down" | "same" | "new"; places: number; label: string };
export type WeekArchive = { version: 1; week: string; generated_at: string; entries: ChartEntry[] };

export interface VisitorStore {
  get(key: string, options: { type: "json" }): Promise<any>;
  getWithMetadata(key: string, options: { type: "json" }): Promise<{ data: unknown; etag: string } | null>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean; onlyIfMatch?: string }): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string; etag?: string }[] }>;
}
export type ProfileLookup = { directory?: CommunityReader; friends?: CommunityReader };

/** Preview and branch deploys keep their own counters, so test traffic can
 * never reach the production chart. */
export function visitorStore(context: Context): VisitorStore {
  const options = { name: "profile-visitors", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}

function env(key: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get?.(key) ?? process.env[key];
}
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A compare and set needs the version of what was read. The version normally
 * rides on the blobs read itself, but some hosts, the local development server
 * among them, answer a read without one. The listing carries it in that case,
 * so a write still refuses to overwrite a version it has not seen. */
async function listedVersion(store: VisitorStore, key: string): Promise<string> {
  // A listing taken while the same blob is being replaced can come back
  // without a usable version, so it is asked for again before giving up.
  for (let attempt = 0; attempt < 4; attempt++) {
    for await (const page of store.list({ prefix: key, paginate: true })) {
      for (const blob of page.blobs) if (blob.key === key && typeof blob.etag === "string" && blob.etag) return blob.etag;
    }
    await jitter(attempt);
  }
  throw new Error("Missing visitor record version");
}
async function versioned(store: VisitorStore, key: string): Promise<{ data: unknown; etag: string } | null> {
  const saved = await store.getWithMetadata(key, { type: "json" });
  if (!saved) return null;
  if (typeof saved.etag === "string" && saved.etag) return { data: saved.data, etag: saved.etag };
  return { data: saved.data, etag: await listedVersion(store, key) };
}

export function visitorsFailure(error?: unknown): Response {
  if (error instanceof MemberError) return memberJSON({ error: error.message }, error.status);
  // An unexpected failure is worth a server log, never a made up number.
  console.error("Visitor counting failed", error);
  return memberJSON({ error: "Visitor counts are unavailable right now. Please try again shortly." }, 503);
}

/* ---------------------------------------------------------------- calendar */

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weeks begin Monday at midnight America/Chicago and are named for that
 * Monday, so week ids sort and subtract without week-numbering surprises. */
export function chicagoWeek(now: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  const weekday = WEEKDAYS[part("weekday")];
  const midnight = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  if (weekday === undefined || !Number.isFinite(midnight)) throw new Error("Chicago week could not be resolved");
  return new Date(midnight - ((weekday + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}
export function previousWeek(week: string): string {
  const start = Date.parse(`${week}T00:00:00Z`);
  if (!WEEK_ID.test(week) || !Number.isFinite(start)) throw new Error("Invalid week id");
  return new Date(start - 7 * 86_400_000).toISOString().slice(0, 10);
}
function validDay(value: unknown): value is string {
  return typeof value === "string" && DAY_ID.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/* ------------------------------------------------------- visitor identity */

/** The hashing key lives on the server. When no secret is configured one is
 * generated once and stored, so counters survive deploys and restarts. */
async function visitorPepper(store: VisitorStore): Promise<string> {
  const configured = env("VISITOR_HASH_SECRET");
  if (typeof configured === "string" && configured.trim().length >= 32) return configured.trim();
  const saved = await store.get(PEPPER_KEY, { type: "json" });
  if (typeof saved?.secret === "string" && saved.secret.length >= 32) return saved.secret;
  await store.setJSON(PEPPER_KEY, { version: 1, secret: `${randomUUID()}${randomUUID()}`.replace(/-/g, "") }, { onlyIfNew: true });
  const stored = await store.get(PEPPER_KEY, { type: "json" });
  if (typeof stored?.secret !== "string" || stored.secret.length < 32) throw new Error("Visitor privacy key was not saved");
  return stored.secret;
}
/** Includes the profile so the same visitor cannot be correlated across pages. */
function markKey(pepper: string, subject: string, kind: "member" | "guest", identity: string): string {
  return `marks/${subject}/${createHash("sha256").update(`${pepper}\n${subject}\n${kind}\n${identity}`).digest("hex")}`;
}
/** Who is looking, for excluding the page owner and counting one member once.
 * The profile page itself is already invite only, so this only has to answer
 * the question of identity. */
async function optionalMember(loadUser: () => Promise<User | null>): Promise<Member | null> {
  try { return await requireMember(loadUser); } catch { return null; }
}

/* ---------------------------------------------------------------- counters */

function initialCounts(subject: string, now: number): VisitorCounts {
  return { version: 1, subject, all_time: 0, day: chicagoDay(now), today: 0, week: chicagoWeek(now), week_uniques: 0, history: {} };
}
export function countsFrom(value: unknown, subject: string): VisitorCounts {
  if (!record(value) || value.version !== 1 || value.subject !== subject || !counter(value.all_time) ||
      !validDay(value.day) || !counter(value.today) || !WEEK_ID.test(String(value.week)) || !counter(value.week_uniques) ||
      !record(value.history) || Object.keys(value.history).length > MAX_HISTORY ||
      Object.entries(value.history).some(([week, uniques]) => !WEEK_ID.test(week) || !counter(uniques))) {
    throw new Error("Invalid visitor count state");
  }
  return {
    version: 1, subject, all_time: value.all_time, day: value.day, today: value.today,
    week: value.week as string, week_uniques: value.week_uniques,
    history: Object.fromEntries(Object.entries(value.history)) as Record<string, number>,
  };
}
/** A new day or Monday starts a fresh counting period. All Time is never reset
 * and the finished week is filed into history rather than deleted. */
function rolled(state: VisitorCounts, day: string, week: string): VisitorCounts {
  if (state.day === day && state.week === week) return state;
  const history = { ...state.history };
  if (state.week !== week && state.week_uniques > 0) history[state.week] = state.week_uniques;
  delete history[week];
  const trimmed = Object.entries(history).sort((a, b) => b[0].localeCompare(a[0])).slice(0, MAX_HISTORY);
  return {
    version: 1, subject: state.subject, all_time: state.all_time,
    day, today: state.day === day ? state.today : 0,
    week, week_uniques: state.week === week ? state.week_uniques : 0,
    history: Object.fromEntries(trimmed),
  };
}
export async function visitorSnapshot(store: VisitorStore, subject: string, now: number) {
  const saved = await versioned(store, `counts/${subject}`);
  const state = saved ? countsFrom(saved.data, subject) : initialCounts(subject, now);
  return { state: rolled(state, chicagoDay(now), chicagoWeek(now)), etag: saved?.etag ?? null };
}
export const publicVisitors = (state: VisitorCounts): Visitors =>
  ({ today: state.today, this_week: state.week_uniques, all_time: state.all_time });

/* --------------------------------------------------------- profile subject */

async function ownerBindingId(profiles: ProfileStore): Promise<string | null> {
  const binding = await profiles.get("owner-binding", { type: "json" });
  if (binding === null) return null;
  if (!binding || typeof binding.id !== "string" || !MEMBER_ID.test(binding.id)) throw new Error("Invalid owner binding");
  return binding.id.toLowerCase();
}
type Subject = { subject: string; isOwnerPage: boolean; binding: string | null; name: string; photo_url: string | null; profile_url: string };
const pageUrl = (subject: string, binding: string | null) => subject === "owner" || subject === binding ? "/#home" : `/profile.html?id=${subject}`;

/** Resolves a requested page to one durable counting key. Unknown profiles are
 * rejected so a made-up id can never open a counter. */
async function resolveSubject(req: Request, profiles: ProfileStore, lookup: ProfileLookup, requested: string): Promise<Subject> {
  if (requested !== "owner" && !MEMBER_ID.test(requested)) throw new MemberError(400, "Choose a valid profile.");
  const response = await getPublicProfile(new Request(new URL(`/api/profile?id=${encodeURIComponent(requested)}`, req.url)), profiles, lookup);
  if (!response.ok) throw new MemberError(response.status === 404 ? 404 : 503, "This member's profile is unavailable.");
  const { profile } = await response.json();
  if (!profile || typeof profile.name !== "string") throw new Error("Invalid profile payload");
  const binding = await ownerBindingId(profiles);
  const id = requested.toLowerCase();
  const isOwnerPage = requested === "owner" || (!!binding && id === binding);
  const subject = isOwnerPage ? binding ?? "owner" : id;
  return {
    subject, isOwnerPage, binding, name: profile.name,
    photo_url: typeof profile.photo_url === "string" ? profile.photo_url : null,
    profile_url: pageUrl(subject, binding),
  };
}
function requestedProfile(req: Request): string {
  const values = new URL(req.url).searchParams.getAll("id");
  if (values.length !== 1) throw new MemberError(400, "Choose a valid profile.");
  return values[0];
}

/* ------------------------------------------------------------- the chart */

type Total = { subject: string; visitors: number };

/** J.White's page keeps its own Visitors box but does not compete for the
 * chart or the weekly feature. */
function chartExclusions(binding: string | null): Set<string> {
  return new Set(["owner", ...(binding ? [binding] : [])]);
}
function indexFrom(value: unknown, week: string): Record<string, number> | null {
  if (!record(value) || value.version !== 1 || value.week !== week || !record(value.visitors) ||
      Object.keys(value.visitors).length > INDEX_LIMIT ||
      Object.entries(value.visitors).some(([subject, uniques]) => !MEMBER_ID.test(subject) || !counter(uniques))) return null;
  return Object.fromEntries(Object.entries(value.visitors)) as Record<string, number>;
}
const indexTotals = (visitors: Record<string, number>, exclude: Set<string>): Total[] =>
  Object.entries(visitors)
    .filter(([subject, uniques]) => uniques > 0 && !exclude.has(subject))
    .map(([subject, uniques]) => ({ subject, visitors: uniques }));

/** Keeps every profile's weekly total in one small blob so ranking a week is a
 * single read instead of a walk over every counter. Absolute values are stored
 * rather than deltas, so an evicted or lost entry heals on the next visit. */
async function indexVisitor(store: VisitorStore, week: string, subject: string, uniques: number, pause: (attempt: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < SHARED_ATTEMPTS; attempt++) {
    const saved = await versioned(store, weekIndexKey(week));
    const current = saved ? indexFrom(saved.data, week) ?? {} : {};
    if (current[subject] === uniques) return;
    const ranked = Object.entries({ ...current, [subject]: uniques })
      .filter(([id, count]) => count > 0 && MEMBER_ID.test(id))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const kept = ranked.slice(0, INDEX_LIMIT);
    if (kept.length && !kept.some(([id]) => id === subject)) kept[kept.length - 1] = [subject, uniques];
    const written = await store.setJSON(weekIndexKey(week), { version: 1, week, visitors: Object.fromEntries(kept) },
      saved ? { onlyIfMatch: saved.etag } : { onlyIfNew: true });
    if (written.modified) return;
    if (attempt + 1 < SHARED_ATTEMPTS) await pause(attempt);
  }
  throw new Error("Visitor index write contention");
}
/** Ranking source for a week. Falls back to a bounded walk over the counters
 * only when a week has no index at all, so a missing index never invents a
 * result and never silently drops one. */
async function weeklyTotals(store: VisitorStore, week: string, exclude: Set<string>): Promise<Total[]> {
  const saved = indexFrom(await store.get(weekIndexKey(week), { type: "json" }), week);
  if (saved) return indexTotals(saved, exclude);
  const totals: Total[] = [];
  let pages = 0, seen = 0;
  for await (const page of store.list({ prefix: "counts/", paginate: true })) {
    if (++pages > SCAN_PAGES) throw new MemberError(503, "Top Rosters is busy. Please try again.");
    const subjects = page.blobs
      .map(blob => blob.key.slice("counts/".length))
      .filter(subject => MEMBER_ID.test(subject) && !exclude.has(subject));
    if ((seen += page.blobs.length) > SCAN_KEYS) throw new MemberError(503, "Top Rosters is busy. Please try again.");
    for (let offset = 0; offset < subjects.length; offset += BATCH) {
      const batch = await Promise.all(subjects.slice(offset, offset + BATCH).map(async subject => {
        let state: VisitorCounts;
        try { state = countsFrom(await store.get(`counts/${subject}`, { type: "json" }), subject); } catch { return null; }
        const visitors = state.week === week ? state.week_uniques : state.history[week] ?? 0;
        return visitors > 0 ? { subject, visitors } : null;
      }));
      for (const total of batch) if (total) totals.push(total);
    }
  }
  return totals;
}

/** Competition ranking: tied profiles share a position and the next distinct
 * count skips the places they used. Ties list by member id so the order is
 * always the same for everyone. */
export function rankTotals(totals: Total[], size = CHART_SIZE): { position: number; subject: string; visitors: number }[] {
  const sorted = [...totals].sort((a, b) => b.visitors - a.visitors || a.subject.localeCompare(b.subject));
  const ranked: { position: number; subject: string; visitors: number }[] = [];
  for (const [index, total] of sorted.entries()) {
    const tied = index > 0 && sorted[index - 1].visitors === total.visitors;
    ranked.push({ position: tied ? ranked[index - 1].position : index + 1, subject: total.subject, visitors: total.visitors });
  }
  return ranked.slice(0, size);
}
async function buildEntries(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup,
  week: string, binding: string | null): Promise<{ entries: ChartEntry[]; ranked: number }> {
  const totals = await weeklyTotals(store, week, chartExclusions(binding));
  const ranked = rankTotals(totals);
  const entries: ChartEntry[] = [];
  for (let offset = 0; offset < ranked.length; offset += BATCH) {
    const batch = await Promise.all(ranked.slice(offset, offset + BATCH).map(async row => {
      const response = await getPublicProfile(new Request(new URL(`/api/profile?id=${row.subject}`, req.url)), profiles, lookup);
      if (!response.ok) return null;
      const { profile } = await response.json();
      if (!profile || typeof profile.name !== "string") return null;
      return {
        position: row.position, subject: row.subject, name: profile.name,
        photo_url: typeof profile.photo_url === "string" ? profile.photo_url : null,
        profile_url: pageUrl(row.subject, binding), visitors: row.visitors,
      } satisfies ChartEntry;
    }));
    for (const entry of batch) if (entry) entries.push(entry);
  }
  return { entries, ranked: totals.length };
}
function archiveFrom(value: unknown, week: string): WeekArchive | null {
  if (!record(value) || value.version !== 1 || value.week !== week || typeof value.generated_at !== "string" ||
      !Array.isArray(value.entries) || value.entries.length > CHART_SIZE) return null;
  const entries: ChartEntry[] = [];
  for (const entry of value.entries) {
    if (!record(entry) || !Number.isInteger(entry.position) || (entry.position as number) < 1 || (entry.position as number) > CHART_SIZE ||
        typeof entry.subject !== "string" || !MEMBER_ID.test(entry.subject) || typeof entry.name !== "string" ||
        !counter(entry.visitors) || typeof entry.profile_url !== "string" ||
        (entry.photo_url !== null && typeof entry.photo_url !== "string")) return null;
    entries.push(entry as ChartEntry);
  }
  return { version: 1, week, generated_at: value.generated_at, entries };
}
/** A finished week is written once and never rewritten, so last week's chart,
 * the movement arrows and the featured winner stay fixed all week long. */
export async function ensureArchive(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup,
  week: string, now: number): Promise<WeekArchive | null> {
  if (week >= chicagoWeek(now)) return null;
  const existing = archiveFrom(await store.get(`weeks/${week}`, { type: "json" }), week);
  if (existing) return existing;
  const binding = await ownerBindingId(profiles);
  const built = await buildEntries(req, store, profiles, lookup, week, binding);
  const archive: WeekArchive = { version: 1, week, generated_at: new Date(now).toISOString(), entries: built.entries };
  await store.setJSON(`weeks/${week}`, archive, { onlyIfNew: true });
  return archiveFrom(await store.get(`weeks/${week}`, { type: "json" }), week) ?? archive;
}
function movementFor(position: number, before: number | undefined): Movement {
  if (before === undefined) return { kind: "new", places: 0, label: "NEW" };
  if (before === position) return { kind: "same", places: 0, label: "SAME" };
  const places = Math.abs(before - position);
  return before > position ? { kind: "up", places, label: `▲${places}` } : { kind: "down", places, label: `▼${places}` };
}
export type Chart = {
  week_start: string; updated_at: string; chart_size: number; ranked: number;
  entries: (ChartEntry & { movement: Movement; last_week_position: number | null })[];
};
/** Cached briefly so a busy profile page never rescans every counter. */
export async function currentChart(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup, now: number): Promise<Chart> {
  const week = chicagoWeek(now);
  const cached = await store.get(CACHE_KEY, { type: "json" });
  if (record(cached) && cached.version === 1 && cached.week === week && counter(cached.built_at) &&
      (cached.built_at as number) > now - CHART_TTL && record(cached.chart)) return cached.chart as Chart;
  const binding = await ownerBindingId(profiles);
  const previous = await ensureArchive(req, store, profiles, lookup, previousWeek(week), now).catch(() => null);
  const before = new Map((previous?.entries ?? []).map(entry => [entry.subject, entry.position]));
  const built = await buildEntries(req, store, profiles, lookup, week, binding);
  const chart: Chart = {
    week_start: week, updated_at: new Date(now).toISOString(), chart_size: CHART_SIZE, ranked: built.ranked,
    entries: built.entries.map(entry => ({ ...entry, movement: movementFor(entry.position, before.get(entry.subject)), last_week_position: before.get(entry.subject) ?? null })),
  };
  await store.setJSON(CACHE_KEY, { version: 1, week, built_at: now, chart }).catch(() => {});
  return chart;
}

/* ------------------------------------------------------- counting a visit */

type Submission = { profile_id: string; visitor_id: string; dwell_ms: number };

async function visitSubmission(req: Request): Promise<Submission> {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new MemberError(403, "Please open this profile from this website.");
  }
  if ((req.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new MemberError(415, "This visit format is not supported.");
  }
  const agent = req.headers.get("user-agent") || "";
  if (agent.length < 15 || agent.length > 512 || AUTOMATED.test(agent)) throw new MemberError(403, "Automated traffic is not counted.");
  if (Number(req.headers.get("content-length") || 0) > BODY_LIMIT || !req.body) throw new MemberError(413, "This visit request is too large.");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); throw new MemberError(413, "This visit request is too large."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MemberError(400, "This visit could not be read."); }
  if (!record(body) || Object.keys(body).sort().join(",") !== "dwell_ms,profile_id,visitor_id" ||
      typeof body.profile_id !== "string" || (body.profile_id !== "owner" && !MEMBER_ID.test(body.profile_id)) ||
      typeof body.visitor_id !== "string" || !UUID_V4.test(body.visitor_id) ||
      !Number.isInteger(body.dwell_ms) || (body.dwell_ms as number) < MIN_DWELL || (body.dwell_ms as number) > MAX_DWELL) {
    throw new MemberError(400, "This visit is invalid.");
  }
  return { profile_id: body.profile_id, visitor_id: (body.visitor_id as string).toLowerCase(), dwell_ms: body.dwell_ms as number };
}

type Fresh = { all_time: boolean; today: boolean; week: boolean };
type Claim = { fresh: Fresh; previous: { day: string; week: string } | null };
const nothingNew = (fresh: Fresh) => !fresh.all_time && !fresh.today && !fresh.week;

function markFrom(value: unknown): { day: string; week: string } | null {
  if (!record(value) || value.version !== 1 || !validDay(value.day) || !WEEK_ID.test(String(value.week))) return null;
  return { day: value.day, week: value.week as string };
}
/** One durable mark per visitor per profile decides Today, This Week and All
 * Time in a single compare-and-set, so simultaneous visits cannot double count
 * and a refresh cannot add a second visitor. */
async function claimVisitor(store: VisitorStore, key: string, day: string, week: string, pause: (attempt: number) => Promise<void>): Promise<Claim> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const saved = await versioned(store, key);
    const previous = saved ? markFrom(saved.data) : null;
    const fresh: Fresh = { all_time: !previous, today: !previous || previous.day !== day, week: !previous || previous.week !== week };
    if (nothingNew(fresh)) return { fresh, previous };
    const written = await store.setJSON(key, { version: 1, day, week }, saved ? { onlyIfMatch: saved.etag } : { onlyIfNew: true });
    if (written.modified) return { fresh, previous };
    if (attempt + 1 < MAX_ATTEMPTS) await pause(attempt);
  }
  throw new Error("Visitor mark write contention");
}
/** A claimed visitor whose count never landed is handed back rather than
 * swallowed, so their next visit is counted instead of lost. Only that one
 * visitor's own mark is touched, so nothing can be double counted. */
async function releaseVisitor(store: VisitorStore, key: string, previous: { day: string; week: string } | null): Promise<void> {
  try {
    if (previous) await store.setJSON(key, { version: 1, ...previous });
    else await store.delete(key);
  } catch (error) {
    console.error("Releasing an uncounted visit failed", error);
  }
}
async function addVisitor(store: VisitorStore, subject: string, fresh: Fresh, now: number, pause: (attempt: number) => Promise<void>): Promise<VisitorCounts> {
  for (let attempt = 0; attempt < SHARED_ATTEMPTS; attempt++) {
    const { state, etag } = await visitorSnapshot(store, subject, now);
    if (state.all_time >= Number.MAX_SAFE_INTEGER - 1) throw new Error("Visitor count capacity exceeded");
    const next: VisitorCounts = {
      ...state,
      all_time: state.all_time + (fresh.all_time ? 1 : 0),
      today: state.today + (fresh.today ? 1 : 0),
      week_uniques: state.week_uniques + (fresh.week ? 1 : 0),
    };
    const written = await store.setJSON(`counts/${subject}`, next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (written.modified) {
      if (fresh.week) await indexVisitor(store, next.week, subject, next.week_uniques, pause);
      return next;
    }
    if (attempt + 1 < SHARED_ATTEMPTS) await pause(attempt);
  }
  throw new Error("Visitor count write contention");
}
const jitter = (attempt: number) => new Promise<void>(resolve => setTimeout(resolve, Math.min(80, 4 * 2 ** attempt) * (0.5 + Math.random())));

async function chartPosition(store: VisitorStore, target: Subject, now: number): Promise<number | null> {
  if (target.isOwnerPage) return null;
  const week = chicagoWeek(now);
  const index = indexFrom(await store.get(weekIndexKey(week), { type: "json" }), week);
  if (!index) return null;
  return rankTotals(indexTotals(index, chartExclusions(target.binding))).find(row => row.subject === target.subject)?.position ?? null;
}
function visitorsView(target: Subject, state: VisitorCounts, position: number | null, extra: Record<string, unknown> = {}) {
  return {
    profile_id: target.subject, name: target.name, ...publicVisitors(state),
    position, chart_eligible: !target.isOwnerPage, chart_size: CHART_SIZE, chart_url: "/top25.html",
    week_start: state.week, day: state.day, estimated: true, ...extra,
  };
}

/* --------------------------------------------------------------- handlers */

export async function getProfileVisitors(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup = {}, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const target = await resolveSubject(req, profiles, lookup, requestedProfile(req));
    const { state } = await visitorSnapshot(store, target.subject, now);
    return memberJSON(visitorsView(target, state, await chartPosition(store, target, now)));
  } catch (error) { return visitorsFailure(error); }
}

export async function postProfileVisit(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup = {},
  loadUser: () => Promise<User | null> = getUser, now = Date.now(), pause = jitter): Promise<Response> {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const input = await visitSubmission(req);
    const target = await resolveSubject(req, profiles, lookup, input.profile_id);
    const viewer = await optionalMember(loadUser);
    const position = () => chartPosition(store, target, now);
    // A signed in member never counts as a visitor to their own page.
    if (viewer && (viewer.id === target.subject || (target.isOwnerPage && !!target.binding && viewer.id === target.binding))) {
      const { state } = await visitorSnapshot(store, target.subject, now);
      return memberJSON(visitorsView(target, state, await position(), { counted: false, reason: "own_profile" }));
    }
    const key = markKey(await visitorPepper(store), target.subject, viewer ? "member" : "guest", viewer ? viewer.id : input.visitor_id);
    const claim = await claimVisitor(store, key, chicagoDay(now), chicagoWeek(now), pause);
    if (nothingNew(claim.fresh)) {
      const { state } = await visitorSnapshot(store, target.subject, now);
      return memberJSON(visitorsView(target, state, await position(), { counted: false, reason: "already_counted" }));
    }
    let state: VisitorCounts;
    try { state = await addVisitor(store, target.subject, claim.fresh, now, pause); }
    catch (error) { await releaseVisitor(store, key, claim.previous); throw error; }
    return memberJSON(visitorsView(target, state, await position(), { counted: true }), 201);
  } catch (error) { return visitorsFailure(error); }
}

export async function getTopTwentyFive(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup = {}, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try { return memberJSON(await currentChart(req, store, profiles, lookup, now)); }
  catch (error) { return visitorsFailure(error); }
}

/** The number one profile from the finished week holds the feature all week. */
export async function getFeaturedProfile(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup = {}, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const week = chicagoWeek(now), completed = previousWeek(week);
    const archive = await ensureArchive(req, store, profiles, lookup, completed, now);
    const winner = archive?.entries.find(entry => entry.position === 1 && entry.visitors > 0) ?? null;
    return memberJSON({ week_start: week, featured_week_start: completed, chart_url: "/top25.html", featured: winner });
  } catch (error) { return visitorsFailure(error); }
}

/** Private to the signed in member: their own finished week and final place. */
export async function getVisitorRecap(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup = {},
  resolve: MemberResolver = requireCommunityMember, now = Date.now()): Promise<Response> {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    const member = await resolve();
    const week = chicagoWeek(now), completed = previousWeek(week);
    const { state } = await visitorSnapshot(store, member.id, now);
    const archive = await ensureArchive(req, store, profiles, lookup, completed, now).catch(() => null);
    const entry = archive?.entries.find(row => row.subject === member.id) ?? null;
    return memberJSON({
      week_start: completed, visitors: state.history[completed] ?? 0,
      position: entry?.position ?? null, made_chart: !!entry, chart_size: CHART_SIZE, chart_url: "/top25.html",
      current: publicVisitors(state), profile_url: pageUrl(member.id, await ownerBindingId(profiles)), estimated: true,
    });
  } catch (error) { return visitorsFailure(error); }
}

/** Files the finished week on a schedule as well as on demand, so the chart,
 * the arrows and the feature are ready the moment Monday arrives. */
export async function rolloverWeeks(req: Request, store: VisitorStore, profiles: ProfileStore, lookup: ProfileLookup = {}, now = Date.now()): Promise<string[]> {
  const filed: string[] = [];
  let week = previousWeek(chicagoWeek(now));
  for (let step = 0; step < 2; step++) {
    const archive = await ensureArchive(req, store, profiles, lookup, week, now);
    if (archive) filed.push(archive.week);
    week = previousWeek(week);
  }
  return filed;
}
