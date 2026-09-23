/**
 * Data bridge from the Vercel preview to the live ROOSTER API.
 *
 * The production API remains on Netlify while its functions, Identity, and
 * storage are migrated. Reads pass through with the signed-in member's Identity
 * session (the nf_jwt cookie, from sign-in through api/identity.js); no other
 * cookie or header does.
 *
 * Writes are refused except for the ones in WRITABLE below: live rooms and the
 * chat room, the owner's own tools (invitations and approvals, verification,
 * announcements, and a business's booking pages), and a member acting for
 * themselves — roster requests, replies, reactions, comments, posting and deleting their own
 * posts, their album photo, a song link, their Top 8, their photo and status, presence and MONA.
 * Song file uploads and every other account change still stop here.
 */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UPSTREAM = 'https://jwhitedidit.net';

// The only writes that pass, and the methods each one takes. Everything else is refused.
const WRITABLE = new Map([
  // Live rooms and the chat room cannot work at all without these.
  ['/api/live/room', ['POST']],        // create, join, sync, leave, hand, mute, say, host actions
  ['/api/live/signal', ['POST']],      // the WebRTC offers, answers and candidates between members
  ['/api/member-chat/send', ['POST']],
  ['/api/chat-room-presence', ['POST']],
  // The owner's tools: invitations and approvals, verification, announcements, membership.
  ['/api/access/admin', ['POST']],     // its overview read is a POST too
  ['/api/verification/update', ['POST']],
  ['/api/founder/announcements/preview', ['POST']],
  ['/api/founder/announcements/send', ['POST']],
  ['/api/founder/membership', ['POST']],
  ['/api/announcements/read', ['POST']],
  // Members acting for themselves: roster requests out, and answering the ones waiting.
  ['/api/friends/add', ['POST']],
  ['/api/friend-requests/respond', ['POST']],
  ['/api/member-messages/send', ['POST']],
  ['/api/member-messages/read', ['POST']],
  // Reacting and commenting. PATCH only on the feed: that is like, save, repost and
  // comment (social-feed.mts:30). Creating and deleting posts stay closed.
  // PATCH is like, save, repost and comment; POST writes a post (Post, Take a Pic); DELETE is
  // "Delete my post", which the site only allows for your own (social-feed.mts:255-282).
  ['/api/community/feed', ['PATCH', 'POST', 'DELETE']],
  ['/api/clip-reaction', ['POST']],
  ['/api/clip-comment', ['POST']],
  ['/api/member-wall/post', ['POST']],
  // The Review Room: sending a track in, and a room owner answering one.
  ['/api/review-room/submit', ['POST']],
  ['/api/review-room/action', ['POST']],
  // ROOSTER Manager: saving a song, show, person, split sheet or money record.
  ['/api/rcm/workspace', ['POST']],
  // MONA, the assistant in the dock (mona-chat.mts). Its answer arrives as NDJSON lines.
  ['/api/mona/chat', ['POST']],
  // The site's create and edit buttons (WYD and the profile card).
  ['/api/member-album/upload', ['POST']],   // Take a Pic: the photo goes to your album first
  ['/api/member-songs/link', ['POST']],     // Song: a YouTube, Spotify or Apple Music link in a slot
  ['/api/top-eight-roster', ['PUT']],       // Edit Top 8
  ['/api/profile/update', ['POST']],        // Edit photo & status
  ['/api/member-presence', ['POST']],       // the online heartbeat every 45 seconds
  // A business owner's own booking pages.
  ['/api/booking/businesses', ['POST', 'PATCH']],
  ['/api/booking/services', ['POST', 'PATCH']],
  ['/api/booking/hours', ['PATCH']],
  ['/api/booking/staff', ['POST', 'PATCH']],
  ['/api/booking/appointments', ['POST', 'PATCH']],
  ['/api/booking/media', ['POST']],
  ['/api/booking/stripe-connect', ['POST']],
  ['/api/booking/admin', ['PATCH']],
]);
const MAX_BODY = 256 * 1024; // live signal batches are capped at 192 KB upstream
// Uploads need more room than that: a photo for a business page, a track for the Review
// Room. Vercel refuses a request body over 4.5 MB before this function runs, so the real
// ceiling is theirs — staying under it lets the app say something useful instead.
const MAX_UPLOAD = 4 * 1024 * 1024;
const UPLOAD_PATHS = new Set(['/api/booking/media', '/api/review-room/submit', '/api/member-album/upload', '/api/profile/update']);
class BodyTooLarge extends Error {}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new BodyTooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// GET endpoints that do more than a member browsing the live site would set off, so the
// session is never forwarded to them: the owner's screening check makes a paid Gemini call
// (clips-screening-health.mts), and clip status syncs and rewrites the member's feed post
// (member-clips.mts, clip-feed.mts). Uploads are refused here anyway.
const NO_SESSION = [/^\/api\/clips\/screening-health\/?$/, /^\/api\/clips\/status(\/|$)/];

