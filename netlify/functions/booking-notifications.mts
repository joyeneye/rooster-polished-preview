import type { Config } from "@netlify/functions";
import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingNotifications } from "../../db/schema.js";

async function deliver(url: string, notification: typeof bookingNotifications.$inferSelect, secret: string): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ to: notification.recipient, subject: notification.subject, body: notification.body, template: notification.template, data: notification.data }) });
  if (!response.ok) throw new Error(`notification_provider_${response.status}`);
}

export default async function dispatchNotifications(): Promise<Response> {
  const pending = await db.select().from(bookingNotifications).where(and(eq(bookingNotifications.status, "pending"), lte(bookingNotifications.scheduledFor, new Date()))).orderBy(asc(bookingNotifications.scheduledFor)).limit(50);
  const emailUrl = Netlify.env.get("BOOKING_EMAIL_WEBHOOK_URL") ?? "";
  const smsUrl = Netlify.env.get("BOOKING_SMS_WEBHOOK_URL") ?? "";
  const secret = Netlify.env.get("BOOKING_NOTIFICATION_WEBHOOK_SECRET") ?? "";
  for (const notification of pending) {
    try {
      if (notification.channel === "email") {
        if (!emailUrl) continue;
        await deliver(emailUrl, notification, secret);
      } else if (notification.channel === "sms") {
        if (!smsUrl) continue;
        await deliver(smsUrl, notification, secret);
      }
      await db.update(bookingNotifications).set({ status: "sent", sentAt: new Date(), attempts: notification.attempts + 1 }).where(eq(bookingNotifications.id, notification.id));
    } catch (error) {
      console.error("booking_notification_delivery_failed", notification.id, error);
      await db.update(bookingNotifications).set({ status: notification.attempts >= 4 ? "failed" : "pending", attempts: notification.attempts + 1 }).where(eq(bookingNotifications.id, notification.id));
    }
  }
  return new Response(JSON.stringify({ processed: pending.length }), { headers: { "Content-Type": "application/json" } });
}

export const config: Config = { schedule: "*/5 * * * *" };
