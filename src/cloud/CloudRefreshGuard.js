// The token refresh must only end the sign-in when Supabase itself refused
// the refresh token.
//
// supabase-js (auth-js) treats every failed refresh response as final unless
// it is a thrown fetch or HTTP 502/503/504. When the access token has already
// expired (resume after more than an hour), a final failure makes the SDK
// delete the stored sign-in and emit SIGNED_OUT. These answers reach it in the
// field without saying anything about the sign-in:
// - a captive portal or proxy page (Wi-Fi login, HTTP 511/403/302 → HTML);
// - Supabase busy or failing (429, 500, any other 5xx);
// - anything else that is not GoTrue's JSON verdict (404 from a proxy…).
// The app then showed 登入失效, and BLE relay uploads stopped until the
// handler typed the password again.
//
// This wrapper turns those answers to the refresh request into the network
// error they are. The SDK retries them (its own backoff), keeps the stored
// session, and CloudSession / AuthProvider report a connection problem.
// GoTrue's real refusals are JSON 400/401/403 (refresh_token_not_found,
// refresh_token_already_used, session_not_found, …) and pass through
// unchanged, so a revoked sign-in still ends once, as before.

const REFUSAL_STATUSES = new Set([400, 401, 403]);

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return input == null ? '' : String(input);
}

/** Whether this request is the SDK's refresh-token grant. */
export function isRefreshRequest(input) {
  const url = requestUrl(input);
  return /\/auth\/v1\/token(?:[?#]|$)/.test(url) && /[?&]grant_type=refresh_token(?:&|$)/.test(url);
}

const isJson = response => {
  try {
    return /\bjson\b/i.test(response?.headers?.get?.('content-type') || '');
  } catch {
    return false;
  }
};

/** Whether a refresh response is GoTrue's own answer (a session or a refusal). */
export function isVerdict(response) {
  if (!response || typeof response.status !== 'number') return false;
  if (!isJson(response)) return false;
  return response.ok || REFUSAL_STATUSES.has(response.status);
}

export function guardAuthRefresh(fetchImpl) {
  return async function guardedFetch(input, init) {
    const response = await fetchImpl.call(this, input, init);
    if (!isRefreshRequest(input) || isVerdict(response)) return response;
    // No token from the body ever reaches the message.
    const status = Number.isInteger(response?.status) ? response.status : 'invalid';
    throw new TypeError(`Network request failed (token refresh answered ${status})`);
  };
}
