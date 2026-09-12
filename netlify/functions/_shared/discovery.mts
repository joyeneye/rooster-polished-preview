import { audioTransferStore, readAudioUpload, smallAudioJSON } from "./audio-transfers.mts";
import { randomUUID } from "node:crypto";
import { getUser, type User } from "@netlify/identity";
import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { assertSameOrigin, MemberError, memberJSON } from "./member-auth.mts";
import { requireCommunityMember } from "./roster-access.mts";

const AUDIO_LIMIT = 100 * 1024 * 1024;
const BODY_LIMIT = 4.25 * 1024 * 1024;
const STORE = { name: "talent-discovery", consistency: "strong" as const };
const SUBMISSION_ID = /^[a-f0-9-]{36}$/;

function env(key: string): string | undefined {
  return (globalThis as any).Netlify?.env?.get?.(key) ?? process.env[key];
}
function storeFor(context: Context) {
  return context.deploy.context === "production" ? getStore(STORE) : getDeployStore({ ...STORE, deployID: context.deploy.id });
}
function chicagoDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
async function member(load: () => Promise<User | null> = getUser) {
  const user = await load();
  const basic = await requireCommunityMember(async () => user);
  const ownerEmail = env("SITE_OWNER_EMAIL")?.trim().toLowerCase();
  const isOwner = !!ownerEmail && typeof user?.email === "string" && user.email.trim().toLowerCase() === ownerEmail;
  return { ...basic, isOwner };
}
function clean(value: FormDataEntryValue | null, max: number, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new MemberError(400, "Please fill in the song details.");
    return "";
  }
  const out = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((required && !out) || out.length > max) throw new MemberError(400, "Please shorten the song details and try again.");
  return out;
}
async function multipart(req: Request): Promise<FormData> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data;")) throw new MemberError(415, "Choose a song from your phone to submit.");
  if (Number(req.headers.get("content-length") || 0) > BODY_LIMIT) throw new MemberError(413, "That song file is too large. Use a compressed MP3 or M4A up to 100 MB.");
  if (!req.body) throw new MemberError(400, "Choose a song to submit.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > BODY_LIMIT) { await reader.cancel(); throw new MemberError(413, "That song file is too large. Use a compressed MP3 or M4A up to 100 MB."); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Request(req.url, { method: "POST", headers: { "Content-Type": req.headers.get("content-type")! }, body: bytes }).formData(); }
  catch { throw new MemberError(400, "That song could not be read. Try another file."); }
}
async function audio(value: FormDataEntryValue | null) {
  if (!(value instanceof File) || !value.size) throw new MemberError(400, "Choose one song to send to J.White.");
  if (value.size > AUDIO_LIMIT) throw new MemberError(413, "That song is too large. Use a compressed MP3 or M4A up to 100 MB.");
  const bytes = await value.arrayBuffer(); const data = new Uint8Array(bytes);
  const ascii = (s: number, e: number) => String.fromCharCode(...data.slice(s, e));
  const mp3 = data.length > 3 && (ascii(0,3) === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0));
  const wav = data.length > 12 && ascii(0,4) === "RIFF" && ascii(8,12) === "WAVE";
  const mp4 = data.length > 12 && ascii(4,8) === "ftyp";
  if (!mp3 && !wav && !mp4) throw new MemberError(415, "Use an MP3, M4A or WAV audio file.");
  const mime = mp3 ? "audio/mpeg" : wav ? "audio/wav" : "audio/mp4";
  return { bytes, mime, original_name: value.name.slice(0, 120) };
}
function failure(error: unknown) {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status) : memberJSON({ error: "Discovery is unavailable right now. Please try again." }, 503);
}

export async function discoveryStatus(req: Request, context: Context) {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const m = await member(); const day = chicagoDay(); const store = storeFor(context);
    const today = await store.get(`daily/${day}/${m.id}`, { type: "json" });
    return memberJSON({ submitted_today: !!today, submitted_at: today?.created_at || null, is_owner: m.isOwner, day });
  } catch (e) { return failure(e); }
}

