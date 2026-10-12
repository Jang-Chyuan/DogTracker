import { t } from '../i18n';
import { cloudError, isAuthFailure, refreshRefused } from './CloudErrors';

// supabase-js attaches `auth.getSession()`'s access token to every REST call.
// When the refresh behind it fails without the server refusing the sign-in
// (no network yet after a long background, 5xx, or the SDK's 60 s cooldown
// after a failure while the app was away), getSession reports no session
// and the request goes out with the publishable key instead. Supabase then
// answers 401, which reads as a refused sign-in (更新失敗) although the stored
// one is intact and refreshes a few seconds later.
//
// A latest attempt therefore waits (bounded) for the SDK to hold a session of
// its own owner before its first request, and after a 401 asks the SDK for
// one forced refresh and repeats the request once. A refresh the server
// refuses keeps reporting the 401 as before (AuthProvider decides 登入失效).

/** The SDK's refresh-failure cooldown (60 s) plus margin. */
export const SESSION_WAIT_MS = 65000;
export const SESSION_POLL_MS = 2000;

// A refresh that did not reach a verdict: the stored sign-in is still there.
const transient = failure => failure?.name === 'AuthRefreshDiscardedError' || !refreshRefused(failure);
const unreached = () => new Error('Session refresh timed out');

export function createCloudSessionGate({ auth, owner, signal, check, now = Date.now,
  waitMs = SESSION_WAIT_MS, pollMs = SESSION_POLL_MS }) {
  let reauthorized = false;
  // Resolves null at the deadline or on abort; the SDK call itself cannot be
  // cancelled, so the caller re-checks its generation after every await.
  const bounded = (work, ms) => {
    let timer, stop;
    const limit = new Promise(resolve => {
      stop = () => resolve(null);
      timer = setTimeout(stop, Math.max(0, ms));
      signal?.addEventListener?.('abort', stop, { once: true });
      if (signal?.aborted) stop();
    });
    return Promise.race([Promise.resolve().then(work).then(value => ({ value }), error => ({ error })), limit])
      .finally(() => { clearTimeout(timer); signal?.removeEventListener?.('abort', stop); });
  };
  const pause = ms => bounded(() => new Promise(() => {}), ms);
  const own = session => {
    // Another account's session is a switch in progress, never this owner's.
    if (session.user?.id !== owner) throw new Error(t('c576'));
    return session;
  };

  /** Before the first request: a stored session for this owner, refreshed if expiring. */
  async function ready() {
    if (typeof auth?.getSession !== 'function') return null;
    const deadline = now() + waitMs;
    let last = null;
    for (;;) {
      await check();
      const outcome = await bounded(() => auth.getSession(), deadline - now());
      await check();
      if (outcome && !outcome.error) {
        const { data, error } = outcome.value ?? {};
        if (data?.session?.access_token) return own(data.session);
        // Nothing stored: unchanged behaviour, the server decides (logout
        // events end this owner's generation separately).
        if (!error) return null;
        // The server refused the refresh token: the 401 the anonymous request
        // would have produced, without sending it.
        if (!transient(error)) throw cloudError(t('c581'), error, 401);
        last = error;
      } else if (outcome) last = outcome.error;
      if (!outcome || now() >= deadline) throw cloudError(t('c581'), last ?? unreached(), null);
      await pause(Math.min(pollMs, deadline - now()));
    }
  }

  /** After a 401: one forced refresh; a new session for this owner repeats the work once. */
  async function retryRefused(work) {
    try { return await work(); }
    catch (refusal) {
      if (reauthorized || !isAuthFailure(refusal) || typeof auth?.refreshSession !== 'function') throw refusal;
      reauthorized = true;
      await check();
      const outcome = await bounded(() => auth.refreshSession(), waitMs);
      await check();
      if (!outcome) throw cloudError(t('c581'), unreached(), null);
      const { data, error } = outcome.value ?? {};
      if (!outcome.error && !error && data?.session?.access_token) {
        own(data.session);
        return work();
      }
      const failure = outcome.error ?? error;
      // Could not refresh now: not a verdict on the sign-in. Report it as the
      // connection problem it is; the next pass asks again.
      if (failure && transient(failure)) throw cloudError(refusal.message, failure, null);
      throw refusal;
    }
  }

  return { ready, retryRefused };
}
