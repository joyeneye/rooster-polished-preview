import { identityReader, type IdentityDependencies } from './wall-identity.mts';

type FeedAuthorPost = {
  author: { id: string; photo_url: string | null };
};

/** Join only the already-authorized feed posts to their own public profile.
 * Reading the current identity makes a photo change appear on old posts too,
 * without rewriting post rows or waiting for the author to visit WYD again.
 * The identity reader caches by member ID for this request only.
 */
export async function hydrateFeedAuthors<T extends FeedAuthorPost>(
  req: Request, posts: T[], dependencies?: IdentityDependencies,
): Promise<T[]> {
  const readIdentity = identityReader(req, dependencies);
  return Promise.all(posts.map(async post => {
    const identity = await readIdentity(post.author.id);
    const storedPhoto = typeof post.author.photo_url === 'string'
      && /^\/(?:profile\.jpg|api\/profile-photo\/[a-f0-9]{64})$/.test(post.author.photo_url)
      ? post.author.photo_url : null;
    // A readable profile with no photo must clear an obsolete photo. A lookup
    // outage can retain only this post's own previously stored app photo.
    const photo = identity ? identity.photo_url : storedPhoto;
    return { ...post, author: { ...post.author, photo_url: photo } };
  }));
}
