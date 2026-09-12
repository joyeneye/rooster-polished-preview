import { MEMBER_ID, MemberError, memberJSON } from './member-auth.mts';
import { getPublicProfile, type ProfileStore } from './member-profiles.mts';
import { listRegisteredMembers, type CommunityReader } from './community-members.mts';
import { publishedSongSnapshot, type SongStores } from './member-songs.mts';

export const SEARCH_NAME = 'ROOSTER Search';
export const SEARCH_NAV_LABEL = 'ROOSTER Search';
export const SEARCH_SECTIONS = ['ROOSTER', 'Google'] as const;

const QUERY_LIMIT = 80;
const PAGE_LIMIT = 12;
const MEMBER_BATCH = 12;
const SONG_BATCH = 6;
const SONG_SCAN = 60;

/** The ROOSTER side only ever reads what a profile already publishes. Private
 * messages, email addresses, private uploads, hidden or withdrawn profiles and
 * owner controls are not in any of these fields and are never looked up. */
const PROFILE_FIELDS = ['about_me', 'title_lines', 'credentials', 'location', 'status'] as const;

/** The provider names the app already shows next to a member's songs. */
const PROVIDER_NAMES: Record<string, string> = { apple: 'Apple Music', spotify: 'Spotify', youtube: 'YouTube' };

export function readQuery(req: Request): { query: string; needle: string; offset: number } {
  const params = new URL(req.url).searchParams;
  const query = (params.get('q') || '').replace(/\s+/g, ' ').trim();
  const offset = Number(params.get('offset') || 0);
  if (query.length > QUERY_LIMIT) throw new MemberError(400, `Shorten your search to ${QUERY_LIMIT} characters.`);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 240) throw new MemberError(400, 'Start your search again.');
  return { query, needle: query.toLocaleLowerCase(), offset };
}

export function searchFailure(error: unknown, section: string): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: `${section} results could not load. Please try again.` }, 503);
}

