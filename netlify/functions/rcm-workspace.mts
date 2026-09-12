import type { Config } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { rcmAiMessages, rcmProfiles, rcmRecords } from "../../db/schema.js";
import { assertSameOrigin, MemberError, memberFailure, memberJSON, requireMember } from "./_shared/member-auth.mts";
import { normalizeMoneyData } from "../../rcm-money.mjs";

const KINDS = new Set(["song", "person", "document", "release", "show", "task", "royalty", "file", "deal", "content", "creative", "registration"]);
const STATUSES = new Set(["draft", "sent", "viewed", "signed", "completed", "expired", "open", "ready", "needs-review"]);
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/;

function text(value: unknown, max: number, label: string, required = false): string {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ");
  if ((required && !cleaned) || cleaned.length > max || UNSAFE.test(cleaned)) throw new MemberError(400, `${label} is invalid.`);
  return cleaned;
}

function cleanData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const encoded = JSON.stringify(value);
  if (encoded.length > 40000 || UNSAFE.test(encoded)) throw new MemberError(400, "That RCM record is too large or contains unsupported characters.");
  return JSON.parse(encoded);
}

function recordJSON(row: typeof rcmRecords.$inferSelect) {
  return { id: row.id, kind: row.kind, title: row.title, status: row.status, relation_key: row.relationKey, data: row.data, due_at: row.dueAt?.toISOString() ?? null, updated_at: row.updatedAt.toISOString() };
}

export function createRcmWorkspaceHandler({ database = db, resolveMember = requireMember }: { database?: typeof db; resolveMember?: typeof requireMember } = {}) {
  const db = database;
  return async (req: Request): Promise<Response> => {
  try {
    const member = await resolveMember();
    if (req.method === "GET") {
      if (new URL(req.url).searchParams.get("view") === "money") {
        const records = await db.select().from(rcmRecords).where(and(eq(rcmRecords.memberId, member.id), eq(rcmRecords.kind, "royalty"))).orderBy(desc(rcmRecords.updatedAt));
        return memberJSON({ records: records.map(recordJSON) });
      }
      const [profileRows, records, messages] = await Promise.all([
        db.select().from(rcmProfiles).where(eq(rcmProfiles.memberId, member.id)).limit(1),
        db.select().from(rcmRecords).where(eq(rcmRecords.memberId, member.id)).orderBy(desc(rcmRecords.updatedAt)).limit(251),
        db.select().from(rcmAiMessages).where(eq(rcmAiMessages.memberId, member.id)).orderBy(desc(rcmAiMessages.createdAt)).limit(12),
      ]);
      const profile = profileRows[0] ?? { memberId: member.id, artistName: member.name, realName: "", roles: ["Artist"], genre: "", location: "", proAffiliation: "", distributor: "", managementStatus: "Independent", publishingStatus: "Needs review", onboardingComplete: false };
      return memberJSON({ profile, records: records.slice(0, 250).map(recordJSON), truncated: records.length > 250, messages: messages.reverse().map(row => ({ role: row.role, content: row.content, action: row.action })) });
    }
    if (req.method !== "POST") throw new MemberError(405, "That RCM action is not supported.");
    assertSameOrigin(req);
    const input = await req.json() as Record<string, unknown>;
    const action = text(input.action, 30, "Action", true);

    if (action === "profile") {
      const roles = Array.isArray(input.roles) ? input.roles.map(value => text(value, 40, "Role")).filter(Boolean).slice(0, 8) : [];
      const values = {
        memberId: member.id,
        artistName: text(input.artist_name, 100, "Artist name"), realName: text(input.real_name, 100, "Real name"), roles,
        genre: text(input.genre, 80, "Genre"), location: text(input.location, 100, "Location"), proAffiliation: text(input.pro_affiliation, 80, "PRO"),
        distributor: text(input.distributor, 100, "Distributor"), managementStatus: text(input.management_status, 80, "Management status"),
        publishingStatus: text(input.publishing_status, 80, "Publishing status"), onboardingComplete: Boolean(input.onboarding_complete), updatedAt: new Date(),
      };
      const [profile] = await db.insert(rcmProfiles).values(values).onConflictDoUpdate({ target: rcmProfiles.memberId, set: values }).returning();
      return memberJSON({ profile });
    }

    if (action === "record") {
      const kind = text(input.kind, 30, "Record type", true);
      if (!KINDS.has(kind)) throw new MemberError(400, "Choose a valid RCM record type.");
      const status = text(input.status || "draft", 30, "Status");
      if (!STATUSES.has(status)) throw new MemberError(400, "Choose a valid status.");
      const hasId = Object.hasOwn(input, "id");
      if (hasId && !((typeof input.id === "number" || (typeof input.id === "string" && /^[1-9]\d*$/.test(input.id))) && Number.isSafeInteger(Number(input.id)) && Number(input.id) > 0)) throw new MemberError(400, "Record ID must be a positive whole number.");
      const id = hasId ? Number(input.id) : null;
      const existing = id === null ? null : (await db.select().from(rcmRecords).where(and(eq(rcmRecords.id, id), eq(rcmRecords.memberId, member.id))).limit(1))[0];
      if (id !== null && !existing) throw new MemberError(404, "That RCM record was not found.");
      let data = cleanData(input.data);
      if (existing?.data?.record_type === "money-v1" && (kind !== "royalty" || data.record_type !== "money-v1")) throw new MemberError(400, "A money entry must stay a money entry.");
      if (data.record_type === "money-v1") {
        if (kind !== "royalty") throw new MemberError(400, "Money entries must use the royalty record type.");
        try { data = normalizeMoneyData(data); } catch (error) { throw new MemberError(400, error instanceof Error ? error.message : "That money entry is invalid."); }
      }
      const dueAt = input.due_at ? new Date(String(input.due_at)) : null;
      if (dueAt && Number.isNaN(dueAt.valueOf())) throw new MemberError(400, "Choose a valid due date.");
      const values = { kind, title: text(input.title, 180, "Title", true), status, relationKey: text(input.relation_key, 180, "Relationship"), data, dueAt, updatedAt: new Date() };
      if (id !== null && existing) {
        const [row] = await db.update(rcmRecords).set(values).where(and(eq(rcmRecords.id, id), eq(rcmRecords.memberId, member.id), eq(rcmRecords.updatedAt, existing.updatedAt))).returning();
        if (!row) throw new MemberError(409, "That record changed while you were saving. Refresh and try again.");
        return memberJSON({ record: recordJSON(row) });
      }
      const [row] = await db.insert(rcmRecords).values({ memberId: member.id, ...values }).returning();
      return memberJSON({ record: recordJSON(row) }, 201);
    }
    throw new MemberError(400, "Choose a valid RCM action.");
  } catch (error) {
    return memberFailure(error);
  }
  };
}

export default createRcmWorkspaceHandler();

export const config: Config = { path: "/api/rcm/workspace", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
