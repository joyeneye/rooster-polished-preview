import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, exists, gt, gte, ilike, inArray, lt, lte, ne, or, sql, sum } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  bookingAppointments,
  bookingAvailabilityBlocks,
  bookingAvailabilityRules,
  bookingBusinessHours,
  bookingBusinessMembers,
  bookingBusinesses,
  bookingCategories,
  bookingClients,
  bookingNotifications,
  bookingPayments,
  bookingPlans,
  bookingPlatformSettings,
  bookingPlatformUsers,
  bookingReviews,
  bookingServices,
  bookingStaff,
  bookingStaffServices,
  bookingSubscriptions,
} from "../../../db/schema.js";
import { availableSlots, assertSlotAvailable } from "./booking-availability.mts";
import { assertBookingOrigin, bookingFailure, BookingError, bookingJSON, cleanText, numberParam, publicBookingJSON, requireBookingUser, requireBusinessAccess, requirePlatformAdmin, slugify } from "./booking-auth.mts";

async function body(req: Request): Promise<Record<string, any>> {
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new BookingError(400, "Send a valid request.");
  }
}

function integer(value: unknown, min: number, max: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BookingError(400, `${label} is invalid.`);
  return parsed;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

async function activeCategoryId(value: unknown): Promise<number | null> {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) throw new BookingError(400, "Choose a valid category.");
  const categoryId = numberParam(value, "Category");
  if (!Number.isSafeInteger(categoryId)) throw new BookingError(400, "Choose a valid category.");
  const [category] = await db.select({ id: bookingCategories.id }).from(bookingCategories)
    .where(and(eq(bookingCategories.id, categoryId), eq(bookingCategories.active, true))).limit(1);
  if (!category) throw new BookingError(400, "Choose a valid category.");
  return categoryId;
}

function safeHttpsLink(value: unknown): string {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password && !url.port ? url.href : "";
  } catch { return ""; }
}

function businessTheme(value: unknown, current: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return current;
  const pageType = (value as Record<string, unknown>).pageType;
  if (pageType !== undefined && !["appointments", "products", "both"].includes(String(pageType))) throw new BookingError(400, "Choose appointments, products, or both for your page.");
  return { ...current, ...(pageType ? { pageType: String(pageType) } : {}) };
}

function businessSocialLinks(value: unknown, current: Record<string, string> = {}): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return current;
  const shopValue = (value as Record<string, unknown>).shop;
  const shop = shopValue ? safeHttpsLink(shopValue) : "";
  if (shopValue && !shop) throw new BookingError(400, "Use a full secure https shop link.");
  return { ...current, shop };
}

function businessGallery(value: unknown, current: string[] = []): string[] {
  if (value === undefined) return current;
  if (!Array.isArray(value) || value.length > 6) throw new BookingError(400, "Add no more than 6 lifestyle photos.");
  const route = /^\/api\/booking\/media\?key=[a-zA-Z0-9%._~-]{1,800}$/;
  if (value.some(item => typeof item !== "string" || !route.test(item))) throw new BookingError(400, "Use photos uploaded through ROOSTER.");
  return [...new Set(value)];
}

function uniqueSlug(base: string, attempt = 0): string {
  return attempt ? `${base.slice(0, 57)}-${randomBytes(3).toString("hex")}` : base;
}

async function createBusinessSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = uniqueSlug(base, attempt);
    const [existing] = await db.select({ id: bookingBusinesses.id }).from(bookingBusinesses).where(eq(bookingBusinesses.slug, slug)).limit(1);
    if (!existing) return slug;
  }
  throw new BookingError(409, "Choose a different business name.");
}

async function planFeatures(businessId: number): Promise<Record<string, any>> {
  const [row] = await db.select({ features: bookingPlans.features }).from(bookingSubscriptions)
    .innerJoin(bookingPlans, eq(bookingPlans.id, bookingSubscriptions.planId))
    .where(and(eq(bookingSubscriptions.businessId, businessId), eq(bookingSubscriptions.status, "active"))).limit(1);
  return (row?.features as Record<string, any>) ?? {};
}

async function enforceLimit(businessId: number, feature: string, table: typeof bookingServices | typeof bookingStaff): Promise<void> {
  const features = await planFeatures(businessId);
  const limit = Number(features[feature] ?? 0);
  if (!limit) return;
  const [usage] = await db.select({ value: count() }).from(table).where(eq(table.businessId, businessId));
  if (Number(usage?.value ?? 0) >= limit) throw new BookingError(403, `Your current plan allows ${limit} ${feature.replace("max", "").toLowerCase()}.`);
}

