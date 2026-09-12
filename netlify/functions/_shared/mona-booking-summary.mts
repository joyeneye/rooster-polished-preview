import { and, asc, count, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { bookingAppointments, bookingBusinesses, bookingPayments, bookingPlatformSettings, bookingServices } from '../../../db/schema.js';
import { assertSameOrigin, MemberError, memberJSON, type Member } from './member-auth.mts';
import { requireCommunityMember } from './roster-access.mts';
import { BookingError, requireBookingUser } from './booking-auth.mts';

type Period = { from: Date; to: Date };
type PaymentStatus = 'not_connected' | 'setup_pending' | 'enabled_on_record';
type Business = { id: number; name: string; slug: string; published: boolean; status: string; currency: string; paymentStatus: PaymentStatus };
type Amount = { currency: string; amountCents: number | string | null };
type Upcoming = { id: number; businessId: number; businessName: string; serviceName: string; startsAt: Date | string; status: string; priceCents: number; currency: string };
export type MonaBookingRepository = {
  businesses(ownerId: number): Promise<Business[]>;
  paymentSettings(): Promise<Record<string, unknown> | null>;
  services(ownerId: number): Promise<{ businessId: number; value: number }[]>;
  upcoming(ownerId: number, period: Period): Promise<Upcoming[]>;
  booked(ownerId: number, period: Period): Promise<(Amount & { value: number })[]>;
  payments(ownerId: number, period: Period): Promise<Amount[]>;
  pending(ownerId: number, period: Period): Promise<number>;
};

const confirmed = ['confirmed', 'checked_in'];
const upcomingLimit = 12;

/** Every query rechecks the verified owner. Membership/admin roles and client
 * supplied IDs cannot widen this private financial summary. */
export function createMonaBookingRepository(database: typeof db = db): MonaBookingRepository {
  const appointmentScope = (ownerId: number, period: Period, statuses: string[]) => and(
    eq(bookingBusinesses.ownerUserId, ownerId),
    inArray(bookingAppointments.status, statuses),
    gte(bookingAppointments.startsAt, period.from),
    lt(bookingAppointments.startsAt, period.to),
  );
  return {
    async businesses(ownerId) {
      return database.select({ id: bookingBusinesses.id, name: bookingBusinesses.name, slug: bookingBusinesses.slug, published: bookingBusinesses.published, status: bookingBusinesses.status, currency: bookingBusinesses.currency,
        // Only return the recorded setup state, never the connected account ID.
        // This does not verify processor availability or funds/payout readiness.
        paymentStatus: sql<PaymentStatus>`case when length(trim(${bookingBusinesses.stripeAccountId})) = 0 then 'not_connected' when ${bookingBusinesses.stripeChargesEnabled} = true then 'enabled_on_record' else 'setup_pending' end`,
      })
        .from(bookingBusinesses).where(eq(bookingBusinesses.ownerUserId, ownerId)).orderBy(asc(bookingBusinesses.createdAt));
    },
    async paymentSettings() {
      const [row] = await database.select({ value: bookingPlatformSettings.value }).from(bookingPlatformSettings)
        .where(eq(bookingPlatformSettings.key, 'payments')).limit(1);
      return row?.value ?? null;
    },
    async services(ownerId) {
      return database.select({ businessId: bookingServices.businessId, value: count() }).from(bookingServices)
        .innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingServices.businessId))
        .where(and(eq(bookingBusinesses.ownerUserId, ownerId), eq(bookingServices.active, true), eq(bookingServices.onlineBookingEnabled, true)))
        .groupBy(bookingServices.businessId);
    },
    async upcoming(ownerId, period) {
      return database.select({ id: bookingAppointments.id, businessId: bookingBusinesses.id, businessName: bookingBusinesses.name, serviceName: bookingServices.name, startsAt: bookingAppointments.startsAt, status: bookingAppointments.status, priceCents: bookingAppointments.priceCents, currency: bookingBusinesses.currency })
        .from(bookingAppointments).innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingAppointments.businessId))
        .innerJoin(bookingServices, and(eq(bookingServices.id, bookingAppointments.serviceId), eq(bookingServices.businessId, bookingBusinesses.id)))
        .where(appointmentScope(ownerId, period, confirmed)).orderBy(asc(bookingAppointments.startsAt), asc(bookingAppointments.id)).limit(upcomingLimit);
    },
    async booked(ownerId, period) {
      return database.select({ currency: bookingBusinesses.currency, amountCents: sum(bookingAppointments.priceCents), value: count() })
        .from(bookingAppointments).innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingAppointments.businessId))
        .where(appointmentScope(ownerId, period, confirmed)).groupBy(bookingBusinesses.currency);
    },
    async payments(ownerId, period) {
      return database.select({ currency: bookingPayments.currency, amountCents: sum(bookingPayments.amountCents) })
        .from(bookingPayments).innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingPayments.businessId))
        .where(and(eq(bookingBusinesses.ownerUserId, ownerId), eq(bookingPayments.status, 'succeeded'), eq(bookingPayments.kind, 'charge'), gte(bookingPayments.createdAt, period.from), lt(bookingPayments.createdAt, period.to)))
        .groupBy(bookingPayments.currency);
    },
    async pending(ownerId, period) {
      const [row] = await database.select({ value: count() }).from(bookingAppointments)
        .innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingAppointments.businessId))
        .where(appointmentScope(ownerId, period, ['pending_payment']));
      return Number(row?.value ?? 0);
    },
  };
}