export async function submitDiscovery(req: Request, context: Context) {
  if (req.method !== "POST") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const m = await member();
    if (m.isOwner) throw new MemberError(403, "Your owner account receives submissions instead of sending them.");
    const store = storeFor(context); const day = chicagoDay();
    const already = await store.get(`daily/${day}/${m.id}`, { type: "json" });
    if (already) throw new MemberError(429, "You already sent today's song. Come back tomorrow with your next best one.");
    let form: FormData;
    if ((req.headers.get("content-type")||"").split(";")[0].trim().toLowerCase() === "application/json") {
      const input=await smallAudioJSON(req);
      const file=await readAudioUpload(audioTransferStore(context),m.id,input.upload_id,"discovery");
      if(typeof input.title!=="string" || (input.note!==undefined && typeof input.note!=="string")) throw new MemberError(400,"Please fill in the song details.");
      form=new FormData();form.set("title",input.title);form.set("note",input.note||"");form.set("song",file,file.name);
    } else form = await multipart(req);
    if (form.getAll("song").length !== 1 || form.getAll("title").length !== 1 || form.getAll("note").length > 1) throw new MemberError(400, "Send one song at a time.");
    const title = clean(form.get("title"), 100, true);
    const note = clean(form.get("note"), 280, false);
    const track = await audio(form.get("song"));
    const id = randomUUID(); const createdAt = new Date().toISOString();
    await store.set(`audio/${id}`, track.bytes, { metadata: { mime: track.mime } });
    const record = { id, member_id: m.id, member_name: m.name, title, note, original_name: track.original_name, mime: track.mime, created_at: createdAt, day };
    await store.setJSON(`submission/${createdAt}/${id}`, record);
    await store.setJSON(`daily/${day}/${m.id}`, { id, created_at: createdAt });
    return memberJSON({ ok: true, submission: { id, title, created_at: createdAt }, message: "Sent to J.White. That's your one for today." }, 201);
  } catch (e) { return failure(e); }
}

export async function listDiscovery(req: Request, context: Context) {
  if (req.method !== "GET") return memberJSON({ error: "Method not allowed." }, 405);
  try {
    assertSameOrigin(req);
    const m = await member(); if (!m.isOwner) throw new MemberError(403, "Discovery is private to J.White.");
    const store = storeFor(context); const listed = await store.list({ prefix: "submission/" });
    const newest = listed.blobs.sort((a,b) => b.key.localeCompare(a.key)).slice(0, 100);
    const submissions = (await Promise.all(newest.map(x => store.get(x.key, { type: "json" })))).filter(Boolean);
    return memberJSON({ submissions });
  } catch (e) { return failure(e); }
}

export async function discoveryAudio(req: Request, context: Context, id: string) {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  try {
    const m = await member(); if (!m.isOwner) throw new MemberError(403, "Discovery is private to J.White.");
    if (!SUBMISSION_ID.test(id)) throw new MemberError(400, "Invalid submission.");
    const store = storeFor(context); const item = await store.getWithMetadata(`audio/${id}`, { type: "arrayBuffer" });
    if (!item?.data) throw new MemberError(404, "Song not found.");
    const mime = typeof item.metadata?.mime === "string" ? item.metadata.mime : "audio/mpeg";
    const bytes = item.data as ArrayBuffer;
    const headers = new Headers({"Content-Type":mime,"Cache-Control":"private, no-store","Netlify-CDN-Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Accept-Ranges":"bytes","Content-Length":String(bytes.byteLength),"Cross-Origin-Resource-Policy":"same-origin"});
    const range=req.headers.get("range");
    if(range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start=0,end=bytes.byteLength-1;
      if(!match || (!match[1]&&!match[2])) return new Response(null,{status:416,headers:{"Content-Range":`bytes */${bytes.byteLength}`}});
      if(match[1]) { start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2])); }
      else { const suffix=Number(match[2]); if(!Number.isSafeInteger(suffix)||suffix<=0)return new Response(null,{status:416,headers});start=Math.max(0,bytes.byteLength-suffix); }
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=bytes.byteLength||end<start)return new Response(null,{status:416,headers});
      end=Math.min(end,start+2*1024*1024-1);headers.set("Content-Length",String(end-start+1));headers.set("Content-Range",`bytes ${start}-${end}/${bytes.byteLength}`);
      return new Response(bytes.slice(start,end+1),{status:206,headers});
    }
    return new Response(new Blob([bytes]).stream(),{headers});
  } catch (e) {
    if (e instanceof MemberError) return new Response(e.message, { status: e.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response("Song unavailable.", { status: 503 });
  }
}