export async function bookingMe(req: Request): Promise<Response> {
  try {
    const user = await requireBookingUser();
    const owned = await db.select().from(bookingBusinesses).where(eq(bookingBusinesses.ownerUserId, user.id)).orderBy(asc(bookingBusinesses.createdAt));
    const memberships = await db.select({ business: bookingBusinesses, role: bookingBusinessMembers.role }).from(bookingBusinessMembers)
      .innerJoin(bookingBusinesses, eq(bookingBusinesses.id, bookingBusinessMembers.businessId))
      .where(and(eq(bookingBusinessMembers.userId, user.id), eq(bookingBusinessMembers.status, "active")));
    return bookingJSON({ user, businesses: [...owned.map(business => ({ ...business, role: "owner" })), ...memberships.map(row => ({ ...row.business, role: row.role }))] });
  } catch (error) { return bookingFailure(error); }
}

export async function businessesAPI(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") assertBookingOrigin(req);
    const user = await requireBookingUser();
    if (req.method === "GET") {
      const rows = await db.select().from(bookingBusinesses).where(eq(bookingBusinesses.ownerUserId, user.id)).orderBy(desc(bookingBusinesses.createdAt));
      return bookingJSON({ businesses: rows });
    }
    const input = await body(req);
    if (req.method === "POST") {
      const name = cleanText(input.name, 100, true);
      const slug = await createBusinessSlug(input.slug ? cleanText(input.slug, 64, true) : name);
      const categoryId = await activeCategoryId(input.categoryId);
      const created = await db.transaction(async tx => {
        const [business] = await tx.insert(bookingBusinesses).values({
          ownerUserId: user.id,
          categoryId,
          slug,
          name,
          description: cleanText(input.description, 2000),
          email: cleanText(input.email || user.email, 160),
          phone: cleanText(input.phone, 40),
          city: cleanText(input.city, 80),
          region: cleanText(input.region, 80),
          timezone: cleanText(input.timezone || "America/New_York", 80, true),
          bookingRules: { leadTimeMinutes: 120, bookingWindowDays: 90, cancellationHours: 24, reminders: [1440, 120] },
          theme: { primary: "#9b4f32", accent: "#d8b26e", font: "Manrope" },
        }).returning();
        await tx.insert(bookingBusinessMembers).values({ businessId: business.id, userId: user.id, role: "owner", permissions: ["*"] });
        await tx.insert(bookingBusinessHours).values([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ businessId: business.id, weekday, closed: weekday === 0, startMinute: 540, endMinute: weekday === 6 ? 900 : 1020 })));
        const [staff] = await tx.insert(bookingStaff).values({ businessId: business.id, userId: user.id, name: user.displayName || name, role: "owner" }).returning();
        await tx.insert(bookingAvailabilityRules).values([1, 2, 3, 4, 5].map(weekday => ({ businessId: business.id, staffId: staff.id, weekday, startMinute: 540, endMinute: 1020 })));
        const [freePlan] = await tx.select({ id: bookingPlans.id }).from(bookingPlans).where(and(eq(bookingPlans.code, "free"), eq(bookingPlans.active, true))).limit(1);
        if (freePlan) await tx.insert(bookingSubscriptions).values({ businessId: business.id, planId: freePlan.id, status: "active" });
        return business;
      });
      return bookingJSON({ business: created, bookingUrl: `/book/${created.slug}` }, 201);
    }
    if (req.method === "PATCH") {
      const businessId = numberParam(input.businessId, "Business");
      const { business: currentBusiness } = await requireBusinessAccess(businessId, ["owner", "manager"]);
      const updates: Record<string, any> = { updatedAt: new Date() };
      const textFields: Record<string, number> = { name: 100, description: 2000, logoUrl: 1000, coverUrl: 1000, phone: 40, email: 160, addressLine1: 180, addressLine2: 180, city: 80, region: 80, postalCode: 24, country: 2, timezone: 80 };
      for (const [field, max] of Object.entries(textFields)) if (field in input) updates[field] = cleanText(input[field], max, field === "name" || field === "timezone");
      if ("categoryId" in input) updates.categoryId = await activeCategoryId(input.categoryId);
      if ("theme" in input) updates.theme = businessTheme(input.theme, currentBusiness.theme as Record<string, string>);
      if ("socialLinks" in input) updates.socialLinks = businessSocialLinks(input.socialLinks, currentBusiness.socialLinks as Record<string, string>);
      if ("gallery" in input) updates.gallery = businessGallery(input.gallery, currentBusiness.gallery as string[]);
      for (const field of ["bookingRules", "policies"]) if (field in input && input[field] && typeof input[field] === "object") updates[field] = input[field];
      if ("published" in input) updates.published = Boolean(input.published);
      const [business] = await db.update(bookingBusinesses).set(updates).where(eq(bookingBusinesses.id, businessId)).returning();
      return bookingJSON({ business, bookingUrl: `/book/${business.slug}` });
    }
    throw new BookingError(405, "Method not allowed.");
  } catch (error) { return bookingFailure(error); }
}

