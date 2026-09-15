/**
 * Data bridge from the Vercel preview to the live ROOSTER API.
 *
 * The production API remains on Netlify while its functions, Identity, and
 * storage are migrated. Reads pass through with the signed-in member's Identity
 * session (the nf_jwt cookie, from sign-in through api/identity.js); no other
 * cookie or header does.
 *
 * Writes are refused except for live rooms and the chat room, which cannot work
 * at all without them: joining a room, staying in it, the WebRTC handshake, and
 * saying something. Posting, likes, comments, uploads and account changes still
 * stop here.
 */
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UPSTREAM = 'https://jwhitedidit.net';

// The only writes that pass. Everything else is refused.
const WRITABLE = new Set([
  '/api/live/room',        // create, join, sync, leave, hand, mute, say, host actions
  '/api/live/signal',      // the WebRTC offers, answers and candidates between members
  '/api/member-chat/send', // the Listening Room
  '/api/chat-room-presence',
]);
const MAX_BODY = 256 * 1024; // live signal batches are capped at 192 KB upstream

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too large');
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
  const write = method === 'POST';
  if (!['GET', 'HEAD', 'POST'].includes(method)) {
    response.setHeader('Allow', 'GET, HEAD, POST');
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
    if (write && !WRITABLE.has(incoming.pathname)) {
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

    const upstream = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM);
    const session = NO_SESSION.some(pattern => pattern.test(incoming.pathname)) ? null : memberSession(request.headers.cookie);
    const upstreamResponse = await fetch(upstream, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      body: write ? await readBody(request) : undefined,
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
      const message = typeof body.error === 'string' ? body.error : 'This ROOSTER service is temporarily unavailable.';
      response.setHeader('content-type', 'application/json');
      response.json({ error: message });
      return;
    }
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch {
    response.status(502).json({ error: 'Public ROOSTER data is temporarily unavailable.' });
  }
}