/** A one-line description built only from the profile's own public text. */
function describe(profile: any, needle: string): string {
  const parts = PROFILE_FIELDS
    .map(field => String(profile[field] || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const matching = needle ? parts.find(part => part.toLocaleLowerCase().includes(needle)) : null;
  const text = matching || parts[0] || '';
  return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
}

const matches = (profile: any, needle: string): boolean =>
  !needle || String(profile.name || '').toLocaleLowerCase().includes(needle) ||
  PROFILE_FIELDS.some(field => String(profile[field] || '').toLocaleLowerCase().includes(needle));

export type RosterResult = {
  kind: 'member' | 'song';
  id: string; title: string; subtitle: string; description: string;
  photo_url: string | null; open_url: string; open_label: string;
  provider?: string | null; verified?: boolean;
};

/**
 * Searches members, their public profile text and their published songs. Every
 * profile is read back through getPublicProfile, so the app's existing privacy
 * rules decide what is visible here too, rather than a second set of rules.
 */
export async function rosterResults(req: Request, stores: SongStores, needle: string, limit = PAGE_LIMIT * 4): Promise<RosterResult[]> {
  const { profiles, directory, friends } = stores;
  const registered = await listRegisteredMembers(profiles as unknown as CommunityReader, directory);
  const binding = await profiles.get('owner-binding', { type: 'json' });
  const owner = typeof binding?.id === 'string' && MEMBER_ID.test(binding.id) ? binding.id.toLowerCase() : null;
  const members: RosterResult[] = [];
  const found: { id: string; name: string }[] = [];

  for (let index = 0; index < registered.length && members.length < limit; index += MEMBER_BATCH) {
    const page = await Promise.all(registered.slice(index, index + MEMBER_BATCH).map(async member => {
      const response = await getPublicProfile(new Request(new URL(`/api/profile?id=${member.id}`, req.url)), profiles, { directory, friends });
      if (!response.ok) return null;
      const { profile } = await response.json();
      return profile && matches(profile, needle) ? { member, profile } : null;
    }));
    for (const entry of page) {
      if (!entry) continue;
      const isOwner = entry.member.id === owner;
      members.push({
        kind: 'member', id: entry.member.id, title: entry.profile.name,
        subtitle: isOwner ? 'On the ROOSTER · Site owner' : 'On the ROOSTER',
        description: describe(entry.profile, needle), photo_url: entry.profile.photo_url ?? null,
        open_url: isOwner ? '/#home' : `/profile.html?id=${entry.member.id}`,
        open_label: 'Open in ROOSTER', verified: entry.profile.verified === true,
      });
      found.push({ id: entry.member.id, name: entry.profile.name });
    }
  }

  const songs: RosterResult[] = [];
  if (needle) {
    const scan = registered.slice(0, SONG_SCAN);
    for (let index = 0; index < scan.length && songs.length < limit; index += SONG_BATCH) {
      const page = await Promise.all(scan.slice(index, index + SONG_BATCH).map(async member => {
        const snapshot = await publishedSongSnapshot(req, stores, member.id).catch(() => null);
        if (!snapshot?.songs.length) return [];
        const name = found.find(entry => entry.id === member.id)?.name || member.name;
        return snapshot.songs
          .filter((song: any) => String(song.title || '').toLocaleLowerCase().includes(needle) || name.toLocaleLowerCase().includes(needle))
          .map((song: any): RosterResult => ({
            kind: 'song', id: `${member.id}-${song.slot}`, title: song.title || 'Untitled song',
            subtitle: `Song on ${name}'s page`,
            description: PROVIDER_NAMES[song.provider]
              ? `Plays on their ROOSTER profile through ${PROVIDER_NAMES[song.provider]}.`
              : 'Plays on their ROOSTER profile.',
            photo_url: null, open_url: member.id === owner ? '/#music' : `/profile.html?id=${member.id}#music`,
            open_label: 'Open in ROOSTER', provider: PROVIDER_NAMES[song.provider] ?? null,
          }));
      }));
      for (const group of page) songs.push(...group);
    }
  }

  return [...members, ...songs];
}

export async function getRosterSearch(req: Request, stores: SongStores): Promise<Response> {
  if (req.method !== 'GET') return memberJSON({ error: 'Method not allowed.' }, 405);
  try {
    const { query, needle, offset } = readQuery(req);
    const all = await rosterResults(req, stores, needle);
    const page = all.slice(offset, offset + PAGE_LIMIT);
    return memberJSON({
      section: 'ROOSTER', query, results: page, total: all.length,
      next_offset: offset + PAGE_LIMIT < all.length ? offset + PAGE_LIMIT : null,
    });
  } catch (error) { return searchFailure(error, 'ROOSTER'); }
}

/* ------------------------------------------------------------ google search */

export type EnvReader = (key: string) => string | undefined;
export const siteEnv: EnvReader = key => (globalThis as any).Netlify?.env?.get?.(key) ?? process.env[key];

/** The one setting Google results inside ROOSTER need. It is a Programmable
 * Search Engine ID, not an API key, and no Custom Search JSON API call is
 * made anywhere in this app. */
export const GOOGLE_ENGINE_VARIABLE = 'GOOGLE_SEARCH_ENGINE_ID';
export const GOOGLE_ENGINE_LOCATION = 'Netlify site settings, Environment variables';

/** The only sentence the public page shows when Google results are not wired
 * up inside ROOSTER. It names no provider, no variable and no API. */
export const GOOGLE_UNAVAILABLE = 'Google results are not available inside ROOSTER yet. Use Search Google to see your results.';

const ENGINE_ID = /^[A-Za-z0-9][A-Za-z0-9_:-]{3,62}[A-Za-z0-9]$/;
const PLACEHOLDER = /^(?:your|my|the|test|sample|example|placeholder|changeme|todo|none|unset|xxx)/i;

/**
 * Reads the Programmable Search Engine ID from the site environment. Anything
 * missing, malformed or left as a placeholder counts as not configured, so the
 * page never claims Google is connected when it is not.
 */
export function googleEngineId(env: EnvReader = siteEnv): string | null {
  const value = String(env(GOOGLE_ENGINE_VARIABLE) ?? '').trim();
  if (!ENGINE_ID.test(value) || PLACEHOLDER.test(value)) return null;
  return value;
}

/** The member's exact words on Google's own results page. No API, no key. */
export function googleSearchLink(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Tells the page whether Google results can be shown inside ROOSTER. When an
 * engine ID is set the page loads Google's own Programmable Search Engine and
 * Google renders the results itself. When it is not set the page shows one
 * sentence and the Search Google button, and nothing pretends otherwise.
 */
export async function getGoogleSearch(req: Request, options: { env?: EnvReader } = {}): Promise<Response> {
  if (req.method !== 'GET') return memberJSON({ error: 'Method not allowed.' }, 405);
  try {
    const { query } = readQuery(req);
    const engine = googleEngineId(options.env ?? siteEnv);
    const google_url = googleSearchLink(query);
    if (!engine) return memberJSON({ section: 'Google', configured: false, query, google_url, message: GOOGLE_UNAVAILABLE });
    return memberJSON({ section: 'Google', configured: true, query, google_url, engine_id: engine });
  } catch (error) { return searchFailure(error, 'Google'); }
}
