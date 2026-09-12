import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { rcmRecords } from "../../db/schema.js";
import { assertSameOrigin, MemberError, memberFailure, memberJSON, requireMember } from "./_shared/member-auth.mts";

const store = getStore("rcm-private-files");
const MAX_FILE_SIZE = 8 * 1024 * 1024;

function safeName(value: string): string {
  const name = value.trim().replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").slice(0, 160);
  return name || "RCM file";
}

export default async (req: Request): Promise<Response> => {
  try {
    const member = await requireMember();
    if (req.method === "POST") {
      assertSameOrigin(req);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > MAX_FILE_SIZE) throw new MemberError(400, "Choose a file smaller than 8 MB.");
      const name = safeName(file.name);
      const key = `${member.id}/${crypto.randomUUID()}/${name}`;
      await store.set(key, file, { metadata: { contentType: file.type || "application/octet-stream", originalName: name } });
      const [record] = await db.insert(rcmRecords).values({
        memberId: member.id, kind: "file", title: name, status: "completed", relationKey: String(form.get("relation_key") ?? "").slice(0, 180),
        data: { blobKey: key, contentType: file.type || "application/octet-stream", size: file.size },
      }).returning();
      return memberJSON({ record: { id: record.id, kind: record.kind, title: record.title, status: record.status, relation_key: record.relationKey, data: record.data, due_at: null, updated_at: record.updatedAt.toISOString() } }, 201);
    }
    if (req.method === "GET") {
      const id = Number(new URL(req.url).searchParams.get("id"));
      if (!Number.isSafeInteger(id) || id < 1) throw new MemberError(400, "Choose a valid RCM file.");
      const [record] = await db.select().from(rcmRecords).where(and(eq(rcmRecords.id, id), eq(rcmRecords.memberId, member.id), eq(rcmRecords.kind, "file"))).limit(1);
      const key = record?.data?.blobKey;
      if (!record || typeof key !== "string") throw new MemberError(404, "That RCM file was not found.");
      const file = await store.get(key, { type: "blob" });
      if (!(file instanceof Blob)) throw new MemberError(404, "That RCM file was not found.");
      return new Response(file, { headers: { "Content-Type": String(record.data.contentType || file.type || "application/octet-stream"), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.title)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    throw new MemberError(405, "That file action is not supported.");
  } catch (error) { return memberFailure(error); }
};

export const config: Config = { path: "/api/rcm/file", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
