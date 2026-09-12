import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { bookingAppointments, bookingAvailabilityBlocks, bookingAvailabilityRules, bookingBusinessHours, bookingServices, bookingStaff, bookingStaffServices } from "../../../db/schema.js";
import { BookingError } from "./booking-auth.mts";

const ACTIVE_APPOINTMENT_STATUSES = ["pending_payment", "confirmed", "checked_in"];

function dateParts(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}

function zonedToUtc(date: string, minute: number, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const hour = Math.floor(minute / 60);
  const localMinute = minute % 60;
  let estimate = Date.UTC(year, month - 1, day, hour, localMinute, 0);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = dateParts(new Date(estimate), timeZone);
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    estimate += Date.UTC(year, month - 1, day, hour, localMinute, 0) - rendered;
  }
  return new Date(estimate);
}

function weekdayFor(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

export type AvailabilitySlot = { startsAt: string; endsAt: string; staffId: number; staffName: string };

export async function availableSlots(input: {
  businessId: number;
  serviceId: number;
  staffId?: number;
  date: string;
  timezone: string;
  slotInterval?: number;
  excludeAppointmentId?: number;
}): Promise<AvailabilitySlot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new BookingError(400, "Choose a valid date.");
  const [service] = await db.select().from(bookingServices).where(and(eq(bookingServices.id, input.serviceId), eq(bookingServices.businessId, input.businessId), eq(bookingServices.active, true), eq(bookingServices.onlineBookingEnabled, true))).limit(1);
  if (!service) throw new BookingError(404, "Service not found.");
  let staffRows = await db.select({ id: bookingStaff.id, name: bookingStaff.name }).from(bookingStaff)
    .innerJoin(bookingStaffServices, and(eq(bookingStaffServices.staffId, bookingStaff.id), eq(bookingStaffServices.serviceId, service.id), eq(bookingStaffServices.businessId, input.businessId)))
    .where(and(eq(bookingStaff.businessId, input.businessId), eq(bookingStaff.active, true)));
  if (input.staffId) staffRows = staffRows.filter(staff => staff.id === input.staffId);
  if (!staffRows.length) return [];
  const weekday = weekdayFor(input.date);
  const [businessHours] = await db.select().from(bookingBusinessHours).where(and(eq(bookingBusinessHours.businessId, input.businessId), eq(bookingBusinessHours.weekday, weekday))).limit(1);
  if (!businessHours || businessHours.closed) return [];
  const dayStart = zonedToUtc(input.date, 0, input.timezone);
  const dayEnd = zonedToUtc(input.date, 24 * 60, input.timezone);
  const staffIds = new Set(staffRows.map(staff => staff.id));
  const rules = await db.select().from(bookingAvailabilityRules).where(and(eq(bookingAvailabilityRules.businessId, input.businessId), eq(bookingAvailabilityRules.weekday, weekday), eq(bookingAvailabilityRules.active, true)));
  const blocks = (await db.select().from(bookingAvailabilityBlocks).where(and(eq(bookingAvailabilityBlocks.businessId, input.businessId), lt(bookingAvailabilityBlocks.startsAt, dayEnd), gt(bookingAvailabilityBlocks.endsAt, dayStart)))).filter(block => !block.staffId || staffIds.has(block.staffId));
  const appointments = (await db.select().from(bookingAppointments).where(and(eq(bookingAppointments.businessId, input.businessId), lt(bookingAppointments.startsAt, dayEnd), gt(bookingAppointments.endsAt, dayStart), ne(bookingAppointments.status, "cancelled")))).filter(appointment => appointment.id !== input.excludeAppointmentId && ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status) && staffIds.has(appointment.staffId));
  const now = new Date();
  const interval = Math.max(5, Math.min(60, input.slotInterval ?? 15));
  const slots: AvailabilitySlot[] = [];
  for (const staff of staffRows) {
    const staffRules = rules.filter(rule => rule.staffId === staff.id);
    const businessRules = rules.filter(rule => rule.staffId === null);
    const windows = staffRules.length ? staffRules : businessRules.length ? businessRules : [{ startMinute: businessHours.startMinute, endMinute: businessHours.endMinute }];
    for (const window of windows) {
      const windowStart = Math.max(window.startMinute, businessHours.startMinute);
      const windowEnd = Math.min(window.endMinute, businessHours.endMinute);
      for (let minute = windowStart; minute + service.durationMinutes <= windowEnd; minute += interval) {
        const startsAt = zonedToUtc(input.date, minute, input.timezone);
        const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
        const occupiedStart = new Date(startsAt.getTime() - service.bufferBeforeMinutes * 60_000);
        const occupiedEnd = new Date(endsAt.getTime() + service.bufferAfterMinutes * 60_000);
        if (startsAt <= now) continue;
        if (blocks.some(block => (!block.staffId || block.staffId === staff.id) && overlaps(occupiedStart, occupiedEnd, block.startsAt, block.endsAt))) continue;
        if (appointments.some(appointment => appointment.staffId === staff.id && overlaps(occupiedStart, occupiedEnd, appointment.startsAt, appointment.endsAt))) continue;
        slots.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), staffId: staff.id, staffName: staff.name });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.staffId - b.staffId);
}

export async function assertSlotAvailable(input: { businessId: number; serviceId: number; staffId: number; startsAt: Date; timezone: string; excludeAppointmentId?: number }): Promise<{ endsAt: Date; priceCents: number; depositCents: number }> {
  const local = dateParts(input.startsAt, input.timezone);
  const date = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
  const slots = await availableSlots({ businessId: input.businessId, serviceId: input.serviceId, staffId: input.staffId, date, timezone: input.timezone, excludeAppointmentId: input.excludeAppointmentId });
  const slot = slots.find(candidate => candidate.startsAt === input.startsAt.toISOString());
  if (!slot) throw new BookingError(409, "That appointment time is no longer available.");
  const [service] = await db.select().from(bookingServices).where(eq(bookingServices.id, input.serviceId)).limit(1);
  if (!service) throw new BookingError(404, "Service not found.");
  const depositCents = service.depositType === "fixed" ? service.depositValue : service.depositType === "percent" ? Math.round(service.priceCents * service.depositValue / 100) : 0;
  return { endsAt: new Date(slot.endsAt), priceCents: service.priceCents, depositCents };
}