function memberSession(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== 'nf_jwt') continue;
    let value = rest.join('=');
    try { value = decodeURIComponent(value); } catch { return null; }
    return JWT.test(value) && value.length < 8192 ? value : null;
  }
  return null;
}

export default async function handler(request, response) {
  const method = request.method || 'GET';
  // Edit Top 8 is a PUT and Delete my post is a DELETE on the site, so the bridge speaks both —
  // but only for the paths in WRITABLE that name them.
  const write = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    response.setHeader('Allow', 'GET, HEAD, POST, PATCH, PUT, DELETE');
    response.status(405).json({ error: 'Posting and changes from the ROOSTER app are coming soon.' });
    return;
  }

  try {
    const incoming = new URL(request.url || '/', 'https://preview.rooster.local');
    const routedPath = incoming.searchParams.get('__rooster_path');
    incoming.searchParams.delete('__rooster_path');
    if (routedPath !== null) {
      if (!routedPath || !/^[A-Za-z0-9_./-]+$/.test(routedPath) || routedPath.split('/').some(part => !part || part === '.' || part === '..')) {
        response.status(404).json({ error: 'Unknown preview endpoint.' });
        return;
      }
      incoming.pathname = '/api/' + routedPath;
    }
    if (!incoming.pathname.startsWith('/api/')) {
      response.status(404).json({ error: 'Unknown preview endpoint.' });
      return;
    }
    if (write && !(WRITABLE.get(incoming.pathname) || []).includes(method)) {
      response.setHeader('Allow', 'GET, HEAD');
      response.status(405).json({ error: 'Posting and changes from the ROOSTER app are coming soon.' });
      return;
    }
    // Same-origin writes only, then the app's own origin is replaced with the live site's, which
    // the member API requires (member-auth.mts assertSameOrigin).
    if (write) {
      const origin = request.headers.origin;
      if (!origin || origin !== `https://${request.headers.host}`) {
        response.status(403).json({ error: 'Open this from the ROOSTER app.' });
        return;
      }
    }

    let payload;
    if (write) {
      const limit = UPLOAD_PATHS.has(incoming.pathname) ? MAX_UPLOAD : MAX_BODY;
      try {
        payload = await readBody(request, limit);
      } catch (error) {
        if (!(error instanceof BodyTooLarge)) throw error;
        const megabytes = Math.floor(limit / (1024 * 1024));
        response.status(413).json({
          error: megabytes
            ? `That file is too big to send from the app. Keep it under ${megabytes} MB.`
            : 'That is too much to send from the app at once.'
        });
        return;
      }
    }

    const upstream = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM);
    const session = NO_SESSION.some(pattern => pattern.test(incoming.pathname)) ? null : memberSession(request.headers.cookie);
    const upstreamResponse = await fetch(upstream, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      body: payload,
      headers: {
        accept: request.headers.accept || '*/*',
        'user-agent': 'ROOSTER-Vercel-Preview/1.0',
        ...(session ? { cookie: `nf_jwt=${session}` } : {}),
        ...(write ? { origin: UPSTREAM, 'content-type': request.headers['content-type'] || 'application/json' } : {})
      }
    });

    for (const header of ['content-type', 'etag', 'last-modified']) {
      const value = upstreamResponse.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-ROOSTER-Preview-Data', 'Netlify read-only');
    response.setHeader('Vary', 'Cookie');
    response.status(upstreamResponse.status);

    if (method === 'HEAD') {
      response.end();
      return;
    }
    if (!upstreamResponse.ok) {
      const body = await upstreamResponse.json().catch(() => ({}));
      // The member API writes its own plain-English refusals, so those pass straight through.
      // Anything else — including Netlify's nested {error:{message}} — is not worth showing:
      // a sign-in problem should say so rather than read as an outage.
      const supplied = typeof body.error === 'string' ? body.error : '';
      const denied = upstreamResponse.status === 401 || upstreamResponse.status === 403;
      // Netlify's own rate limiter answers 429 without an {error} body.
      const busy = upstreamResponse.status === 429;
      const message = supplied
        || (denied ? 'Approved-account data needs a signed-in ROOSTER member.'
            : busy ? 'Too many requests right now. Wait a few minutes and try again.'
            : 'This ROOSTER service is temporarily unavailable.');
      response.setHeader('content-type', 'application/json');
      response.json({ error: message });
      return;
    }
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch {
    response.status(502).json({ error: 'Public ROOSTER data is temporarily unavailable.' });
  }
}
