// GET /api/config
// Public, non-secret settings needed by the frontend.

import { json, requireEnv } from '../_lib/http.js';

export async function onRequestGet({ env }) {
  requireEnv(env, ['TURNSTILE_SITE_KEY']);
  return json(
    { turnstileSiteKey: env.TURNSTILE_SITE_KEY },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
}
