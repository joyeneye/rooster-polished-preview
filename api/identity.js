/**
 * Netlify Identity for the Vercel preview, served by the live site's Identity service.
 *
 * Members sign in with their jwhitedidit.net account. Only the calls a session needs pass
 * through: settings, sign-in and token refresh, reading the signed-in account, a
 * password-reset email and sign-out. Sign-up, invitations, email confirmation and account
 * changes stay on jwhitedidit.net.
 */
const IDENTITY = 'https://jwhitedidit.net/.netlify/identity';
const ALLOWED = new Set(['GET settings', 'HEAD settings', 'POST token', 'GET user', 'HEAD user', 'POST logout', 'POST recover']);
const MAX_BODY = 16 * 1024;

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

export default async function handler(request, response) {
  const incoming = new URL(request.url || '/', 'https://preview.rooster.local');
  const endpoint = incoming.searchParams.get('__identity_path') || '';
  const method = request.method || 'GET';
  response.setHeader('Cache-Control', 'no-store');

  if (!ALLOWED.has(`${method} ${endpoint}`)) {
    response.status(404).json({ error: 'Manage your account on jwhitedidit.net.' });
    return;
  }
  // token, logout and recover change session state: same-origin browser calls or the app only.
  const origin = request.headers.origin;
  if (method === 'POST' && origin && origin !== `https://${request.headers.host}`) {
    response.status(403).json({ error: 'Sign in from ROOSTER.' });
    return;
  }

  try {
    const headers = { accept: 'application/json', 'user-agent': 'ROOSTER-Vercel-Preview/1.0' };
    for (const name of ['authorization', 'content-type']) {
      if (request.headers[name]) headers[name] = request.headers[name];
    }
    const body = method === 'POST' ? await readBody(request) : undefined;
    const upstream = await fetch(`${IDENTITY}/${endpoint}`, {
      method,
      headers,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    response.status(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) response.setHeader('content-type', type);
    if (method === 'HEAD') {
      response.end();
      return;
    }
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.status(502).json({ error: 'ROOSTER sign-in is temporarily unavailable.' });
  }
}
