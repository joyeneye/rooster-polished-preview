import { createHash } from "node:crypto";
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./member-auth.mts";
import { listRegisteredMembers, publicMember, type CommunityReader } from "./community-members.mts";
import { readProfile, type ProfileMember, type ProfileStore } from "./member-profiles.mts";

export type TopEightCard = { id: string; name: string; photo_url: string | null; profile_url: string };
type Options = {
  profiles: ProfileStore;
  directory: CommunityReader;
  resolveMember: () => Promise<ProfileMember>;
  approvedIds: () => Promise<string[]>;
  blockedIds: (participants: string[]) => Promise<string[]>;
  friends: (target: string) => Promise<{ member_id: string }[]>;
};
const hidden = (value: any) => value && (value.deleted === true || value.disabled === true || value.visibility === "private" || value.is_private === true || value.public === false);
/** Request-scoped reads keep directory scans and card validation on the same
 * snapshot without caching approvals or privacy decisions across requests. */
function memoReader(store: CommunityReader): CommunityReader {
  const reads = new Map<string, Promise<any>>();
  return {
    get(key, options) {
      if (!reads.has(key)) reads.set(key, store.get(key, options));
      return reads.get(key)!;
    },
    ...(store.list ? { list: store.list.bind(store) } : {}),
  };
}
const stableRank = (target: string, id: string) => createHash("sha256").update(`roster-top-eight-v1:${target}:${id}`).digest("hex");

/** Community picks are display defaults, never friendship edges. An explicit
 * saved selection (including []) is exact; old orders keep their first places. */
export function selectTopEight(target: string, available: TopEightCard[], friendIds: string[], saved: any) {
  const byId = new Map(available.map(card => [card.id, card]));
  const savedIds: string[] = Array.isArray(saved?.order)
    ? [...new Set(saved.order.filter((id: unknown): id is string => typeof id === "string" && byId.has(id)))] as string[] : [];
  const custom = saved?.customized === true;
  const order = custom ? savedIds.slice(0, 8) : [...new Set([
    ...savedIds,
    ...friendIds.filter(id => byId.has(id)),
    ...available.map(card => card.id).sort((a, b) => stableRank(target, a).localeCompare(stableRank(target, b))),
  ])].slice(0, 8);
  return { members: order.map(id => byId.get(id)!), mode: custom ? "custom" : "community" };
}

async function readOrder(req: Request): Promise<string[]> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new MemberError(415, "Choose people in the Top 8 editor.");
  if (!req.body || Number(req.headers.get("content-length") || 0) > 2048) throw new MemberError(413, "Your Top 8 update is too large.");
  const reader = req.body.getReader();
  let text = "", bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); throw new MemberError(413, "Your Top 8 update is too large."); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  let input: any;
  try { input = JSON.parse(text); } catch { throw new MemberError(400, "Your Top 8 choices could not be read."); }
  if (!Array.isArray(input?.order) || input.order.length > 8 || input.order.some((id: unknown) => typeof id !== "string" || !MEMBER_ID.test(id)) || new Set(input.order.map((id: string) => id.toLowerCase())).size !== input.order.length) throw new MemberError(400, "Choose up to eight different people.");
  return input.order.map((id: string) => id.toLowerCase());
}

