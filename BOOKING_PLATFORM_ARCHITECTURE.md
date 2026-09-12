# ROOSTER Booking Platform Architecture

## Current architecture assessment

The repository is a static, multi-page JavaScript application deployed by Netlify. `build.mjs` copies browser assets into `public/` and bundles the JavaScript entry points that import packages. Server-side behavior uses modern Netlify Functions (`.mts`) with explicit `/api/...` routes. Authentication already uses the headless `@netlify/identity` package, and structured data already uses Netlify Database through Drizzle ORM. Media workloads use Netlify Blobs and `sharp`.

The booking platform extends these systems rather than replacing them. Existing ROOSTER community routes, data tables, migrations, and access controls remain independent. Booking accounts do not inherit the community's invite-only policy; a confirmed Netlify Identity account can create a booking business. Platform administration is granted from a server-side allowlist and persisted as a platform role.

## Database and schema

The booking domain is defined in `db/schema.ts` and created by the forward-only migration `20260909152320_create_multi_tenant_booking_platform`.

Tenant ownership begins at `booking_businesses`. Every private operational table includes `business_id`, including memberships, hours, staff, services, staff-service assignments, availability rules, availability blocks, clients, appointments, payments, reviews, promotions, notifications, subscriptions, and reports. Queries for private records always combine the record identifier with the authorized business identifier.

Core relationships:

- `booking_platform_users` maps verified Identity users to platform roles and account status.
- `booking_businesses` owns a unique public slug, profile, location, theme, rules, payment account, and publication state.
- `booking_business_members` grants owner, manager, or staff access to one tenant.
- `booking_services`, `booking_staff`, and `booking_staff_services` define the bookable catalog.
- `booking_business_hours`, `booking_availability_rules`, and `booking_availability_blocks` define recurring and exceptional availability.
- `booking_clients` is tenant-private CRM data. The same consumer can have separate client rows for separate providers.
- `booking_appointments` snapshots price, time, status, client, service, and staff relationships.
- `booking_payments` records gross amount, configurable platform fee, provider net, payment state, and Stripe identifiers.
- `booking_reviews` requires a unique completed appointment, preventing unverified duplicate reviews.
- `booking_plans` stores feature and usage limits as editable JSON rather than code constants.
- `booking_platform_settings` stores configurable marketplace and payment settings, including platform fee basis points.

Images are stored in a tenant-namespaced Netlify Blobs store after server-side decoding, resizing, metadata removal, and WebP conversion. Database rows keep the resulting stable media URL.

## Pages and routes

Public routes:

- `/booking` — marketplace discovery, category filters, provider and location search.
- `/book/:slug` — generated provider website, services, staff, reviews, hours, policies, availability, and booking flow.
- `/booking-manage.html?id=...&code=...` — secure client booking management.

Authenticated routes:

- `/booking/dashboard` — provider authentication, onboarding, overview, calendar, appointments, clients, services, staff, booking website, QR code, media, payment connection, and settings.
- `/booking/admin` — platform totals, gross booking volume, platform revenue, providers, plans, and categories.

The provider dashboard is implemented as a responsive section-based application. Additional navigation sections can be added without changing the tenant or API model.

## API endpoints

Identity and tenant context:

- `GET /api/booking/me`
- `GET|POST|PATCH /api/booking/businesses`

Provider operations:

- `GET|POST|PATCH /api/booking/services`
- `GET|POST|PATCH /api/booking/staff`
- `GET|POST|PATCH /api/booking/appointments`
- `GET /api/booking/clients`
- `GET /api/booking/dashboard`
- `GET|POST /api/booking/media`

Public and client operations:

- `GET /api/booking/public`
- `POST /api/booking/create`
- `GET|PATCH /api/booking/manage`
- `POST /api/booking/review`

Payments and notifications:

- `POST /api/booking/stripe-connect`
- `POST /api/booking/payment-intent`
- `POST /api/booking/stripe-webhook`
- Scheduled `booking-notifications` function

