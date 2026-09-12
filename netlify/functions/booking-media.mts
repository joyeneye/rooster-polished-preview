import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { assertBookingOrigin, bookingFailure, BookingError, bookingJSON, cleanText, numberParam, requireBusinessAccess } from "./_shared/booking-auth.mts";

function mediaStore(context: Context) {
  const options = { name: "booking-media", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}

export default async function bookingMedia(req: Request, context: Context): Promise<Response> {
  try {
    const store = mediaStore(context);
    if (req.method === "GET") {
      const key = cleanText(new URL(req.url).searchParams.get("key"), 240, true);
      if (!/^business\/\d+\/[a-f0-9-]+\.webp$/.test(key)) throw new BookingError(400, "Image key is invalid.");
      const blob = await store.get(key, { type: "blob" });
      if (!blob) throw new BookingError(404, "Image not found.");
      return new Response(blob, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" } });
    }
    assertBookingOrigin(req);
    const form = await req.formData();
    const businessId = numberParam(form.get("businessId"), "Business");
    await requireBusinessAccess(businessId, ["owner", "manager"]);
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1 || file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new BookingError(400, "Upload a JPG, PNG, or WebP image under 8 MB.");
    const output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "warning", limitInputPixels: 30_000_000 }).rotate().resize({ width: 2400, height: 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
    const key = `business/${businessId}/${randomUUID()}.webp`;
    await store.set(key, output, { metadata: { contentType: "image/webp", businessId: String(businessId) } });
    return bookingJSON({ key, url: `/api/booking/media?key=${encodeURIComponent(key)}` }, 201);
  } catch (error) { return bookingFailure(error); }
}

export const config: Config = { path: "/api/booking/media", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
