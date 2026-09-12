import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { MEMBER_ID, MemberError, type Member } from "./member-auth.mts";
import { POLICY_VERSION } from "./comment-moderation.mts";

export interface CommunityReader {
  get(key: string, options: { type: "json" }): Promise<any>;
  list?(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
}
export interface CommunityWriter extends CommunityReader {
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}

export function communityDirectory(context: Context): CommunityWriter {
  const options = { name: "member-directory", consistency: "strong" as const };
  return context.deploy.context === "production" ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}

/** Only explicitly public identifiers and display names leave account storage. */
export function publicMember(value: any, expected?: string): Member | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.id !== "string" || !MEMBER_ID.test(value.id) ||
      (expected && value.id.toLowerCase() !== expected.toLowerCase()) ||
      typeof value.name !== "string" || !value.name.trim() || value.name.length > 60 ||
      /[@\u0000-\u001f\u007f]/.test(value.name) || value.deleted === true || value.disabled === true) return null;
  return { id: value.id.toLowerCase(), name: value.name.trim() };
}

/** Call only AFTER Identity verification. This does not approve any bio/photo
 * or overwrite an edited profile. A durable membership card makes a new page
 * available before the member opens the profile editor. */
export async function registerPublicMember(member: Member, profiles: CommunityWriter, directory?: CommunityWriter): Promise<void> {
  const safe = publicMember(member);
  if (!safe) throw new MemberError(400, "Your member account could not be read.");
  const key = `public-members/${safe.id}`;
  if (!publicMember(await profiles.get(key, { type: "json" }), safe.id)) {
    await profiles.setJSON(key, { ...safe, joined_at: new Date().toISOString() }, { onlyIfNew: true });
    if (!publicMember(await profiles.get(key, { type: "json" }), safe.id)) throw new Error("Member page registration was not saved");
  }
  if (directory && !publicMember(await directory.get(`members/${safe.id}`, { type: "json" }), safe.id)) {
    await directory.setJSON(`members/${safe.id}`, { ...safe, joined_at: new Date().toISOString() }, { onlyIfNew: true });
    if (!publicMember(await directory.get(`members/${safe.id}`, { type: "json" }), safe.id)) throw new Error("Member directory registration was not saved");
  }
}

/** Resolve existing registered members and legacy friend-only entries without
 * granting arbitrary UUIDs a profile or publishing private account metadata. */
export async function findRegisteredMember(id: string, profiles?: CommunityReader, directory?: CommunityReader,
  friends?: CommunityReader, owner?: string | null): Promise<Member | null> {
  if (!MEMBER_ID.test(id)) return null;
  id = id.toLowerCase();
  if (profiles) {
    const registered = publicMember(await profiles.get(`public-members/${id}`, { type: "json" }), id);
    if (registered) return registered;
    const saved = await profiles.get(`profiles/${id}`, { type: "json" });
    if (saved?.approved === true && saved.policy_version === POLICY_VERSION) {
      const member = publicMember(saved, id); if (member) return member;
    }
  }
  if (directory) {
    const member = publicMember(await directory.get(`members/${id}`, { type: "json" }), id);
    if (member) return member;
  }
  if (friends) {
    for (const target of owner ? ["owner", owner] : ["owner"]) {
      const saved = await friends.get(`target/${target}/${id}`, { type: "json" });
      const member = publicMember(saved && { id: saved.member_id, name: saved.member_name }, id);
      if (member) return member;
    }
  }
  return null;
}

/** Existing confirmed page creators are included, not only future signups.
 * Enumerate all pages with hard bounds; fail rather than display a partial total. */
export async function listRegisteredMembers(profiles?: CommunityReader, directory?: CommunityReader): Promise<Member[]> {
  const members = new Map<string, Member>();
  let pages = 0, keysSeen = 0;
  const scan = async (store: CommunityReader | undefined, prefix: string, published = false) => {
    if (!store?.list) return;
    for await (const page of store.list({ prefix, paginate: true })) {
      if (++pages > 100) throw new MemberError(503, "The member list is busy. Please try again.");
      const keys = page.blobs.map(blob => blob.key).filter(key => typeof key === "string" && key.startsWith(prefix) && MEMBER_ID.test(key.slice(prefix.length)));
      if ((keysSeen += keys.length) > 10000) throw new MemberError(503, "The member list is busy. Please try again.");
      for (let offset = 0; offset < keys.length; offset += 12) {
        const values = await Promise.all(keys.slice(offset, offset + 12).map(async key => ({ key, value: await store.get(key, { type: "json" }) })));
        for (const { key, value } of values) {
          if (published && (value?.approved !== true || value.policy_version !== POLICY_VERSION)) continue;
          const member = publicMember(value, key.slice(prefix.length));
          if (member) members.set(member.id, member);
        }
      }
    }
  };
  await scan(directory, "members/");
  await scan(profiles, "public-members/");
  await scan(profiles, "profiles/", true);
  return [...members.values()];
}
