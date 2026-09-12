/**
 * Public-data bridge for the isolated Vercel preview.
 *
 * The production API remains on Netlify while its functions, Identity, and
 * storage are migrated. This endpoint intentionally permits only reads, so a
 * visit to the Vercel preview cannot change the live Netlify site.
 */
export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.setHeader('Allow', 'GET, HEAD');
    response.status(405).json({ error: 'This preview only reads public ROOSTER data.' });
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
    const upstream = new URL(`${incoming.pathname}${incoming.search}`, 'https://jwhitedidit.net');
    const upstreamResponse = await fetch(upstream, {
      method: request.method,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        accept: request.headers.accept || '*/*',
        'user-agent': 'ROOSTER-Vercel-Preview/1.0'
      }
    });

    for (const header of ['content-type', 'etag', 'last-modified']) {
      const value = upstreamResponse.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-ROOSTER-Preview-Data', 'Netlify read-only');
    response.status(upstreamResponse.status);

    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    if (!upstreamResponse.ok) {
      const body = await upstreamResponse.json().catch(() => ({}));
      const message = [401, 403].includes(upstreamResponse.status)
        ? 'Approved-account access stays on the original ROOSTER site in this design preview.'
        : typeof body.error === 'string' ? body.error : 'This ROOSTER service is temporarily unavailable.';
      response.setHeader('content-type', 'application/json');
      response.json({ error: message });
      return;
    }
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
  } catch {
    response.status(502).json({ error: 'Public ROOSTER data is temporarily unavailable.' });
  }
}