export async function servicesAPI(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") assertBookingOrigin(req);
    const input = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await body(req);
    const businessId = numberParam(input.businessId, "Business");
    await requireBusinessAccess(businessId);
    if (req.method === "GET") {
      const services = await db.select().from(bookingServices).where(eq(bookingServices.businessId, businessId)).orderBy(asc(bookingServices.sortOrder), asc(bookingServices.name));
      const staff = await db.select().from(bookingStaff).where(eq(bookingStaff.businessId, businessId)).orderBy(asc(bookingStaff.name));
      const assignments = await db.select().from(bookingStaffServices).where(eq(bookingStaffServices.businessId, businessId));
      return bookingJSON({ services, staff, assignments });
    }
    if (req.method === "POST") {
      await enforceLimit(businessId, "maxServices", bookingServices);
      const categoryId = await activeCategoryId(input.categoryId);
      const [service] = await db.insert(bookingServices).values({
        businessId,
        categoryId,
        name: cleanText(input.name, 100, true),
        description: cleanText(input.description, 1200),
        priceCents: integer(input.priceCents, 0, 10_000_000, "Price"),
        durationMinutes: integer(input.durationMinutes, 5, 1440, "Duration"),
        bufferBeforeMinutes: integer(input.bufferBeforeMinutes ?? 0, 0, 240, "Buffer"),
        bufferAfterMinutes: integer(input.bufferAfterMinutes ?? 0, 0, 240, "Buffer"),
        depositType: ["none", "fixed", "percent"].includes(input.depositType) ? input.depositType : "none",
        depositValue: integer(input.depositValue ?? 0, 0, 10_000_000, "Deposit"),
        onlineBookingEnabled: input.onlineBookingEnabled !== false,
      }).returning();
      const requested = Array.isArray(input.staffIds) ? input.staffIds.map((value: unknown) => numberParam(value, "Staff")) : [];
      const validStaff = requested.length ? await db.select({ id: bookingStaff.id }).from(bookingStaff).where(and(eq(bookingStaff.businessId, businessId), inArray(bookingStaff.id, requested))) : await db.select({ id: bookingStaff.id }).from(bookingStaff).where(and(eq(bookingStaff.businessId, businessId), eq(bookingStaff.active, true)));
      if (validStaff.length) await db.insert(bookingStaffServices).values(validStaff.map(staff => ({ businessId, staffId: staff.id, serviceId: service.id })));
      return bookingJSON({ service }, 201);
    }
    if (req.method === "PATCH") {
      const serviceId = numberParam(input.serviceId, "Service");
      const [existing] = await db.select().from(bookingServices).where(and(eq(bookingServices.id, serviceId), eq(bookingServices.businessId, businessId))).limit(1);
      if (!existing) throw new BookingError(404, "Service not found.");
      const updates: Record<string, any> = { updatedAt: new Date() };
      if ("categoryId" in input) updates.categoryId = await activeCategoryId(input.categoryId);
      if ("name" in input) updates.name = cleanText(input.name, 100, true);
      if ("description" in input) updates.description = cleanText(input.description, 1200);
      if ("priceCents" in input) updates.priceCents = integer(input.priceCents, 0, 10_000_000, "Price");
      if ("durationMinutes" in input) updates.durationMinutes = integer(input.durationMinutes, 5, 1440, "Duration");
      if ("onlineBookingEnabled" in input) updates.onlineBookingEnabled = Boolean(input.onlineBookingEnabled);
      if ("active" in input) updates.active = Boolean(input.active);
      const [service] = await db.update(bookingServices).set(updates).where(and(eq(bookingServices.id, serviceId), eq(bookingServices.businessId, businessId))).returning();
      return bookingJSON({ service });
    }
    throw new BookingError(405, "Method not allowed.");
  } catch (error) { return bookingFailure(error); }
}

