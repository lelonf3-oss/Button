// Server-side verification of Cloudflare Turnstile tokens.
// Tokens are single-use: the frontend needs a fresh token for every protected request.

import { ApiError, getClientIp, requireEnv } from './http.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Throws an ApiError if the token is missing, invalid or cannot be verified (fails closed).
export async function requireTurnstile(env, request, token) {
  requireEnv(env, ['TURNSTILE_SECRET_KEY']);

  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new ApiError(403, 'bot_check_failed', 'The bot check failed. Please try again.');
  }

  const body = new URLSearchParams();
  body.set('secret', env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  const ip = getClientIp(request);
  if (ip !== 'unknown') body.set('remoteip', ip);

  let result;
  try {
    const response = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!response.ok) throw new Error(`Turnstile HTTP ${response.status}`);
    result = await response.json();
  } catch (err) {
    console.error('Turnstile verification error:', err);
    throw new ApiError(503, 'bot_check_unavailable', 'The bot check is temporarily unavailable.');
  }

  if (result.success !== true) {
    throw new ApiError(403, 'bot_check_failed', 'The bot check failed. Please try again.');
  }
}
