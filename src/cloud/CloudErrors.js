// What a failed Supabase request means for the account page (S3) and the
// sign-in (判定表「使用中登入失效」): the server refused the sign-in (401, an
// expired or invalid JWT) or the phone could not reach it at all.

const AUTH_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303']);
const NETWORK = /network request failed|failed to fetch|fetch failed|network ?error|timed? ?out|timeout|offline|unable to resolve host|ENOTFOUND|ECONNREFUSED/i;

/**
 * An Error with a readable message that keeps what the server answered:
 * `status` (HTTP), `code` (PostgREST) and the original error as `cause`.
 */
export function cloudError(message, failure, status) {
  const error = new Error(message);
  error.status = status ?? failure?.status ?? failure?.context?.status ?? null;
  error.code = failure?.code ?? null;
  error.cause = failure ?? null;
  return error;
}

const texts = error => [error?.message, error?.cause?.message, error?.cause?.details, error?.cause?.hint]
  .filter(value => typeof value === 'string');

/** The server refused this sign-in: 401, an expired/invalid JWT. */
export function isAuthFailure(error) {
  if (!error) return false;
  const status = error.status ?? error.context?.status ?? error.cause?.status ?? error.cause?.context?.status;
  if (status === 401) return true;
  if (AUTH_CODES.has(error.code) || AUTH_CODES.has(error.cause?.code)) return true;
  return texts(error).some(text => /\bjwt\b.*(expired|invalid|malformed)|invalid jwt|refresh token.*(not found|invalid|revoked)/i.test(text));
}

/** The request never reached Supabase (no network, DNS, timeout). */
export function isNetworkFailure(error) {
  if (!error) return false;
  if (isAuthFailure(error)) return false;
  if (error.name === 'AuthRetryableFetchError' || error.cause?.name === 'AuthRetryableFetchError') return true;
  const status = error.status ?? error.cause?.status;
  if (status === 0) return true;
  return texts(error).some(text => NETWORK.test(text));
}

// Supabase refused the refresh token itself (revoked, expired, unknown
// session): 400/401/403 with an auth error, never 429 or 5xx.
export function refreshRefused(failure) {
  const status = Number(failure?.status);
  const words = `${failure?.code || ''} ${failure?.message || ''}`;
  if (status === 429 || status >= 500) return false;
  if ([400, 401, 403].includes(status)) return true;
  return /refresh_token_not_found|refresh_token_already_used|session_not_found|session_expired|invalid refresh token|invalid_grant|bad_jwt/i.test(words);
}
