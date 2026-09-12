import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Identity 2.0.0 selects the runtime's operator token before the member's cookie.
// Use only the member cookie for getUser(), keeping the official Identity /user
// validation and our confirmed-email requirement. Remove once upstream fixes it.
const require = createRequire(import.meta.url);
const packagePath = require.resolve('@netlify/identity/package.json');
const {version} = JSON.parse(await readFile(packagePath, 'utf8'));
if (version !== '2.0.0') throw new Error('Review the Identity compatibility patch before changing the SDK version.');
const before = 'const serverJwt = identityContext?.token ?? getServerCookie(NF_JWT_COOKIE);';
const previousCookiePreference = 'const serverJwt = getServerCookie(NF_JWT_COOKIE) ?? identityContext?.token;';
const after = 'const serverJwt = getServerCookie(NF_JWT_COOKIE);\n  if (!serverJwt) return null;';
const edits = [];
function reviewedReplace(source, before, after, name) {
  if (source.split(after).length === 2 && !source.replace(after, '').includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after)) {
    throw new Error(`${name} differs from the reviewed version. Refusing to apply the session fix.`);
  }
  return source.replace(before, after);
}
for (const name of ['main.js', 'main.cjs']) {
  const path = join(dirname(packagePath), 'dist', name);
  let source = await readFile(path, 'utf8');
  // Upgrade the previously reviewed cookie-preference patch. A signed-out
  // visitor has no member token: do not query Identity with an operator token
  // or turn an unrelated operator/service failure into a broken guest page.
  if (source.split(previousCookiePreference).length === 2) source = source.replace(previousCookiePreference, before);
  source = reviewedReplace(source, before, after, name);
  // The JWT still expires at Identity's normal limit. Retain its refresh cookie
  // across browser restarts so the official SDK can renew a legitimate session.
  for (const token of ['accessToken', 'refreshToken']) {
    const cookie = token === 'accessToken' ? 'NF_JWT_COOKIE' : 'NF_REFRESH_COOKIE';
    source = reviewedReplace(source,
      `document.cookie = \`${'${'}${cookie}}=${'${'}encodeURIComponent(${token})}; path=/; secure; samesite=lax\`;`,
      `document.cookie = \`${'${'}${cookie}}=${'${'}encodeURIComponent(${token})}; path=/; secure; samesite=lax; max-age=2592000\`;`, name);
  }
  if (!source.includes('Symbol.for("rooster.identity.hydration.v1")')) source = reviewedReplace(source, `  } catch {
    deleteBrowserAuthCookies();
    return null;
  }
  const user = toUser(gotrueUser);`, `  } catch (error) {
    if ([400, 401, 403].includes(Number(error?.status))) {
      deleteBrowserAuthCookies();
      return null;
    }
    const incomplete = client.currentUser();
    if (incomplete && !incomplete.id) incomplete.clearSession();
    throw error;
  }
  const user = toUser(gotrueUser);`, name);
  source = reviewedReplace(source, `    } catch {
      stopTokenRefresh();
      return null;
    }
  }
  const accessToken = getServerCookie`, `    } catch (error) {
      stopTokenRefresh();
      if ([400, 401, 403].includes(Number(error?.status))) {
        deleteBrowserAuthCookies();
        return null;
      }
      throw error;
    }
  }
  const accessToken = getServerCookie`, name);
  source = reviewedReplace(source, `var refreshSession = async () => {
  if (isBrowser()) {
    const client`, `var refreshSession = async () => {
  if (isBrowser()) {
    if (!getCookie(NF_JWT_COOKIE)) return null;
    const client`, name);
  source = reviewedReplace(source, `      if (expiresAtS - nowS2 > REFRESH_MARGIN_S) {
        return null;
      }`, `      if (expiresAtS - nowS2 > REFRESH_MARGIN_S && getCookie(NF_JWT_COOKIE) === details.access_token && (getCookie(NF_REFRESH_COOKIE) ?? "") === (details.refresh_token ?? "")) {
        return null;
      }`, name);
  source = reviewedReplace(source, `    if (!res.ok) return null;
    const userData = await res.json();
    return toUser(userData);
  } catch {
    return null;
  }
};
var resolveIdentityUrl`, `    if ([401, 403].includes(res.status)) return null;
    if (!res.ok) throw new Error("Identity is temporarily unavailable");
    const userData = await res.json();
    return toUser(userData);
  } catch (error) {
    // A service outage is not a rejected login. Keep protected endpoints closed
    // with their existing unavailable response, without deleting the session.
    throw error;
  }
};
var resolveIdentityUrl`, name);
  // Cookie-only restoration can refresh inside createUser(). Identity 2.0
  // forgot to publish that fresh token to the API cookie. Hydration is shared
  // across bundles and published only if the account has not changed while
  // Identity validates /user. A late response must never undo Sign out.
  source = reviewedReplace(source, `var hydrateSession = async () => {
  if (!isBrowser()) return null;
  const client = getClient();
  const currentUser = client.currentUser();
  if (currentUser) {
    startTokenRefresh();
    return toUser(currentUser);
  }
  const accessToken = getCookie(NF_JWT_COOKIE);
  if (!accessToken) return null;
  const refreshToken = getCookie(NF_REFRESH_COOKIE) ?? "";
  const decoded = decodeJwtPayload(accessToken);
  const expiresAt = decoded?.exp ?? Math.floor(Date.now() / 1e3) + 3600;
  const expiresIn = Math.max(0, expiresAt - Math.floor(Date.now() / 1e3));
  let gotrueUser;
  try {
    gotrueUser = await client.createUser(
      {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token: refreshToken
      },
      persistSession
    );
  } catch (error) {
    if ([400, 401, 403].includes(Number(error?.status))) {
      deleteBrowserAuthCookies();
      return null;
    }
    const incomplete = client.currentUser();
    if (incomplete && !incomplete.id) incomplete.clearSession();
    throw error;
  }
  const user = toUser(gotrueUser);
  startTokenRefresh();
  emitAuthEvent(AUTH_EVENTS.LOGIN, user);
  return user;
};`, `var hydrateSession = async () => {
  if (!isBrowser()) return null;
  const hydrationKey = Symbol.for("rooster.identity.hydration.v1");
  if (window[hydrationKey]) return window[hydrationKey];
  const pending = (async () => {
    const client = getClient();
    const currentUser = client.currentUser();
    if (currentUser?.id) {
      startTokenRefresh();
      return toUser(currentUser);
    }
    const accessToken = getCookie(NF_JWT_COOKIE);
    if (!accessToken) return null;
    const refreshToken = getCookie(NF_REFRESH_COOKIE) ?? "";
    const cookiesUnchanged = () => getCookie(NF_JWT_COOKIE) === accessToken && (getCookie(NF_REFRESH_COOKIE) ?? "") === refreshToken;
    const savedAtStart = localStorage.getItem(GOTRUE_STORAGE_KEY);
    const decoded = decodeJwtPayload(accessToken);
    const expiresAt = decoded?.exp ?? Math.floor(Date.now() / 1e3) + 3600;
    let gotrueUser;
    try {
      gotrueUser = await client.createUser({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1e3)),
        expires_at: expiresAt,
        refresh_token: refreshToken
      }, false);
      if (!cookiesUnchanged() || localStorage.getItem(GOTRUE_STORAGE_KEY) !== savedAtStart) {
        throw new Error("Session changed during restoration");
      }
    } catch (error) {
      if (!cookiesUnchanged() || localStorage.getItem(GOTRUE_STORAGE_KEY) !== savedAtStart) {
        throw new Error("Session changed during restoration");
      }
      if ([400, 401, 403].includes(Number(error?.status))) {
        const rejected = client.currentUser();
        if (rejected) rejected.clearSession();
        deleteBrowserAuthCookies();
        return null;
      }
      const incomplete = client.currentUser();
      if (incomplete && !incomplete.id) incomplete.clearSession();
      throw error;
    }
    if (persistSession) gotrueUser._saveSession();
    const details = gotrueUser.tokenDetails();
    setBrowserAuthCookies(details.access_token, details.refresh_token);
    const user = toUser(gotrueUser);
    startTokenRefresh();
    emitAuthEvent(AUTH_EVENTS.LOGIN, user);
    return user;
  })();
  window[hydrationKey] = pending;
  try { return await pending; }
  finally { if (window[hydrationKey] === pending) delete window[hydrationKey]; }
};`, name);
  source = reviewedReplace(source, `    const currentUser = client?.currentUser() ?? null;
    if (currentUser) {
      const jwt2`, `    const currentUser = client?.currentUser() ?? null;
    if (currentUser?.id) {
      const jwt2`, name);
  edits.push([path, source]);
}
// This is the SDK's installed internal transport, never an application import.
// Its 1.0.1 refresh catch erased localStorage even on a brief network loss.
const transportPath = join(dirname(require.resolve('gotrue-js')), '..', 'package.json');
const transport = JSON.parse(await readFile(transportPath, 'utf8'));
if (transport.version !== '1.0.1') throw new Error('Review the Identity refresh compatibility patch before changing its transport version.');
for (const name of ['index.js', 'index.cjs']) {
  const path = join(dirname(transportPath), 'lib', name);
  const source = await readFile(path, 'utf8');
  let updated = reviewedReplace(source, `      this.clearSession();
      throw error;
    });
    refreshPromises[refresh_token]`, `      if (currentUser !== this || (savedSessionAtStart && localStorage.getItem(storageKey) !== savedSessionAtStart)) {
        throw new Error("Session changed during renewal");
      }
      if ([400, 401, 403].includes(Number(error?.status))) this.clearSession();
      throw error;
    });
    refreshPromises[refresh_token]`, name);
  updated = reviewedReplace(updated, `    const refreshRequest = this.api.request("/token", {`, `    const savedSessionAtStart = isBrowser() ? localStorage.getItem(storageKey) : null;
    if (savedSessionAtStart && JSON.parse(savedSessionAtStart)?.token?.access_token !== this.tokenDetails()?.access_token) {
      return Promise.reject(new Error("Session changed before renewal"));
    }
    const refreshRequest = this.api.request("/token", {`, name);
  updated = reviewedReplace(updated, `      delete refreshPromises[refresh_token];
      this._processTokenResponse(response);`, `      delete refreshPromises[refresh_token];
      if (currentUser !== this || (savedSessionAtStart && localStorage.getItem(storageKey) !== savedSessionAtStart)) {
        throw new Error("Session changed during renewal");
      }
      this._processTokenResponse(response);`, name);
  updated = reviewedReplace(updated, `    if (currentUser) {
      return currentUser;
    }
    const json = isBrowser()`, `    if (currentUser) {
      const saved = isBrowser() && localStorage.getItem(storageKey);
      if (saved && JSON.parse(saved)?.token?.access_token !== currentUser.tokenDetails()?.access_token) currentUser = null;
      if (currentUser) return currentUser;
    }
    const json = isBrowser()`, name);
  updated = reviewedReplace(updated, `  async getUserData() {
    const response = await this._request("/user");
    return this._saveUserData(response)._refreshSavedSession();
  }`, `  async getUserData() {
    const savedAtStart = isBrowser() ? localStorage.getItem(storageKey) : null;
    const response = await this._request("/user");
    const savedNow = isBrowser() ? localStorage.getItem(storageKey) : null;
    const savedToken = savedNow ? JSON.parse(savedNow)?.token : null;
    if (currentUser !== this || (savedNow !== savedAtStart && (!savedToken || savedToken.access_token !== this.tokenDetails()?.access_token || savedToken.refresh_token !== this.tokenDetails()?.refresh_token))) {
      throw new Error("Session changed while loading account");
    }
    return this._saveUserData(response)._refreshSavedSession();
  }`, name);
  edits.push([path, updated]);
}
for (const [path, source] of edits) await writeFile(path, source);
