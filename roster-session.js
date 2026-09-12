import {AUTH_EVENTS, getUser, onAuthChange, refreshSession} from '@netlify/identity';
import {createSessionFetch} from './roster-session-core.mjs';

if (!window.RoosterSession) {
  const session = createSessionFetch({
    fetch: window.fetch.bind(window),
    origin: window.location.origin,
    async renew() {
      // Read the cookie-backed SDK session on every page, including the feed,
      // profiles and radio. Previously renewal only ran on account pages.
      const user = await getUser();
      if (user) await refreshSession();
    },
  });
  window.RoosterSession = session;
  window.fetch = session.request;
  const resume = () => {
    if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
    void session.ensure(true).catch(() => {});
  };
  window.addEventListener('online', resume);
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  // Each bundle gets its SDK instance, while these events keep the shared API
  // gate fresh when the account page logs in or explicitly signs out.
  window.addEventListener('jwhite:session-changed', () => session.invalidate());
  window.addEventListener('storage', () => session.invalidate());
  onAuthChange(event => {
    if (event === AUTH_EVENTS.LOGIN || event === AUTH_EVENTS.LOGOUT) session.invalidate();
  });
  resume();
}
