// Fixed-window rate limiting backed by D1.
// IP addresses are never stored in plain text: only an HMAC hash is used.

import { ApiError, getClientIp, nowSeconds, requireEnv } from './http.js';
import { hmacSha256Hex } from './crypto.js';

async function enforceBucket(env, bucket, limit, windowSeconds) {
  const now = nowSeconds();
  const windowStart = now - (now % windowSeconds);

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET hits = hits + 1
     RETURNING hits`,
  )
    .bind(bucket, windowStart)
    .first();

  // Occasionally remove old windows (about 1% of calls).
  if (Math.random() < 0.01) {
    await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?')
      .bind(now - 86400)
      .run();
  }

  if (row && row.hits > limit) {
    const retryAfter = windowSeconds - (now % windowSeconds);
    throw new ApiError(429, 'rate_limited', 'Too many requests. Please try again shortly.', {
      'Retry-After': String(retryAfter),
    });
  }
}

// Limits by (hashed) client IP. `config` is an entry from RATE_LIMITS.
export async function enforceIpRateLimit(env, request, name, config) {
  requireEnv(env, ['APP_SECRET']);
  const ipHash = await hmacSha256Hex(env.APP_SECRET, `ip:${getClientIp(request)}`);
  await enforceBucket(env, `${name}:ip:${ipHash}`, config.limit, config.windowSeconds);
}

// Limits by user ID.
export async function enforceUserRateLimit(env, name, userId, config) {
  await enforceBucket(env, `${name}:user:${userId}`, config.limit, config.windowSeconds);
}
