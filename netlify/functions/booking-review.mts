import type { Config } from "@netlify/functions";
import { and, avg, count, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingAppointments, bookingBusinesses, bookingReviews } from "../../db/schema.js";
import { assertBookingOrigin, bookingFailure, BookingError, bookingJSON, cleanText } from "./_shared/booking-auth.mts";

export default async function review(req: Request): Promise<Response> {
  try {
    assertBookingOrigin(req);
    const input = await req.json();
    const publicId = cleanText(input.publicId, 80, true);
    const confirmationCode = cleanText(input.confirmationCode, 20, true).toUpperCase();
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new BookingError(400, "Choose a rating from one to five.");
    const [appointment] = await db.select().from(bookingAppointments).where(and(eq(bookingAppointments.publicId, publicId), eq(bookingAppointments.confirmationCode, confirmationCode), eq(bookingAppointments.status, "completed"))).limit(1);
    if (!appointment) throw new BookingError(403, "Only completed, verified bookings can be reviewed.");
    await db.transaction(async tx => {
      await tx.insert(bookingReviews).values({ businessId: appointment.businessId, appointmentId: appointment.id, clientId: appointment.clientId, rating, body: cleanText(input.body, 2000), photos: Array.isArray(input.photos) ? input.photos.slice(0, 5).map((value: unknown) => cleanText(value, 1000)) : [] });
      const [summary] = await tx.select({ average: avg(bookingReviews.rating), total: count() }).from(bookingReviews).where(and(eq(bookingReviews.businessId, appointment.businessId), eq(bookingReviews.status, "published")));
      await tx.update(bookingBusinesses).set({ averageRating: Math.round(Number(summary?.average ?? rating) * 100), reviewCount: Number(summary?.total ?? 1), updatedAt: new Date() }).where(eq(bookingBusinesses.id, appointment.businessId));
    });
    return bookingJSON({ created: true }, 201);
  } catch (error) { return bookingFailure(error); }
}

export const config: Config = { path: "/api/booking/review", method: "POST", rateLimit: { windowLimit: 10, windowSize: 3600, aggregateBy: ["ip", "domain"] } };