export async function staffAPI(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") assertBookingOrigin(req);
    const input = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await body(req);
    const businessId = numberParam(input.businessId, "Business");
    await requireBusinessAccess(businessId);
    if (req.method === "GET") {
      const staff = await db.select().from(bookingStaff).where(eq(bookingStaff.businessId, businessId)).orderBy(asc(bookingStaff.name));
      const rules = await db.select().from(bookingAvailabilityRules).where(eq(bookingAvailabilityRules.businessId, businessId));
      const blocks = await db.select().from(bookingAvailabilityBlocks).where(and(eq(bookingAvailabilityBlocks.businessId, businessId), gte(bookingAvailabilityBlocks.endsAt, new Date()))).orderBy(asc(bookingAvailabilityBlocks.startsAt));
      return bookingJSON({ staff, rules, blocks });
    }
    if (req.method === "POST") {
      await enforceLimit(businessId, "maxStaff", bookingStaff);
      const [staff] = await db.insert(bookingStaff).values({ businessId, name: cleanText(input.name, 100, true), email: cleanText(input.email, 160), phone: cleanText(input.phone, 40), bio: cleanText(input.bio, 1200), role: cleanText(input.role || "professional", 60, true), color: cleanText(input.color || "#ad5d3b", 16, true) }).returning();
      return bookingJSON({ staff }, 201);
    }
    if (req.method === "PATCH") {
      const staffId = numberParam(input.staffId, "Staff");
      const [existing] = await db.select({ id: bookingStaff.id }).from(bookingStaff).where(and(eq(bookingStaff.id, staffId), eq(bookingStaff.businessId, businessId))).limit(1);
      if (!existing) throw new BookingError(404, "Staff member not found.");
      const updates: Record<string, any> = { updatedAt: new Date() };
      for (const [field, max] of Object.entries({ name: 100, email: 160, phone: 40, bio: 1200, role: 60, photoUrl: 1000, color: 16 })) if (field in input) updates[field] = cleanText(input[field], max, field === "name");
      if ("active" in input) updates.active = Boolean(input.active);
      const [staff] = await db.update(bookingStaff).set(updates).where(and(eq(bookingStaff.id, staffId), eq(bookingStaff.businessId, businessId))).returning();
      return bookingJSON({ staff });
    }
    throw new BookingError(405, "Method not allowed.");
  } catch (error) { return bookingFailure(error); }
}

export async function publicAPI(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const action = params.get("action") || "discover";
    if (action === "categories") {
      const categories = await db.select().from(bookingCategories).where(eq(bookingCategories.active, true)).orderBy(asc(bookingCategories.sortOrder), asc(bookingCategories.name));
      return publicBookingJSON({ categories }, 200, 300);
    }
    if (action === "discover") {
      const query = cleanText(params.get("q"), 100);
      const category = cleanText(params.get("category"), 64);
      const location = cleanText(params.get("location"), 100);
      const conditions = [eq(bookingBusinesses.status, "active"), eq(bookingBusinesses.published, true)];
      if (query) conditions.push(or(ilike(bookingBusinesses.name, `%${query}%`), ilike(bookingBusinesses.description, `%${query}%`))!);
      if (location) conditions.push(or(ilike(bookingBusinesses.city, `%${location}%`), ilike(bookingBusinesses.region, `%${location}%`))!);
      if (category) conditions.push(or(
        and(eq(bookingCategories.slug, category), eq(bookingCategories.active, true)),
        exists(db.select({ id: bookingServices.id }).from(bookingServices)
          .innerJoin(bookingCategories, eq(bookingCategories.id, bookingServices.categoryId))
          .where(and(
            eq(bookingServices.businessId, bookingBusinesses.id),
            eq(bookingServices.active, true),
            eq(bookingServices.onlineBookingEnabled, true),
            eq(bookingCategories.slug, category),
            eq(bookingCategories.active, true),
          ))),
      )!);
      const providers = await db.select({ business: bookingBusinesses, category: bookingCategories }).from(bookingBusinesses).leftJoin(bookingCategories, eq(bookingCategories.id, bookingBusinesses.categoryId)).where(and(...conditions)).orderBy(desc(bookingBusinesses.featured), desc(bookingBusinesses.averageRating), asc(bookingBusinesses.name)).limit(50);
      return publicBookingJSON({ providers });
    }
    const slug = slugify(params.get("slug"));
    const [provider] = await db.select({ business: bookingBusinesses, category: bookingCategories }).from(bookingBusinesses).leftJoin(bookingCategories, eq(bookingCategories.id, bookingBusinesses.categoryId)).where(and(eq(bookingBusinesses.slug, slug), eq(bookingBusinesses.status, "active"), eq(bookingBusinesses.published, true))).limit(1);
    if (!provider) throw new BookingError(404, "Provider not found.");
    if (action === "availability") {
      const slots = await availableSlots({ businessId: provider.business.id, serviceId: numberParam(params.get("serviceId"), "Service"), staffId: params.get("staffId") ? numberParam(params.get("staffId"), "Staff") : undefined, date: cleanText(params.get("date"), 10, true), timezone: provider.business.timezone });
      return publicBookingJSON({ slots }, 200, 15);
    }
    const services = await db.select().from(bookingServices).where(and(eq(bookingServices.businessId, provider.business.id), eq(bookingServices.active, true), eq(bookingServices.onlineBookingEnabled, true))).orderBy(asc(bookingServices.sortOrder), asc(bookingServices.name));
    const categoryIds = [...new Set(services.map(service => service.categoryId).filter((id): id is number => id !== null))];
    const serviceCategories = categoryIds.length ? await db.select({ id: bookingCategories.id, slug: bookingCategories.slug, name: bookingCategories.name })
      .from(bookingCategories).where(and(inArray(bookingCategories.id, categoryIds), eq(bookingCategories.active, true)))
      .orderBy(asc(bookingCategories.sortOrder), asc(bookingCategories.name)) : [];
    const staff = await db.select().from(bookingStaff).where(and(eq(bookingStaff.businessId, provider.business.id), eq(bookingStaff.active, true))).orderBy(asc(bookingStaff.name));
    const assignments = await db.select().from(bookingStaffServices).where(eq(bookingStaffServices.businessId, provider.business.id));
    const hours = await db.select().from(bookingBusinessHours).where(eq(bookingBusinessHours.businessId, provider.business.id)).orderBy(asc(bookingBusinessHours.weekday));
    const reviews = await db.select({ id: bookingReviews.id, rating: bookingReviews.rating, body: bookingReviews.body, providerResponse: bookingReviews.providerResponse, createdAt: bookingReviews.createdAt, clientName: bookingClients.name }).from(bookingReviews).innerJoin(bookingClients, and(eq(bookingClients.id, bookingReviews.clientId), eq(bookingClients.businessId, provider.business.id))).where(and(eq(bookingReviews.businessId, provider.business.id), eq(bookingReviews.status, "published"))).orderBy(desc(bookingReviews.createdAt)).limit(20);
    return publicBookingJSON({ ...provider, services, serviceCategories, staff, assignments, hours, reviews });
  } catch (error) {
    if (error instanceof BookingError) return publicBookingJSON({ error: error.message }, error.status, 0);
    console.error("booking_public_error", error);
    return publicBookingJSON({ error: "This booking page is temporarily unavailable." }, 503, 0);
  }
}

