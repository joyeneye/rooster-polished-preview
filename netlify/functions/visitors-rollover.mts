import type { Config, Context } from "@netlify/functions";
import { rolloverWeeks } from "./_shared/profile-visitors.mts";
import { visitorContext } from "./_shared/visitor-stores.mts";
export default async (req: Request, ctx: Context) => {
  const { visitors, profiles, lookup } = visitorContext(ctx);
  await rolloverWeeks(req, visitors, profiles, lookup);
};
export const config: Config = { schedule: "23 * * * *" };
