import type { Config } from "@netlify/functions";
import { count, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { rosterAccess } from "../../db/schema.js";

export default async function memberCount(): Promise<Response> {
  try {
    const [row] = await db.select({ value: count() }).from(rosterAccess).where(eq(rosterAccess.status, "approved"));
    const claimed = Math.max(0, Math.min(500, Number(row?.value ?? 0)));
    return Response.json({ claimed, goal: 500 }, { headers: {
      "Cache-Control": "public, max-age=30",
      "Netlify-CDN-Cache-Control": "public, durable, s-maxage=30, stale-while-revalidate=120",
      "X-Content-Type-Options": "nosniff",
    }});
  } catch {
    return Response.json({ error: "Count unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export const config: Config = { path: "/api/member-count", method: "GET", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