export async function createBooking(req: Request): Promise<Response> {
  try {
    assertBookingOrigin(req);
    const input = await body(req);
    const slug = slugify(input.slug);
    const [business] = await db.select().from(bookingBusinesses).where(and(eq(bookingBusinesses.slug, slug), eq(bookingBusinesses.status, "active"), eq(bookingBusinesses.published, true))).limit(1);
    if (!business) throw new BookingError(404, "Provider not found.");
    const serviceId = numberParam(input.serviceId, "Service");
    let staffId = input.staffId ? numberParam(input.staffId, "Staff") : 0;
    const startsAt = new Date(String(input.startsAt ?? ""));
    if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date()) throw new BookingError(400, "Choose a future appointment time.");
    if (!staffId) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(startsAt);
      const date = `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
      const slots = await availableSlots({ businessId: business.id, serviceId, date, timezone: business.timezone });
      const matching = slots.find(slot => slot.startsAt === startsAt.toISOString());
      if (!matching) throw new BookingError(409, "That appointment time is no longer available.");
      staffId = matching.staffId;
    }
    const clientName = cleanText(input.name, 100, true);
    const clientEmail = cleanText(input.email, 160, true).toLowerCase();
    const clientPhone = cleanText(input.phone, 40, true);
    const booking = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${business.id}, ${staffId})`);
      const slot = await assertSlotAvailable({ businessId: business.id, serviceId, staffId, startsAt, timezone: business.timezone });
      const [conflict] = await tx.select({ id: bookingAppointments.id }).from(bookingAppointments).where(and(eq(bookingAppointments.businessId, business.id), eq(bookingAppointments.staffId, staffId), ne(bookingAppointments.status, "cancelled"), lt(bookingAppointments.startsAt, slot.endsAt), gt(bookingAppointments.endsAt, startsAt))).limit(1);
      if (conflict) throw new BookingError(409, "That appointment time is no longer available.");
      const [staff] = await tx.select({ id: bookingStaff.id }).from(bookingStaff).where(and(eq(bookingStaff.id, staffId), eq(bookingStaff.businessId, business.id), eq(bookingStaff.active, true))).limit(1);
      if (!staff) throw new BookingError(404, "Staff member not found.");
      let [client] = await tx.select().from(bookingClients).where(and(eq(bookingClients.businessId, business.id), eq(bookingClients.email, clientEmail))).limit(1);
      if (!client) [client] = await tx.insert(bookingClients).values({ businessId: business.id, name: clientName, email: clientEmail, phone: clientPhone }).returning();
      else [client] = await tx.update(bookingClients).set({ name: clientName, phone: clientPhone, updatedAt: new Date() }).where(and(eq(bookingClients.id, client.id), eq(bookingClients.businessId, business.id))).returning();
      const confirmationCode = randomBytes(5).toString("hex").toUpperCase();
      const status = slot.depositCents > 0 ? "pending_payment" : "confirmed";
      const [appointment] = await tx.insert(bookingAppointments).values({ publicId: randomUUID(), confirmationCode, businessId: business.id, serviceId, staffId, clientId: client.id, status, startsAt, endsAt: slot.endsAt, priceCents: slot.priceCents, depositCents: slot.depositCents, notes: cleanText(input.notes, 1000) }).returning();
      await tx.update(bookingClients).set({ appointmentCount: sql`${bookingClients.appointmentCount} + 1`, nextAppointmentAt: startsAt, updatedAt: new Date() }).where(and(eq(bookingClients.id, client.id), eq(bookingClients.businessId, business.id)));
      const reminders = Array.isArray((business.bookingRules as Record<string, unknown>)?.reminders) ? ((business.bookingRules as Record<string, unknown>).reminders as unknown[]).map(Number).filter(value => Number.isInteger(value) && value > 0 && value <= 43_200) : [];
      const reminderNotifications = reminders.flatMap(minutes => {
        const scheduledFor = new Date(startsAt.getTime() - minutes * 60_000);
        if (scheduledFor <= new Date()) return [];
        return [
          { businessId: business.id, appointmentId: appointment.id, channel: "email", template: "appointment_reminder", recipient: clientEmail, subject: `Upcoming appointment with ${business.name}`, body: `Reminder: your appointment is coming up. Confirmation ${confirmationCode}.`, data: { confirmationCode, minutesBefore: minutes }, scheduledFor },
          ...(clientPhone ? [{ businessId: business.id, appointmentId: appointment.id, channel: "sms", template: "appointment_reminder", recipient: clientPhone, subject: "Appointment reminder", body: `${business.name}: your appointment is coming up. Confirmation ${confirmationCode}.`, data: { confirmationCode, minutesBefore: minutes }, scheduledFor }] : []),
        ];
      });
      await tx.insert(bookingNotifications).values([
        { businessId: business.id, appointmentId: appointment.id, channel: "email", template: "booking_confirmation", recipient: clientEmail, subject: `Booking with ${business.name}`, body: `Your appointment is reserved. Confirmation ${confirmationCode}.`, data: { confirmationCode } },
        { businessId: business.id, appointmentId: appointment.id, channel: "in_app", template: "new_booking", recipient: String(business.ownerUserId), subject: "New booking", body: `${clientName} booked an appointment.`, data: { confirmationCode } },
        ...reminderNotifications,
      ]);
      return { appointment, client, requiresPayment: slot.depositCents > 0 };
    });
    return bookingJSON({ ...booking, business: { name: business.name, slug: business.slug, location: [business.addressLine1, business.city, business.region].filter(Boolean).join(", ") } }, 201);
  } catch (error) { return bookingFailure(error); }
}

