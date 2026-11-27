// GET /api/auth/google/login
// Starts the Google OAuth 2.0 authorization code flow with:
//   - "state"  (CSRF protection for the login flow)
//   - "nonce"  (binds the ID token to this login attempt)
//   - PKCE     (code_challenge with S256)
// The three values are kept in a short-lived Secure, HttpOnly cookie.
// Only the "openid" scope is requested: no email address and no name are collected.

import { OAUTH_COOKIE, OAUTH_TTL_SECONDS, RATE_LIMITS } from '../../../_lib/config.js';
import { randomToken, sha256Base64Url } from '../../../_lib/crypto.js';
import { getSiteUrl, redirect, requireEnv, serializeCookie } from '../../../_lib/http.js';
import { enforceIpRateLimit } from '../../../_lib/rate-limit.js';

export async function onRequestGet({ request, env }) {
  requireEnv(env, ['GOOGLE_CLIENT_ID', 'APP_SECRET']);

  // The login must run on the canonical host. Otherwise the cookie set here would not
  // be sent back on the callback host. Redirect to SITE_URL first if necessary.
  const siteUrl = getSiteUrl(env, request);
  if (new URL(request.url).origin !== siteUrl) {
    return redirect(`${siteUrl}/api/auth/google/login`);
  }

  await enforceIpRateLimit(env, request, 'login', RATE_LIMITS.login);

  const state = randomToken(32);
  const nonce = randomToken(16);
  const codeVerifier = randomToken(48); // 64 characters, within the 43-128 range required by PKCE
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${siteUrl}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  // Base64url values never contain ".", so it is a safe separator.
  const oauthCookie = serializeCookie(OAUTH_COOKIE, `${state}.${codeVerifier}.${nonce}`, {
    maxAge: OAUTH_TTL_SECONDS,
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, [oauthCookie]);
}