function nonnegativeInteger(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid booking amount');
  return number;
}
function currencyCode(value: unknown): string {
  const currency = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid booking currency');
  return currency;
}
export function combineMonaAmounts(rows: Amount[]): { currency: string; amountCents: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const currency = currencyCode(row.currency);
    totals.set(currency, nonnegativeInteger((totals.get(currency) ?? 0) + nonnegativeInteger(row.amountCents)));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountCents]) => ({ currency, amountCents }));
}

function paymentInfo(settings: Record<string, unknown> | null) {
  const raw = settings?.platformFeeBasisPoints;
  // Match the existing payment-intent route's 0–5000 clamp and absent-value
  // default. Malformed configuration must not masquerade as a zero fee.
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value)) throw new Error('Invalid platform payment fee');
  return {
    feeBasisPoints: Math.max(0, Math.min(5000, value)),
    feeConfigured: raw !== undefined && raw !== null,
    feeAppliesTo: 'connected_booking_charge' as const,
  };
}

type Dependencies = {
  resolveMember?: () => Promise<Member>;
  resolveBookingUser?: () => Promise<{ id: number; identityUserId: string }>;
  repository?: MonaBookingRepository;
  now?: () => Date;
};

export async function getMonaBookings(req: Request, dependencies: Dependencies = {}): Promise<Response> {
  if (req.method !== 'GET') return memberJSON({ error: 'Method not allowed.' }, 405);
  try {
    assertSameOrigin(req);
    const member = await (dependencies.resolveMember ?? requireCommunityMember)();
    const account = await (dependencies.resolveBookingUser ?? requireBookingUser)();
    if (account.identityUserId.toLowerCase() !== member.id.toLowerCase() || !Number.isSafeInteger(account.id) || account.id < 1) {
      throw new MemberError(403, 'Your booking account could not be verified. Please log in again.');
    }
    const now = new Date((dependencies.now ?? (() => new Date()))());
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid summary time');
    const period = { from: now, to: new Date(now.getTime() + 30 * 86400_000) };
    const paymentPeriod = { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
    const repository = dependencies.repository ?? createMonaBookingRepository();
    const [businesses, settings] = await Promise.all([repository.businesses(account.id), repository.paymentSettings()]);
    const base = {
      memberId: member.id,
      paymentInfo: paymentInfo(settings),
      period: { from: period.from.toISOString(), to: period.to.toISOString(), label: 'Next 30 days', endExclusive: true },
      paymentPeriod: { from: paymentPeriod.from.toISOString(), to: paymentPeriod.to.toISOString(), label: 'Current UTC month to date', endExclusive: true },
      summaryNote: 'Booked value is the quoted price of confirmed appointments in the next 30 days, not money received. Recorded payments are successful charges recorded this UTC month, including deposits, before fees; they are not profit or a bank balance. Refunds and payments recorded elsewhere are not included.',
    };
    if (!businesses.length) return memberJSON({ ...base, businesses: [], upcoming: [], upcomingCount: 0, upcomingLimit, recordedPayments: [], bookedValue: [], pendingCount: 0 });
    const [services, upcoming, booked, payments, pending] = await Promise.all([
      repository.services(account.id), repository.upcoming(account.id, period), repository.booked(account.id, period), repository.payments(account.id, paymentPeriod), repository.pending(account.id, period),
    ]);
    const counts = new Map(services.map(row => [row.businessId, nonnegativeInteger(row.value)]));
    const ownedIds = new Set(businesses.map(business => business.id));
    return memberJSON({
      ...base,
      businesses: businesses.map(business => ({
        id: business.id, name: business.name, slug: business.slug, published: business.published,
        paymentStatus: business.paymentStatus,
        bookingUrl: business.published && business.status === 'active' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(business.slug) ? `/book/${business.slug}` : null,
        servicesCount: counts.get(business.id) ?? 0,
      })),
      upcoming: upcoming.filter(row => ownedIds.has(row.businessId) && confirmed.includes(row.status) && new Date(row.startsAt) >= period.from && new Date(row.startsAt) < period.to).slice(0, upcomingLimit).map(row => ({
        id: row.id, businessId: row.businessId, businessName: row.businessName, serviceName: row.serviceName,
        startsAt: new Date(row.startsAt).toISOString(), status: row.status, priceCents: nonnegativeInteger(row.priceCents), currency: currencyCode(row.currency),
      })),
      upcomingCount: booked.reduce((total, row) => nonnegativeInteger(total + nonnegativeInteger(row.value)), 0),
      upcomingLimit,
      recordedPayments: combineMonaAmounts(payments),
      bookedValue: combineMonaAmounts(booked),
      pendingCount: nonnegativeInteger(pending),
    });
  } catch (error) {
    if (error instanceof MemberError || error instanceof BookingError) return memberJSON({ error: error.message }, error.status);
    console.error('mona_bookings_unavailable', { error_type: error instanceof Error ? error.name : 'Unknown' });
    return memberJSON({ error: 'Mona could not load your booking numbers. Your bookings are unchanged. Please try again.' }, 503);
  }
}
