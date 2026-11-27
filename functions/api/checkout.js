import { RATE_LIMITS, getPackage } from '../_lib/config.js';
import { ApiError, getSiteUrl, json, readJson, utcDay } from '../_lib/http.js';
import { enforceIpRateLimit } from '../_lib/rate-limit.js';
import { requireCsrf, requireSession } from '../_lib/session.js';
import { createCheckoutSession } from '../_lib/stripe.js';
import { requireTurnstile } from '../_lib/turnstile.js';

export async function onRequestPost({ request, env }) {
  const session = await requireSession(request, env);
  requireCsrf(request, session);
  await enforceIpRateLimit(env, request, 'checkout', RATE_LIMITS.checkout);

  const body = await readJson(request);
  const pkg = getPackage(body.packageId);
  if (!pkg) {
    throw new ApiError(400, 'invalid_package', 'Unknown click package.');
  }

  // NEUE LOGIK: Prüfen, ob heute schon geklickt oder gekauft wurde
  const day = utcDay();
  const dayStart = Math.floor(Date.parse(day + 'T00:00:00Z') / 1000);
  const dayEnd = dayStart + 86400;

  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM clicks WHERE user_id = ?1 AND click_day = ?2) AS clicked_today,
       (SELECT COUNT(*) FROM payments WHERE user_id = ?1 AND created_at >= ?3 AND created_at < ?4) AS bought_today`
  ).bind(session.userId, day, dayStart, dayEnd).first();

  if (row.clicked_today > 0) {
    throw new ApiError(
      409,
      'already_clicked_today',
      'You cannot buy credits on the same day you pressed the button. Come back tomorrow.'
    );
  }

  if (row.bought_today > 0) {
    throw new ApiError(
      409,
      'already_bought_today',
      'You can only buy one package per day. Come back tomorrow.'
    );
  }

  await requireTurnstile(env, request, body.turnstileToken);

  const siteUrl = getSiteUrl(env, request);
  const checkout = await createCheckoutSession(env, {
    userId: session.userId,
    pkg,
    successUrl: `${siteUrl}/?payment=success`,
    cancelUrl: `${siteUrl}/?payment=cancelled`,
  });

  return json({ url: checkout.url });
}
