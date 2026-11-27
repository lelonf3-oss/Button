// POST /api/auth/logout
// Headers: X-CSRF-Token (only checked if a session exists)
// Deletes the session in the database and clears the cookie.

import { clearCookie, json } from '../../_lib/http.js';
import { destroySession, getSession, requireCsrf } from '../../_lib/session.js';
import { SESSION_COOKIE } from '../../_lib/config.js';

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) {
    // Already signed out: just make sure the cookie is gone.
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
  }

  requireCsrf(request, session);
  const clearedCookie = await destroySession(request, env);
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie });
}
