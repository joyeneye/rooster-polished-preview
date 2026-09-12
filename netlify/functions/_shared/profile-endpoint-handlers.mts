export type ProfileEndpointContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type ProfileMember = {
  id: string;
  name: string;
  isOwner: boolean;
};

export type ProfileMeDependencies = {
  resolveMember(): Promise<ProfileMember>;
  readProfile(req: Request, member: ProfileMember): Promise<Response>;
  aftercare?: Array<(member: ProfileMember) => Promise<unknown>>;
  failure(error: unknown): Response;
};

/**
 * Resolve the protected member before reading their own profile. Once a valid
 * response exists, optional welcome and membership bookkeeping are background
 * work: neither their latency nor their failure may replace the profile with a
 * 503 response.
 */
export async function handleProfileMe(
  req: Request,
  context: ProfileEndpointContext,
  dependencies: ProfileMeDependencies,
): Promise<Response> {
  try {
    const member = await dependencies.resolveMember();
    const response = await dependencies.readProfile(req, member);
    if (response.ok && dependencies.aftercare?.length) {
      const work = Promise.allSettled(
        dependencies.aftercare.map(task => Promise.resolve().then(() => task(member))),
      ).then(() => undefined);
      // waitUntil keeps the function alive without making navigation wait.
      // Guard the scheduler too: a valid profile response always wins.
      try { context.waitUntil(work); } catch { void work; }
    }
    return response;
  } catch (error) {
    return dependencies.failure(error);
  }
}

export type ProfileGetDependencies = {
  authorizeMember(): Promise<unknown>;
  readProfile(req: Request): Promise<Response>;
  accessFailure(error: unknown): Response;
  profileFailure(error: unknown): Response;
};

/** Owner is the public landing profile; every UUID profile is gated first. */
export async function handleProfileGet(
  req: Request,
  dependencies: ProfileGetDependencies,
): Promise<Response> {
  try {
    const requested = new URL(req.url).searchParams.getAll("id");
    const isPublicOwner = requested.length === 1 && requested[0] === "owner";
    if (!isPublicOwner) await dependencies.authorizeMember();
    return await dependencies.readProfile(req);
  } catch (error) {
    return error instanceof Error && "status" in error
      ? dependencies.accessFailure(error)
      : dependencies.profileFailure(error);
  }
}
