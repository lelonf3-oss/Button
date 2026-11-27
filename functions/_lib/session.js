// Session handling: server-side sessions stored in D1, referenced by a
// random token in a Secure, HttpOnly cookie. Only the SHA-256 hash of the
// token is stored in the database.

import { SESSION_COOKIE, SESSION_TTL_SECONDS } from './config.js';
import { randomToken, sha256Hex, timingSafeEqual } from './crypto.js';
import { ApiError, clearCookie, nowSeconds, parseCookies, serializeCookie } from './http.js';

// Creates a NEW session (always a fresh token, which prevents session fixation).
// Returns the Set-Cookie string for the session cookie.
export async function createSession(env, userId) {
  const now = nowSeconds();
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const tokenHash = await sha256Hex(token);

  await env.DB.batch([
    // Opportunistic cleanup of expired sessions.
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(tokenHash, userId, csrfToken, now, now + SESSION_TTL_SECONDS),
  ]);

  return serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
}

// Returns { userId, csrfToken } or null if there is no valid session.
export async function getSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || token.length > 128) return null;

  const row = await env.DB.prepare(
    'SELECT user_id, csrf_token FROM sessions WHERE token_hash = ? AND expires_at > ?',
  )
    .bind(await sha256Hex(token), nowSeconds())
    .first();

  if (!row) return null;
  return { userId: row.user_id, csrfToken: row.csrf_token };
}

// Like getSession, but throws 401 if the user is not signed in.
export async function requireSession(request, env) {
  const session = await getSession(request, env);
  if (!session) {
    throw new ApiError(401, 'not_authenticated', 'Please sign in with Google first.');
  }
  return session;
}

// Verifies the CSRF token sent by the frontend in the X-CSRF-Token header.
export function requireCsrf(request, session) {
  const sent = request.headers.get('X-CSRF-Token') || '';
  if (!sent || !timingSafeEqual(sent, session.csrfToken)) {
    throw new ApiError(403, 'bad_csrf', 'Invalid or missing CSRF token. Please reload the page.');
  }
}

// Deletes the current session in the database. Returns the cookie string that clears the cookie.
export async function destroySession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (token && token.length <= 128) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run();
  }
  return clearCookie(SESSION_COOKIE);
}
