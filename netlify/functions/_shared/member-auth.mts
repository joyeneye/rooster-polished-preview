import { getUser, type User } from "@netlify/identity";

export type Member = { id: string; name: string };
export type MemberResolver = () => Promise<Member>;
export const MEMBER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class MemberError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function memberJSON(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "Netlify-CDN-Cache-Control": "no-store",
      "Vary": "Cookie, Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function memberFailure(error?: unknown): Response {
  return error instanceof MemberError
    ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "Your messages could not connect. Please try again in a moment." }, 503);
}

export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if ((req.method === "POST" && !origin) ||
      (origin && origin !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new MemberError(403, "Please open your messages from this website.");
  }
}

export async function requireMember(loadUser: () => Promise<User | null> = getUser): Promise<Member> {
  // The supported Identity v2 API reads the runtime nf_jwt cookie and asks
  // Identity /user to verify it. Never decode a supplied JWT or trust a user ID.
  const user = await loadUser();
  if (!user || !MEMBER_ID.test(user.id)) {
    throw new MemberError(401, "Please log in to open your messages.");
  }
  // confirmedAt is returned by Identity /user, but NOT by getUser's fallback
  // to JWT claims. Requiring it also fails closed if Identity is unreachable.
  if (!user.confirmedAt || !Number.isFinite(Date.parse(user.confirmedAt))) {
    throw new MemberError(403, "Please confirm your email before using messages.");
  }
  const id = user.id.toLowerCase();
  const suppliedName = typeof user.name === "string" ? user.name.trim().replace(/\s+/g, " ") : "";
  const name = suppliedName && !/[\u0000-\u001f\u007f@]/.test(suppliedName)
    ? suppliedName.slice(0, 60)
    : `Member ${id.slice(0, 8)}`;
  // Email, roles, tokens and other account metadata never enter the directory.
  return { id, name };
}
