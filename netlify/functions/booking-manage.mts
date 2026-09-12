import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingAppointments, bookingBusinesses, bookingClients, bookingNotifications, bookingServices, bookingStaff } from "../../db/schema.js";
import { assertBookingOrigin, bookingFailure, BookingError, bookingJSON, cleanText } from "./_shared/booking-auth.mts";
import { assertSlotAvailable } from "./_shared/booking-availability.mts";

async function findBooking(publicId: string, confirmationCode: string) {
  const [row] = await db.select({ appointment: bookingAppointments, business: bookingBusinesses, service: bookingServices, staff: bookingStaff, client: bookingClients }).from(bookingAppointments)
    .innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingAppointments.businessId))
    .innerJoin(bookingServices, and(eq(bookingServices.id, bookingAppointments.serviceId), eq(bookingServices.businessId, bookingAppointments.businessId)))
    .innerJoin(bookingStaff, and(eq(bookingStaff.id, bookingAppointments.staffId), eq(bookingStaff.businessId, bookingAppointments.businessId)))
    .innerJoin(bookingClients, and(eq(bookingClients.id, bookingAppointments.clientId), eq(bookingClients.businessId, bookingAppointments.businessId)))
    .where(and(eq(bookingAppointments.publicId, publicId), eq(bookingAppointments.confirmationCode, confirmationCode))).limit(1);
  if (!row) throw new BookingError(404, "Booking not found.");
  return row;
}

export default async function manageBooking(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") assertBookingOrigin(req);
    const input = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await req.json();
    const publicId = cleanText(input.publicId, 80, true);
    const confirmationCode = cleanText(input.confirmationCode, 20, true).toUpperCase();
    const row = await findBooking(publicId, confirmationCode);
    if (req.method === "GET") return bookingJSON({ appointment: { publicId: row.appointment.publicId, confirmationCode: row.appointment.confirmationCode, status: row.appointment.status, startsAt: row.appointment.startsAt, endsAt: row.appointment.endsAt, priceCents: row.appointment.priceCents, depositCents: row.appointment.depositCents }, business: row.business, service: row.service, staff: row.staff, client: { name: row.client.name, email: row.client.email, phone: row.client.phone } });
    if (row.appointment.status === "completed" || row.appointment.status === "cancelled") throw new BookingError(409, "This booking can no longer be changed.");
    if (input.action === "cancel") {
      await db.update(bookingAppointments).set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: cleanText(input.reason, 500), updatedAt: new Date() }).where(and(eq(bookingAppointments.id, row.appointment.id), eq(bookingAppointments.businessId, row.business.id)));
      await db.insert(bookingNotifications).values({ businessId: row.business.id, appointmentId: row.appointment.id, channel: "in_app", template: "booking_cancelled", recipient: String(row.business.ownerUserId), subject: "Booking cancelled", body: `${row.client.name} cancelled an appointment.`, data: { confirmationCode } });
      return bookingJSON({ status: "cancelled" });
    }
    if (input.action === "reschedule") {
      const startsAt = new Date(input.startsAt);
      if (!Number.isFinite(startsAt.getTime())) throw new BookingError(400, "Choose a valid appointment time.");
      const staffId = input.staffId ? Number(input.staffId) : row.staff.id;
      const slot = await assertSlotAvailable({ businessId: row.business.id, serviceId: row.service.id, staffId, startsAt, timezone: row.business.timezone, excludeAppointmentId: row.appointment.id });
      await db.update(bookingAppointments).set({ staffId, startsAt, endsAt: slot.endsAt, updatedAt: new Date() }).where(and(eq(bookingAppointments.id, row.appointment.id), eq(bookingAppointments.businessId, row.business.id)));
      return bookingJSON({ status: row.appointment.status, startsAt, endsAt: slot.endsAt });
    }
    throw new BookingError(400, "Choose cancel or reschedule.");
  } catch (error) { return bookingFailure(error); }
}

export const config: Config = { path: "/api/booking/manage", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
