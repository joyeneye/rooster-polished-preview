import type { Config } from "@netlify/functions";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingAppointments, bookingNotifications, bookingPayments } from "../../db/schema.js";
import { bookingBusinesses } from "../../db/schema.js";

function validSignature(payload: string, header: string, secret: string): boolean {
  const fields = Object.fromEntries(header.split(",").map(part => part.split("=", 2)));
  const timestamp = fields.t;
  const signature = fields.v1;
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function stripeWebhook(req: Request): Promise<Response> {
  const secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  const signature = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text();
  if (!secret || !validSignature(payload, signature, secret)) return new Response("Invalid signature", { status: 401 });
  const event = JSON.parse(payload) as Record<string, any>;
  const object = event?.data?.object;
  if (!object?.id) return new Response("ok");
  if (event.type === "account.updated") {
    await db.update(bookingBusinesses).set({ stripeChargesEnabled: Boolean(object.charges_enabled && object.payouts_enabled), updatedAt: new Date() }).where(eq(bookingBusinesses.stripeAccountId, object.id));
    return new Response("ok");
  }
  const providerPaymentId = event.type === "charge.refunded" ? object.payment_intent : object.id;
  const [payment] = await db.select().from(bookingPayments).where(eq(bookingPayments.providerPaymentId, providerPaymentId)).limit(1);
  if (!payment) return new Response("ok");
  if (event.type === "payment_intent.succeeded") {
    await db.transaction(async tx => {
      await tx.update(bookingPayments).set({ status: "succeeded", updatedAt: new Date() }).where(and(eq(bookingPayments.id, payment.id), eq(bookingPayments.businessId, payment.businessId)));
      if (payment.appointmentId) {
        const [appointment] = await tx.update(bookingAppointments).set({ status: "confirmed", updatedAt: new Date() }).where(and(eq(bookingAppointments.id, payment.appointmentId), eq(bookingAppointments.businessId, payment.businessId), eq(bookingAppointments.status, "pending_payment"))).returning();
        if (appointment) await tx.insert(bookingNotifications).values({ businessId: payment.businessId, appointmentId: appointment.id, channel: "in_app", template: "payment_received", recipient: String(payment.businessId), subject: "Payment received", body: "A booking deposit was paid.", data: { amountCents: payment.amountCents } });
      }
    });
  }
  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") await db.update(bookingPayments).set({ status: event.type.endsWith("canceled") ? "cancelled" : "failed", updatedAt: new Date() }).where(and(eq(bookingPayments.id, payment.id), eq(bookingPayments.businessId, payment.businessId)));
  if (event.type === "charge.refunded") await db.update(bookingPayments).set({ status: "refunded", updatedAt: new Date() }).where(and(eq(bookingPayments.providerPaymentId, providerPaymentId), eq(bookingPayments.businessId, payment.businessId)));
  return new Response("ok");
}

export const config: Config = { path: "/api/booking/stripe-webhook", method: "POST" };
