// Renew before a protected request leaves the browser. A temporary failure
// rejects that request without destroying Identity's saved credentials.
export function createSessionFetch({fetch: send, renew, origin, now = Date.now}) {
  let pending = null;
  let checkedAt = -Infinity;
  async function ensure(force = false) {
    if (pending) return pending;
    if (!force && now() - checkedAt < 15_000) return;
    pending = Promise.resolve().then(renew).then(() => { checkedAt = now(); });
    try { await pending; } finally { pending = null; }
  }
  async function request(input, options) {
    const requestURL = typeof input === 'string' || input instanceof URL ? input : input.url;
    const url = new URL(requestURL, origin);
    const credentials = options?.credentials ?? input?.credentials;
    const headers = new Headers(options?.headers ?? input?.headers);
    const usesSession = url.origin === origin && url.pathname.startsWith('/api/')
      && credentials !== 'omit' && !headers.has('Authorization');
    if (usesSession) await ensure();
    // Do not replay writes or substitute responses. Every API still checks its
    // own membership, approval and permissions against the current credentials.
    return send(input, options);
  }
  return {request, ensure, invalidate() { checkedAt = -Infinity; }};
}