export async function appointmentsAPI(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") assertBookingOrigin(req);
    const input = req.method === "GET" ? Object.fromEntries(new URL(req.url).searchParams) : await body(req);
    const businessId = numberParam(input.businessId, "Business");
    const access = await requireBusinessAccess(businessId);
    if (req.method === "GET") {
      const from = input.from ? new Date(input.from) : new Date(Date.now() - 30 * 86400_000);
      const to = input.to ? new Date(input.to) : new Date(Date.now() + 90 * 86400_000);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new BookingError(400, "Choose a valid date range.");
      const appointments = await db.select({ appointment: bookingAppointments, serviceName: bookingServices.name, staffName: bookingStaff.name, clientName: bookingClients.name, clientEmail: bookingClients.email, clientPhone: bookingClients.phone }).from(bookingAppointments)
        .innerJoin(bookingServices, and(eq(bookingServices.id, bookingAppointments.serviceId), eq(bookingServices.businessId, businessId)))
        .innerJoin(bookingStaff, and(eq(bookingStaff.id, bookingAppointments.staffId), eq(bookingStaff.businessId, businessId)))
        .innerJoin(bookingClients, and(eq(bookingClients.id, bookingAppointments.clientId), eq(bookingClients.businessId, businessId)))
        .where(and(eq(bookingAppointments.businessId, businessId), gte(bookingAppointments.startsAt, from), lte(bookingAppointments.startsAt, to))).orderBy(asc(bookingAppointments.startsAt));
      return bookingJSON({ appointments });
    }
    if (req.method === "POST") {
      const serviceId = numberParam(input.serviceId, "Service");
      const staffId = numberParam(input.staffId, "Staff");
      const startsAt = new Date(input.startsAt);
      if (!Number.isFinite(startsAt.getTime())) throw new BookingError(400, "Choose a valid appointment time.");
      const slot = await assertSlotAvailable({ businessId, serviceId, staffId, startsAt, timezone: access.business.timezone });
      let clientId = input.clientId ? numberParam(input.clientId, "Client") : 0;
      if (!clientId) {
        const [client] = await db.insert(bookingClients).values({ businessId, name: cleanText(input.name, 100, true), email: cleanText(input.email, 160).toLowerCase(), phone: cleanText(input.phone, 40) }).returning();
        clientId = client.id;
      }
      const [client] = await db.select({ id: bookingClients.id }).from(bookingClients).where(and(eq(bookingClients.id, clientId), eq(bookingClients.businessId, businessId))).limit(1);
      if (!client) throw new BookingError(404, "Client not found.");
      const [appointment] = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(${businessId}, ${staffId})`);
        const [conflict] = await tx.select({ id: bookingAppointments.id }).from(bookingAppointments).where(and(eq(bookingAppointments.businessId, businessId), eq(bookingAppointments.staffId, staffId), ne(bookingAppointments.status, "cancelled"), lt(bookingAppointments.startsAt, slot.endsAt), gt(bookingAppointments.endsAt, startsAt))).limit(1);
        if (conflict) throw new BookingError(409, "That appointment time is no longer available.");
        return tx.insert(bookingAppointments).values({ publicId: randomUUID(), confirmationCode: randomBytes(5).toString("hex").toUpperCase(), businessId, serviceId, staffId, clientId, status: "confirmed", source: "manual", startsAt, endsAt: slot.endsAt, priceCents: slot.priceCents, depositCents: slot.depositCents, privateNotes: cleanText(input.privateNotes, 2000) }).returning();
      });
      return bookingJSON({ appointment }, 201);
    }
    if (req.method === "PATCH") {
      const appointmentId = numberParam(input.appointmentId, "Appointment");
      const [existing] = await db.select().from(bookingAppointments).where(and(eq(bookingAppointments.id, appointmentId), eq(bookingAppointments.businessId, businessId))).limit(1);
      if (!existing) throw new BookingError(404, "Appointment not found.");
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.status) {
        const status = cleanText(input.status, 30, true);
        if (!["confirmed", "checked_in", "completed", "cancelled", "no_show"].includes(status)) throw new BookingError(400, "Appointment status is invalid.");
        updates.status = status;
        if (status === "cancelled") updates.cancelledAt = new Date();
        if (status === "completed") updates.completedAt = new Date();
      }
      if (input.startsAt) {
        const startsAt = new Date(input.startsAt);
        if (!Number.isFinite(startsAt.getTime())) throw new BookingError(400, "Choose a valid appointment time.");
        const staffId = input.staffId ? numberParam(input.staffId, "Staff") : existing.staffId;
        const slot = await assertSlotAvailable({ businessId, serviceId: existing.serviceId, staffId, startsAt, timezone: access.business.timezone, excludeAppointmentId: existing.id });
        updates.startsAt = startsAt;
        updates.endsAt = slot.endsAt;
        updates.staffId = staffId;
      }
      if ("privateNotes" in input) updates.privateNotes = cleanText(input.privateNotes, 2000);
      if ("cancellationReason" in input) updates.cancellationReason = cleanText(input.cancellationReason, 500);
      const [appointment] = await db.update(bookingAppointments).set(updates).where(and(eq(bookingAppointments.id, appointmentId), eq(bookingAppointments.businessId, businessId))).returning();
      return bookingJSON({ appointment });
    }
    throw new BookingError(405, "Method not allowed.");
  } catch (error) { return bookingFailure(error); }
}

export async function dashboardAPI(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const businessId = numberParam(params.get("businessId"), "Business");
    const access = await requireBusinessAccess(businessId);
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [todayCount] = await db.select({ value: count() }).from(bookingAppointments).where(and(eq(bookingAppointments.businessId, businessId), gte(bookingAppointments.startsAt, dayStart), lte(bookingAppointments.startsAt, dayEnd), ne(bookingAppointments.status, "cancelled")));
    const [upcomingCount] = await db.select({ value: count() }).from(bookingAppointments).where(and(eq(bookingAppointments.businessId, businessId), gte(bookingAppointments.startsAt, now), ne(bookingAppointments.status, "cancelled")));
    const [todayRevenue] = await db.select({ value: sum(bookingPayments.providerNetCents) }).from(bookingPayments).where(and(eq(bookingPayments.businessId, businessId), eq(bookingPayments.status, "succeeded"), gte(bookingPayments.createdAt, dayStart), lte(bookingPayments.createdAt, dayEnd)));
    const [monthRevenue] = await db.select({ value: sum(bookingPayments.providerNetCents) }).from(bookingPayments).where(and(eq(bookingPayments.businessId, businessId), eq(bookingPayments.status, "succeeded"), gte(bookingPayments.createdAt, monthStart)));
    const [clientCount] = await db.select({ value: count() }).from(bookingClients).where(eq(bookingClients.businessId, businessId));
    const upcoming = await db.select({ appointment: bookingAppointments, serviceName: bookingServices.name, staffName: bookingStaff.name, clientName: bookingClients.name }).from(bookingAppointments)
      .innerJoin(bookingServices, and(eq(bookingServices.id, bookingAppointments.serviceId), eq(bookingServices.businessId, businessId)))
      .innerJoin(bookingStaff, and(eq(bookingStaff.id, bookingAppointments.staffId), eq(bookingStaff.businessId, businessId)))
      .innerJoin(bookingClients, and(eq(bookingClients.id, bookingAppointments.clientId), eq(bookingClients.businessId, businessId)))
      .where(and(eq(bookingAppointments.businessId, businessId), gte(bookingAppointments.startsAt, now), ne(bookingAppointments.status, "cancelled"))).orderBy(asc(bookingAppointments.startsAt)).limit(8);
    return bookingJSON({ business: access.business, metrics: { todayAppointments: Number(todayCount?.value ?? 0), upcomingAppointments: Number(upcomingCount?.value ?? 0), todayRevenueCents: Number(todayRevenue?.value ?? 0), monthRevenueCents: Number(monthRevenue?.value ?? 0), clients: Number(clientCount?.value ?? 0), rating: access.business.averageRating / 100 }, upcoming });
  } catch (error) { return bookingFailure(error); }
}

export async function clientsAPI(req: Request): Promise<Response> {
  try {
    const params = new URL(req.url).searchParams;
    const businessId = numberParam(params.get("businessId"), "Business");
    await requireBusinessAccess(businessId);
    const query = cleanText(params.get("q"), 100);
    const condition = query ? and(eq(bookingClients.businessId, businessId), or(ilike(bookingClients.name, `%${query}%`), ilike(bookingClients.email, `%${query}%`), ilike(bookingClients.phone, `%${query}%`))) : eq(bookingClients.businessId, businessId);
    const clients = await db.select().from(bookingClients).where(condition).orderBy(desc(bookingClients.nextAppointmentAt), asc(bookingClients.name)).limit(250);
    return bookingJSON({ clients });
  } catch (error) { return bookingFailure(error); }
}

export async function adminAPI(req: Request): Promise<Response> {
  try {
    if (req.method !== "GET") assertBookingOrigin(req);
    const admin = await requirePlatformAdmin();
    if (req.method === "PATCH") {
      const input = await body(req);
      if (input.businessId) {
        const businessId = numberParam(input.businessId, "Business");
        const updates: Record<string, any> = { updatedAt: new Date() };
        if (input.status) updates.status = cleanText(input.status, 30, true);
        if ("featured" in input) updates.featured = Boolean(input.featured);
        const [business] = await db.update(bookingBusinesses).set(updates).where(eq(bookingBusinesses.id, businessId)).returning();
        return bookingJSON({ business });
      }
      if (input.settingKey) {
        const key = cleanText(input.settingKey, 80, true);
        if (!input.value || typeof input.value !== "object") throw new BookingError(400, "Setting value is invalid.");
        const [setting] = await db.insert(bookingPlatformSettings).values({ key, value: input.value, updatedBy: admin.identityUserId }).onConflictDoUpdate({ target: bookingPlatformSettings.key, set: { value: input.value, updatedBy: admin.identityUserId, updatedAt: new Date() } }).returning();
        return bookingJSON({ setting });
      }
      throw new BookingError(400, "Choose an admin action.");
    }
    const [[users], [providers], [clients], [bookings], [gross], [fees], businesses, plans, categories] = await Promise.all([
      db.select({ value: count() }).from(bookingPlatformUsers),
      db.select({ value: count() }).from(bookingBusinesses),
      db.select({ value: count() }).from(bookingClients),
      db.select({ value: count() }).from(bookingAppointments),
      db.select({ value: sum(bookingPayments.amountCents) }).from(bookingPayments).where(eq(bookingPayments.status, "succeeded")),
      db.select({ value: sum(bookingPayments.platformFeeCents) }).from(bookingPayments).where(eq(bookingPayments.status, "succeeded")),
      db.select().from(bookingBusinesses).orderBy(desc(bookingBusinesses.createdAt)).limit(100),
      db.select().from(bookingPlans).orderBy(asc(bookingPlans.sortOrder)),
      db.select().from(bookingCategories).orderBy(asc(bookingCategories.sortOrder)),
    ]);
    return bookingJSON({ metrics: { users: Number(users?.value ?? 0), providers: Number(providers?.value ?? 0), clients: Number(clients?.value ?? 0), bookings: Number(bookings?.value ?? 0), grossBookingVolumeCents: Number(gross?.value ?? 0), platformRevenueCents: Number(fees?.value ?? 0) }, businesses, plans, categories });
  } catch (error) { return bookingFailure(error); }
}
