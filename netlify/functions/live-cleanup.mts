import type { Config } from "@netlify/functions";
import { pruneLive } from "./_shared/roster-live.mts";

/** Closes rooms nobody is in and clears connection setup nobody collected.
 * Every read does this too, so this only matters for the quiet hours when no
 * member is looking: without it, a room whose host closed their laptop would
 * sit in the list until somebody opened ROOSTER LIVE again. */
export default async (): Promise<void> => {
  await pruneLive();
};

export const config: Config = { schedule: "*/5 * * * *" };
