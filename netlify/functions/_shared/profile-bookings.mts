import { and, asc, count, eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { bookingBusinesses, bookingPlatformUsers, bookingServices } from '../../../db/schema.js';
import { MEMBER_ID, MemberError, memberJSON, type Member } from './member-auth.mts';
import { requireCommunityMember } from './roster-access.mts';

const BOOKING_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type BookingLinkRow = { name: unknown; slug: unknown; servicesCount: unknown };
export type ProfileBookingLink = { name: string; bookingUrl: string; servicesCount: number };
export type ProfileBookingsDependencies = {
  resolveMember: () => Promise<Member>;
  listBusinesses: (profileId: string) => Promise<BookingLinkRow[]>;
};

/** Link by the verified Identity UUID, never by a similar name or profession.
 * Inner service joins mean an unpublished business or a business without an
 * active online service cannot produce a booking button on a member's page. */
export async function listProfileBookingBusinesses(profileId: string, database: Pick<typeof db, 'select'> = db): Promise<BookingLinkRow[]> {
  if (!MEMBER_ID.test(profileId)) throw new MemberError(400, 'Choose a valid profile.');
  return database.select({
    name: bookingBusinesses.name,
    slug: bookingBusinesses.slug,
    servicesCount: count(bookingServices.id),
  }).from(bookingBusinesses)
    .innerJoin(bookingPlatformUsers, eq(bookingPlatformUsers.id, bookingBusinesses.ownerUserId))
    .innerJoin(bookingServices, eq(bookingServices.businessId, bookingBusinesses.id))
    .where(and(
      eq(bookingPlatformUsers.identityUserId, profileId.toLowerCase()),
      eq(bookingPlatformUsers.status, 'active'),
      eq(bookingBusinesses.status, 'active'),
      eq(bookingBusinesses.published, true),
      eq(bookingServices.active, true),
      eq(bookingServices.onlineBookingEnabled, true),
    ))
    .groupBy(bookingBusinesses.id, bookingBusinesses.name, bookingBusinesses.slug)
    .orderBy(asc(bookingBusinesses.name), asc(bookingBusinesses.id)).limit(20);
}

/** Keep the response an explicit public allowlist. Billing account IDs,
 * customer details, internal IDs and payment state never enter this surface. */
export function profileBookingLinks(rows: BookingLinkRow[]): ProfileBookingLink[] {
  const seen = new Set<string>();
  return rows.slice(0, 20).flatMap(row => {
    if (!row || typeof row.name !== 'string' || typeof row.slug !== 'string' ||
        row.slug.length > 80 || !BOOKING_SLUG.test(row.slug) || seen.has(row.slug)) return [];
    const name = row.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    const servicesCount = Number(row.servicesCount);
    if (!name || !Number.isSafeInteger(servicesCount) || servicesCount < 1 || servicesCount > 100000) return [];
    seen.add(row.slug);
    return [{ name, bookingUrl: `/book/${row.slug}`, servicesCount }];
  });
}

export async function handleProfileBookings(
  req: Request,
  dependencies: ProfileBookingsDependencies = {
    resolveMember: requireCommunityMember,
    listBusinesses: listProfileBookingBusinesses,
  },
): Promise<Response> {
  try {
    if (req.method !== 'GET') throw new MemberError(405, 'Method not allowed.');
    // The approved-member gate runs before any booking database read.
    const viewer = await dependencies.resolveMember();
    const ids = new URL(req.url).searchParams.getAll('id');
    if (ids.length !== 1 || !MEMBER_ID.test(ids[0])) throw new MemberError(400, 'Choose a valid profile.');
    const profileId = ids[0].toLowerCase();
    const businesses = profileBookingLinks(await dependencies.listBusinesses(profileId));
    return memberJSON({ profileId, businesses, canManage: viewer.id.toLowerCase() === profileId });
  } catch (error) {
    return error instanceof MemberError
      ? memberJSON({ error: error.message }, error.status)
      : memberJSON({ error: 'Booking links could not load. Please try again in a moment.' }, 503);
  }
}
