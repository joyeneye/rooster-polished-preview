import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import {
  announcementAccess, announcementFailure, previewAnnouncement,
  readAnnouncementDraft, readAnnouncementRequest, requireAnnouncer,
} from "./_shared/founder-announcements.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";

/** How many people this announcement would reach, and exactly what they would
 * read, before anything is sent. */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const access = await announcementAccess(member, profileStore(context));
    const founderId = requireAnnouncer(access);
    const draft = readAnnouncementDraft(await readAnnouncementRequest(req));
    return memberJSON({ preview: await previewAnnouncement(draft, founderId) });
  } catch (error) {
    return announcementFailure(error);
  }
};

export const config: Config = {
  path: "/api/founder/announcements/preview",
  method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
