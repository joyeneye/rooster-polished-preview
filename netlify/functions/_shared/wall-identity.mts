import { MEMBER_ID } from './member-auth.mts';
import { getPublicProfile, type ProfileStore } from './member-profiles.mts';
import type { CommunityReader } from './community-members.mts';

/** What a wall shows beside a comment or a reply. Everything here is read from
 * the member's own public profile at request time, so a member who changes
 * their picture or their display name changes every comment they ever left. */
export type WallIdentity = {
  id: string;
  name: string;
  photo_url: string | null;
  verified: boolean;
  verified_owner: boolean;
  profile_url: string;
};

export type IdentityDependencies = {
  profiles: ProfileStore;
  directory?: CommunityReader;
  friends?: CommunityReader;
};

/** Only the two picture paths the app itself serves are ever handed to a page. */
const PHOTO = /^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/;

export function profileLink(id: string, isOwner: boolean): string {
  return isOwner ? '/#home' : `/profile.html?id=${id}`;
}

async function readIdentity(req: Request, id: string, dependencies: IdentityDependencies): Promise<WallIdentity | null> {
  try {
    const url = new URL('/api/profile', req.url);
    url.searchParams.set('id', id);
    const response = await getPublicProfile(new Request(url), dependencies.profiles, {
      directory: dependencies.directory, friends: dependencies.friends,
    });
    if (!response.ok) return null;
    const { profile } = await response.json();
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) return null;
    const verifiedOwner = profile.verified_owner === true;
    return {
      id,
      name: profile.name,
      photo_url: typeof profile.photo_url === 'string' && PHOTO.test(profile.photo_url) ? profile.photo_url : null,
      verified: profile.verified === true || verifiedOwner,
      verified_owner: verifiedOwner,
      profile_url: profileLink(id, verifiedOwner),
    };
  } catch {
    // A profile that cannot be read leaves the comment with its stored name and
    // an initials picture. It is never joined to some other member instead.
    return null;
  }
}

/**
 * Reads the current public identity for a member ID, once per request. A wall
 * entry is joined to a person by the member ID stored with it and never by
 * matching a name, so an old unattached comment stays unattached.
 */
export function identityReader(req: Request, dependencies?: IdentityDependencies) {
  const cache = new Map<string, Promise<WallIdentity | null>>();
  return async (id: unknown): Promise<WallIdentity | null> => {
    if (typeof id !== 'string' || !MEMBER_ID.test(id) || !dependencies?.profiles) return null;
    const key = id.toLowerCase();
    if (!cache.has(key)) cache.set(key, readIdentity(req, key, dependencies));
    return cache.get(key)!;
  };
}
