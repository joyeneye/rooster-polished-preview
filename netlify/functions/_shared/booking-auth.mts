import { and, eq } from "drizzle-orm";
import { getUser, type User } from "@netlify/identity";
import { db } from "../../../db/index.js";
import { bookingBusinessMembers, bookingBusinesses, bookingPlatformUsers } from "../../../db/schema.js";

export class BookingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function bookingJSON(value: unknown, status = 200): Response {
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

export function publicBookingJSON(value: unknown, status = 200, maxAge = 60): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      "Netlify-CDN-Cache-Control": `public, durable, max-age=${maxAge}, stale-while-revalidate=300`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function bookingFailure(error: unknown): Response {
  if (error instanceof BookingError) return bookingJSON({ error: error.message }, error.status);
  console.error("booking_platform_error", error);
  return bookingJSON({ error: "The booking platform could not complete this request." }, 503);
}

export function assertBookingOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if ((req.method !== "GET" && !origin) || (origin && origin !== new URL(req.url).origin) || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new BookingError(403, "Open this action from the booking platform.");
  }
}

function normalizedName(user: User): string {
  const value = typeof user.name === "string" ? user.name.trim().replace(/\s+/g, " ") : "";
  return value && !/[\u0000-\u001f\u007f]/.test(value) ? value.slice(0, 80) : "Booking member";
}

function configuredAdmins(): Set<string> {
  const entries = `${Netlify.env.get("BOOKING_ADMIN_USER_IDS") ?? ""},${Netlify.env.get("BOOKING_ADMIN_EMAILS") ?? ""}`;
  return new Set(entries.split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
}

export type BookingUser = typeof bookingPlatformUsers.$inferSelect;

export async function requireBookingUser(loadUser: () => Promise<User | null> = getUser): Promise<BookingUser> {
  const identity = await loadUser();
  if (!identity?.id) throw new BookingError(401, "Sign in to continue.");
  if (!identity.confirmedAt || !Number.isFinite(Date.parse(identity.confirmedAt))) throw new BookingError(403, "Confirm your email to continue.");
  const identityUserId = identity.id.toLowerCase();
  const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
  const admins = configuredAdmins();
  const configuredAdmin = admins.has(identityUserId) || (email && admins.has(email));
  await db.insert(bookingPlatformUsers).values({
    identityUserId,
    email,
    displayName: normalizedName(identity),
    platformRole: configuredAdmin ? "admin" : "user",
  }).onConflictDoUpdate({
    target: bookingPlatformUsers.identityUserId,
    set: {
      email,
      displayName: normalizedName(identity),
      ...(configuredAdmin ? { platformRole: "admin" } : {}),
      updatedAt: new Date(),
    },
  });
  const [user] = await db.select().from(bookingPlatformUsers).where(eq(bookingPlatformUsers.identityUserId, identityUserId)).limit(1);
  if (!user || user.status !== "active") throw new BookingError(403, "This booking account is not active.");
  return user;
}

export async function requirePlatformAdmin(): Promise<BookingUser> {
  const user = await requireBookingUser();
  if (user.platformRole !== "admin") throw new BookingError(403, "Platform administrator access is required.");
  return user;
}

export type BusinessAccess = {
  user: BookingUser;
  business: typeof bookingBusinesses.$inferSelect;
  role: string;
  permissions: string[];
};

export async function requireBusinessAccess(businessId: number, allowedRoles: string[] = []): Promise<BusinessAccess> {
  if (!Number.isInteger(businessId) || businessId < 1) throw new BookingError(400, "A valid business is required.");
  const user = await requireBookingUser();
  const [business] = await db.select().from(bookingBusinesses).where(eq(bookingBusinesses.id, businessId)).limit(1);
  if (!business) throw new BookingError(404, "Business not found.");
  if (user.platformRole === "admin") return { user, business, role: "platform_admin", permissions: ["*"] };
  if (business.ownerUserId === user.id) return { user, business, role: "owner", permissions: ["*"] };
  const [membership] = await db.select().from(bookingBusinessMembers).where(and(
    eq(bookingBusinessMembers.businessId, businessId),
    eq(bookingBusinessMembers.userId, user.id),
    eq(bookingBusinessMembers.status, "active"),
  )).limit(1);
  if (!membership) throw new BookingError(403, "You do not have access to this business.");
  if (allowedRoles.length && !allowedRoles.includes(membership.role)) throw new BookingError(403, "Your business role cannot perform this action.");
  return { user, business, role: membership.role, permissions: membership.permissions as string[] };
}

export function numberParam(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BookingError(400, `${label} is invalid.`);
  return parsed;
}

export function cleanText(value: unknown, max: number, required = false): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (required && !text) throw new BookingError(400, "Complete all required fields.");
  if (text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new BookingError(400, "One or more fields are invalid.");
  return text;
}

export function slugify(value: unknown): string {
  const slug = String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  if (slug.length < 3) throw new BookingError(400, "Choose a business name with at least three letters or numbers.");
  return slug;
}
