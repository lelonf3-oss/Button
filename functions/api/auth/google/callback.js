// GET /api/auth/google/callback
// Google redirects here after the user signed in.
// Steps: validate state -> exchange code (with PKCE verifier) -> validate the ID token
//        -> find or create the user by Google "sub" -> create a NEW session -> redirect home.
//
// The ID token is received directly from Google's token endpoint over HTTPS,
// so (as described in Google's documentation) its signature does not need to be
// verified again. Issuer, audience, expiry and nonce are validated below.

import { OAUTH_COOKIE, RATE_LIMITS } from '../../../_lib/config.js';
import { decodeJwtPayload, timingSafeEqual } from '../../../_lib/crypto.js';
import {
  clearCookie,
  getSiteUrl,
  nowSeconds,
  parseCookies,
  redirect,
  requireEnv,
} from '../../../_lib/http.js';
import { enforceIpRateLimit } from '../../../_lib/rate-limit.js';
import { createSession } from '../../../_lib/session.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const VALID_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export async function onRequestGet({ request, env }) {
  // Whatever happens, the one-time OAuth cookie is removed again.
  const fail = (reason) => redirect(`/?auth=${reason}`, [clearCookie(OAUTH_COOKIE)]);

  try {
    requireEnv(env, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_SECRET']);
    await enforceIpRateLimit(env, request, 'callback', RATE_LIMITS.callback);

    const url = new URL(request.url);

    // The user cancelled or Google reported an error.
    if (url.searchParams.get('error')) return fail('cancelled');

    const code = url.searchParams.get('code') || '';
    const returnedState = url.searchParams.get('state') || '';
    if (!code || code.length > 2048 || !returnedState || returnedState.length > 128) {
      return fail('error');
    }

    // 1. Validate the state against the cookie set in login.js
    const cookieValue = parseCookies(request)[OAUTH_COOKIE] || '';
    const parts = cookieValue.split('.');
    if (parts.length !== 3) return fail('error');
    const [state, codeVerifier, nonce] = parts;
    if (!timingSafeEqual(state, returnedState)) return fail('error');

    // 2. Exchange the authorization code for tokens
    const siteUrl = getSiteUrl(env, request);
    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${siteUrl}/api/auth/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenResponse.ok) {
      console.error('Google token exchange failed:', tokenResponse.status);
      return fail('error');
    }
    const tokens = await tokenResponse.json();

    // 3. Validate the ID token claims
    const claims = decodeJwtPayload(tokens.id_token);
    if (!claims) return fail('error');
    if (!VALID_ISSUERS.has(claims.iss)) return fail('error');
    if (claims.aud !== env.GOOGLE_CLIENT_ID) return fail('error');
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds()) return fail('error');
    if (typeof claims.nonce !== 'string' || !timingSafeEqual(claims.nonce, nonce)) return fail('error');
    if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) {
      return fail('error');
    }

    // 4. Find or create the user. The Google "sub" is the unique identifier.
    const now = nowSeconds();
    const user = await env.DB.prepare(
      `INSERT INTO users (google_sub, created_at, last_login_at) VALUES (?, ?, ?)
       ON CONFLICT(google_sub) DO UPDATE SET last_login_at = excluded.last_login_at
       RETURNING id`,
    )
      .bind(claims.sub, now, now)
      .first();
    if (!user) return fail('error');

    // 5. Brand-new session (prevents session fixation) and back to the homepage
    const sessionCookie = await createSession(env, user.id);
    return redirect('/?auth=ok', [sessionCookie, clearCookie(OAUTH_COOKIE)]);
  } catch (err) {
    console.error('Google callback error:', err);
    return fail('error');
  }
}
