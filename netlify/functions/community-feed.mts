import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, MemberError, memberJSON } from "./_shared/member-auth.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { hydrateFeedAuthors } from "./_shared/feed-authors.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
import { createSocialPost, deleteSocialPost, getSocialFeed, saveFeedPreference, updateSocialPost } from "./_shared/social-feed.mts";
import {clipsStore} from './_shared/member-clips.mts';
import {albumStore,findAlbumPhoto} from './_shared/member-albums.mts';

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    if (req.method === "GET") return getSocialFeed(req, member, { profiles: profileStore(context) }, clipsStore(context));
    const url = new URL(req.url);
    if (req.method === "PATCH" && url.searchParams.get("settings") === "feed") return saveFeedPreference(req, member);
    if (req.method === "PATCH") return updateSocialPost(req, member, clipsStore(context));
    if (req.method === "DELETE") return deleteSocialPost(req, member);
    if (req.method !== "POST") throw new MemberError(405, "Choose a supported WYD action.");
    const [postIdentity] = await hydrateFeedAuthors(req, [{ author: { id: member.id, photo_url: member.isOwner ? "/profile.jpg" : null } }], { profiles: profileStore(context) });
    const photos=albumStore(context);
    return createSocialPost(req, member, postIdentity.author.photo_url || "",(memberId,photoId)=>findAlbumPhoto(photos,memberId,photoId));
  } catch (error) {
    if (!(error instanceof MemberError)) console.error("social_feed_unavailable", { error_type: error instanceof Error ? error.name : "Unknown" });
    return error instanceof MemberError ? memberJSON({ error: error.message }, error.status) : memberJSON({ error: "The community feed could not connect. Please try again." }, 503);
  }
};

export const config: Config = {
  path: "/api/community/feed",
  method: ["GET", "POST", "PATCH", "DELETE"],
  rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
