import type { Config } from "@netlify/functions";
import { accessFailure, accessStateForVisitor } from "./_shared/roster-access.mts";

/** What the landing page, the signup screen and every members page ask first:
 * is this visitor invited and approved? Open to anybody, including somebody
 * with no account at all, because the honest answer for them is "no". */
export default async (): Promise<Response> => {
  try {
    return new Response(JSON.stringify(await accessStateForVisitor()), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Netlify-CDN-Cache-Control": "no-store",
        "Vary": "Cookie, Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return accessFailure(error);
  }
};

export const config: Config = {
  path: "/api/access/state",
  method: "GET",
  rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
