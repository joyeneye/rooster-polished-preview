import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingBusinesses } from "../../db/schema.js";
import { assertBookingOrigin, bookingFailure, BookingError, bookingJSON, numberParam, requireBusinessAccess } from "./_shared/booking-auth.mts";

async function stripeRequest(path: string, form: URLSearchParams, secret: string): Promise<Record<string, any>> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const data = await response.json() as Record<string, any>;
  if (!response.ok) throw new BookingError(502, data?.error?.message || "Stripe onboarding could not start.");
  return data;
}

export default async function stripeConnect(req: Request): Promise<Response> {
  try {
    assertBookingOrigin(req);
    const input = await req.json();
    const businessId = numberParam(input.businessId, "Business");
    const access = await requireBusinessAccess(businessId, ["owner"]);
    const secret = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!secret) throw new BookingError(503, "Stripe Connect is not configured.");
    let accountId = access.business.stripeAccountId;
    if (!accountId) {
      const account = await stripeRequest("accounts", new URLSearchParams({ type: "express", country: access.business.country, email: access.business.email || access.user.email, "capabilities[card_payments][requested]": "true", "capabilities[transfers][requested]": "true", "metadata[business_id]": String(businessId) }), secret);
      accountId = account.id;
      await db.update(bookingBusinesses).set({ stripeAccountId: accountId, updatedAt: new Date() }).where(eq(bookingBusinesses.id, businessId));
    }
    const origin = new URL(req.url).origin;
    const link = await stripeRequest("account_links", new URLSearchParams({ account: accountId, refresh_url: `${origin}/booking/dashboard#settings`, return_url: `${origin}/booking/dashboard#settings`, type: "account_onboarding" }), secret);
    return bookingJSON({ url: link.url });
  } catch (error) { return bookingFailure(error); }
}

export const config: Config = { path: "/api/booking/stripe-connect", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
