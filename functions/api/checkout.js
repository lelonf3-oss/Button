// POST /api/checkout
// Body: { "packageId": "pack_10" | "pack_20", "turnstileToken": "<token>" }
// Headers: X-CSRF-Token, Content-Type: application/json
// Creates a Stripe-hosted Checkout Session and returns { url }.
// Credits are NOT granted here. They are granted only by the verified webhook.

import { RATE_LIMITS, getPackage } from '../_lib/config.js';
import { ApiError, getSiteUrl, json, readJson } from '../_lib/http.js';
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
