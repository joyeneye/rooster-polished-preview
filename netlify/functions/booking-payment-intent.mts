import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingAppointments, bookingBusinesses, bookingPayments, bookingPlatformSettings } from "../../db/schema.js";
import { assertBookingOrigin, bookingFailure, BookingError, bookingJSON, cleanText } from "./_shared/booking-auth.mts";

export default async function paymentIntent(req: Request): Promise<Response> {
  try {
    assertBookingOrigin(req);
    const input = await req.json();
    const publicId = cleanText(input.publicId, 80, true);
    const confirmationCode = cleanText(input.confirmationCode, 20, true).toUpperCase();
    const [row] = await db.select({ appointment: bookingAppointments, business: bookingBusinesses }).from(bookingAppointments)
      .innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingAppointments.businessId))
      .where(and(eq(bookingAppointments.publicId, publicId), eq(bookingAppointments.confirmationCode, confirmationCode))).limit(1);
    if (!row) throw new BookingError(404, "Booking not found.");
    if (row.appointment.status !== "pending_payment" || row.appointment.depositCents < 1) throw new BookingError(409, "This booking does not require a payment.");
    if (!row.business.stripeAccountId || !row.business.stripeChargesEnabled) throw new BookingError(409, "Online payments are not enabled for this provider.");
    const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!secretKey) throw new BookingError(503, "Payment processing is not configured.");
    const [setting] = await db.select().from(bookingPlatformSettings).where(eq(bookingPlatformSettings.key, "payments")).limit(1);
    const feeBasisPoints = Math.max(0, Math.min(5000, Number((setting?.value as Record<string, unknown> | undefined)?.platformFeeBasisPoints ?? 0)));
    const platformFeeCents = Math.round(row.appointment.depositCents * feeBasisPoints / 10_000);
    const form = new URLSearchParams({
      amount: String(row.appointment.depositCents),
      currency: row.business.currency,
      "automatic_payment_methods[enabled]": "true",
      application_fee_amount: String(platformFeeCents),
      "transfer_data[destination]": row.business.stripeAccountId,
      "metadata[appointment_id]": String(row.appointment.id),
      "metadata[business_id]": String(row.business.id),
      "metadata[confirmation_code]": row.appointment.confirmationCode,
    });
    const stripeResponse = await fetch("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const stripe = await stripeResponse.json() as Record<string, any>;
    if (!stripeResponse.ok || !stripe.id || !stripe.client_secret) throw new BookingError(502, stripe?.error?.message || "Payment processing could not start.");
    await db.insert(bookingPayments).values({ businessId: row.business.id, appointmentId: row.appointment.id, clientId: row.appointment.clientId, providerPaymentId: stripe.id, status: "pending", amountCents: row.appointment.depositCents, platformFeeCents, providerNetCents: row.appointment.depositCents - platformFeeCents, currency: row.business.currency, metadata: { confirmationCode: row.appointment.confirmationCode } });
    return bookingJSON({ clientSecret: stripe.client_secret, amountCents: row.appointment.depositCents, currency: row.business.currency, publishableKey: Netlify.env.get("STRIPE_PUBLISHABLE_KEY") ?? "" });
  } catch (error) { return bookingFailure(error); }
}

export const config: Config = { path: "/api/booking/payment-intent", method: "POST", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
