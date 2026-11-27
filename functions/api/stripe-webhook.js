// POST /api/stripe-webhook
// Called by Stripe only. Protected by the signature check, not by cookies or Origin.
//
// Credits are granted only here, only after:
//   1. the Stripe signature was verified against the raw body,
//   2. the session is paid and its amount/currency match our package definition,
//   3. the event / session was not processed before (idempotency).
// Granting is one atomic D1 batch: payment + credit units + processed-event marker.

import { getPackage } from '../_lib/config.js';
import { ApiError, json, nowSeconds, requireEnv } from '../_lib/http.js';
import { verifyStripeSignature } from '../_lib/stripe.js';

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
]);

async function isEventProcessed(env, eventId) {
  const row = await env.DB.prepare('SELECT 1 AS found FROM processed_webhook_events WHERE event_id = ?')
    .bind(eventId)
    .first();
  return Boolean(row);
}

async function isPaymentRecorded(env, stripeSessionId) {
  const row = await env.DB.prepare('SELECT 1 AS found FROM payments WHERE stripe_session_id = ?')
    .bind(stripeSessionId)
    .first();
  return Boolean(row);
}

function markEventProcessed(env, eventId, eventType) {
  return env.DB.prepare(
    'INSERT OR IGNORE INTO processed_webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)',
  )
    .bind(eventId, eventType, nowSeconds())
    .run();
}

export async function onRequestPost({ request, env }) {
  requireEnv(env, ['STRIPE_WEBHOOK_SECRET']);

  // The signature is calculated over the RAW body, so read it as text first.
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) {
    throw new ApiError(413, 'payload_too_large', 'The request body is too large.');
  }

  const valid = await verifyStripeSignature(
    rawBody,
    request.headers.get('Stripe-Signature'),
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!valid) {
    throw new ApiError(400, 'invalid_signature', 'Invalid signature.');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw new ApiError(400, 'invalid_event', 'Invalid event.');
  }

  // Events we do not need are acknowledged without any database write.
  if (!HANDLED_EVENTS.has(event.type)) {
    return json({ received: true, ignored: true });
  }

  const session = event.data && event.data.object;
  if (!session || typeof session.id !== 'string') {
    throw new ApiError(400, 'invalid_event', 'Invalid event data.');
  }

  // For delayed payment methods, "completed" arrives before the money does.
  // Credits are granted later by "async_payment_succeeded".
  if (session.mode !== 'payment' || session.payment_status !== 'paid') {
    return json({ received: true, ignored: true });
  }

  // Validate everything against our own definitions.
  const metadata = session.metadata || {};
  const userId = Number(metadata.user_id);
  const pkg = getPackage(metadata.package_id);

  if (!Number.isSafeInteger(userId) || userId <= 0 || session.client_reference_id !== String(userId)) {
    console.error('Webhook: invalid user reference for session', session.id);
    throw new ApiError(400, 'invalid_event', 'Invalid user reference.');
  }
  if (!pkg) {
    console.error('Webhook: unknown package for session', session.id);
    throw new ApiError(400, 'invalid_event', 'Unknown package.');
  }
  if (session.amount_total !== pkg.amountCents || String(session.currency).toLowerCase() !== pkg.currency) {
    console.error('Webhook: amount or currency mismatch for session', session.id);
    throw new ApiError(400, 'invalid_event', 'Amount or currency mismatch.');
  }

  const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
  if (!user) {
    console.error('Webhook: user not found for session', session.id);
    throw new ApiError(400, 'invalid_event', 'User not found.');
  }

  // Idempotency: same event again, or same session delivered via a different event.
  if (await isEventProcessed(env, event.id)) {
    return json({ received: true, duplicate: true });
  }
  if (await isPaymentRecorded(env, session.id)) {
    await markEventProcessed(env, event.id, event.type);
    return json({ received: true, duplicate: true });
  }

  const now = nowSeconds();
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments
           (user_id, stripe_session_id, stripe_payment_intent_id, package_id, credits, amount_cents, currency, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(userId, session.id, paymentIntentId, pkg.id, pkg.credits, pkg.amountCents, pkg.currency, now),

      // One row per credit unit (1..pkg.credits).
      env.DB.prepare(
        `WITH RECURSIVE units(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM units WHERE n < ?1)
         INSERT INTO credits (user_id, payment_id, unit_no, created_at)
         SELECT ?2, p.id, units.n, ?3 FROM payments p, units WHERE p.stripe_session_id = ?4`,
      ).bind(pkg.credits, userId, now, session.id),

      env.DB.prepare(
        'INSERT INTO processed_webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)',
      ).bind(event.id, event.type, now),
    ]);
  } catch (err) {
    // A concurrent delivery of the same event/session may have won the race.
    // In that case everything is already recorded and we answer with success.
    if ((await isEventProcessed(env, event.id)) || (await isPaymentRecorded(env, session.id))) {
      return json({ received: true, duplicate: true });
    }
    console.error('Webhook batch failed:', err);
    // A 5xx makes Stripe retry the delivery later.
    throw new ApiError(500, 'internal_error', 'Could not process the event.');
  }

  return json({ received: true });
}