Platform administration:

- `GET|PATCH /api/booking/admin`

## Authentication and authorization

The browser uses `@netlify/identity` for signup, login, logout, callback processing, and session hydration. Functions call `getUser()` and require a confirmed account. Tokens and client-supplied user identifiers are never trusted as authorization evidence.

`requireBusinessAccess()` is the mandatory private-data gate. It loads the authenticated platform user, loads the requested business, and grants access only when the user is the owner, an active business member, or a platform administrator. Every private query remains scoped by `business_id` after authorization, providing defense in depth against cross-tenant record access.

Platform admins require `platform_role = admin`. Initial administrators are configured with `BOOKING_ADMIN_USER_IDS` or `BOOKING_ADMIN_EMAILS`; matching confirmed accounts are promoted server-side. Account suspension is enforced before tenant access.

Public endpoints expose only published, active business profile fields and never return private notes, payment records, private client data, or tenant settings.

## Booking and availability architecture

Availability is calculated on demand from the business timezone, business hours, staff-service assignments, staff or business recurring rules, date-specific blocks, service duration, buffers, existing active appointments, and past-time exclusion. “Any available” selects a staff member from the same live slot calculation.

Online and manually created appointments use a Postgres transaction and a per-business/per-staff advisory lock. After acquiring the lock, the function repeats the overlap check before inserting. This serializes competing requests for one staff calendar and prevents two clients from claiming the same opening.

Appointments have public UUIDs and separate confirmation codes. Client management and review submission require both values. Rescheduling excludes the current appointment from conflict detection while checking the replacement slot.

## Payment architecture

Providers connect their own Stripe Express account. The platform creates an onboarding link and stores only the connected account identifier and capability state. Deposit PaymentIntents use destination charges, transfer funds to the provider account, and set `application_fee_amount` from `booking_platform_settings.payments.platformFeeBasisPoints`.

Stripe webhook signatures are verified before processing. Successful deposits confirm pending appointments and update payment records. Failed, canceled, and refunded payments update the ledger. The required runtime variables are:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

No fee percentage is embedded in payment code. The migration supplies an editable initial setting that platform administration can change.

## Notifications

Booking confirmation and configurable reminder messages are written to a durable database outbox. A scheduled function sends pending email and SMS messages through adapter webhooks, retries failures, and preserves in-app notifications without depending on one communications vendor.

Required adapter variables are:

- `BOOKING_EMAIL_WEBHOOK_URL`
- `BOOKING_SMS_WEBHOOK_URL`
- `BOOKING_NOTIFICATION_WEBHOOK_SECRET`

The webhook payload contains recipient, subject, body, template, and structured data, allowing SendGrid, Postmark, Twilio, or another provider to be connected without changing booking logic.

## Implementation phases

1. **Foundation:** Multi-tenant schema, forward migration, Identity account mapping, business memberships, strict server-side tenant authorization, categories, plans, and platform settings.
2. **Provider launch:** Business onboarding, generated slug, default owner/staff calendar, services, staff, media, publication controls, public page, and QR code.
3. **Booking core:** Timezone-aware availability, staff selection, buffers, conflict serialization, booking confirmation, client CRM creation, cancellation, rescheduling, and verified reviews.
4. **Commerce:** Stripe Connect onboarding, destination payments, configurable fees, webhook ledger, refunds, subscription billing, and plan enforcement across all usage dimensions.
5. **Operations:** Notification adapters, reminder policies, richer day/week/month calendar editing, recurring exceptions, exports, promotions, reports, disputes, and moderation.
6. **Scale and observability:** Cursor pagination, aggregate reporting tables, background analytics jobs, idempotency keys, webhook event ledger, structured logs, rate tuning, performance indexes, retention controls, and load testing.
7. **Advanced product:** Custom domains, staff invitations, role permission editor, multi-location businesses, waitlists, resource booking, package sales, gift cards, mobile push, and native applications.

The implemented foundation supports these phases without changing the central tenant boundary or public booking URL model.