export async function getTopEightRoster(req: Request, options: Options): Promise<Response> {
  try {
    if (!["GET", "PUT"].includes(req.method)) throw new MemberError(405, "Method not allowed.");
    const member = await options.resolveMember();
    if (!MEMBER_ID.test(member.id)) throw new MemberError(401, "Log in to see your Top 8.");
    const viewer = member.id.toLowerCase();
    const profiles = memoReader(options.profiles), directory = memoReader(options.directory);
    const binding = await profiles.get("owner-binding", { type: "json" });
    if (binding !== null && (!binding || !MEMBER_ID.test(binding.id || ""))) throw new Error("Invalid owner binding");
    const owner: string | null = binding?.id?.toLowerCase() || (member.isOwner ? viewer : null);
    const values = new URL(req.url).searchParams.getAll("target_id");
    if (values.length > 1) throw new MemberError(400, "Choose one roster member.");
    const requested = (values[0] || "self").toLowerCase();
    const target = requested === "self" ? viewer : requested === "owner" ? owner : requested;
    if (!target || !MEMBER_ID.test(target)) throw new MemberError(400, "Choose a valid roster member.");
    if (req.method === "PUT") {
      assertSameOrigin(req);
      if (target !== viewer) throw new MemberError(403, "You can only arrange your own Top 8 Roster.");
    }
    const [registered, approved, blocked, friends] = await Promise.all([
      listRegisteredMembers(profiles, directory),
      options.approvedIds(),
      options.blockedIds([...new Set([target, viewer])]),
      options.friends(target),
    ]);
    const approvedSet = new Set(approved.map(id => id.toLowerCase()));
    if (owner) approvedSet.add(owner);
    const blockedSet = new Set(blocked.map(id => id === "owner" ? owner : id.toLowerCase()));
    if (blockedSet.has(viewer) || blockedSet.has(target)) throw new MemberError(404, "This Top 8 is unavailable.");
    const registeredMap = new Map(registered.map(person => [person.id, person]));
    if (owner && !registeredMap.has(owner)) registeredMap.set(owner, { id: owner, name: "J.White Did It" });
    if (target !== viewer && (!approvedSet.has(target) || !registeredMap.has(target))) throw new MemberError(404, "This Top 8 is unavailable.");
    const publicCard = async (person: { id: string; name: string }): Promise<TopEightCard | null> => {
      const [raw, registration, directoryRecord] = await Promise.all([
        profiles.get(`profiles/${person.id}`, { type: "json" }),
        profiles.get(`public-members/${person.id}`, { type: "json" }),
        directory.get(`members/${person.id}`, { type: "json" }),
      ]);
      if ([raw, registration, directoryRecord].some(hidden)) return null;
      const profile = raw === null ? null : readProfile(raw, person.id);
      // A withdrawn/invalid published page must not become a new empty page.
      if (raw !== null && !profile) return null;
      const display = profile ? publicMember(profile, person.id) : publicMember(person, person.id);
      if (!display) return null;
      return { id: person.id, name: display.name, photo_url: profile?.photo_id ? `/api/profile-photo/${profile.photo_id}` : person.id === owner ? "/profile.jpg" : null, profile_url: `/profile.html?id=${person.id}` };
    };
    if (target !== viewer && !await publicCard(registeredMap.get(target)!)) throw new MemberError(404, "This Top 8 is unavailable.");
    const candidates = [...registeredMap.values()].filter(person => person.id !== target && approvedSet.has(person.id) && !blockedSet.has(person.id));
    const cards: TopEightCard[] = [];
    for (let offset = 0; offset < candidates.length; offset += 12) {
      const batch = await Promise.all(candidates.slice(offset, offset + 12).map(publicCard));
      cards.push(...batch.filter((card): card is TopEightCard => card !== null));
    }
    cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const key = `top-eight-rosters/${target}`;
    let saved = await profiles.get(key, { type: "json" });
    if (!saved && target === owner) saved = await profiles.get("top-eight-rosters/owner", { type: "json" });
    if (Array.isArray(saved?.order)) saved = { ...saved, order: saved.order.map((id: unknown) => id === "owner" ? owner : typeof id === "string" ? id.toLowerCase() : id) };
    if (req.method === "PUT") {
      const order = await readOrder(req);
      const ids = new Set(cards.map(card => card.id));
      if (order.some(id => !ids.has(id))) throw new MemberError(400, "One of those people is unavailable. Refresh your Top 8 and choose again.");
      saved = { member_id: target, order, customized: true, updated_at: new Date().toISOString() };
      const result = await options.profiles.setJSON(key, saved);
      if (result.modified === false) throw new MemberError(503, "Your Top 8 could not save. Please try again.");
    }
    const friendIds = friends.map(friend => friend.member_id === "owner" ? owner : friend.member_id.toLowerCase()).filter((id): id is string => !!id);
    const selected = selectTopEight(target, cards, friendIds, saved);
    return memberJSON({ target_id: target, editable: target === viewer, ...selected, available_count: cards.length, ...(target === viewer ? { available_members: cards } : {}) });
  } catch (error) {
    if (!(error instanceof MemberError)) console.error("top_eight_roster_unavailable", { error_type: error instanceof Error ? error.name : "Unknown" });
    return error instanceof MemberError ? memberJSON({ error: error.status === 401 ? "Log in to see your Top 8." : error.message }, error.status) : memberJSON({ error: "The Top 8 Roster could not connect. Please try again." }, 503);
  }
}
