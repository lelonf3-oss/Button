// Stripe helpers using the REST API directly (no npm package needed).

import { ApiError, nowSeconds, requireEnv } from './http.js';
import { hmacSha256Hex, timingSafeEqual } from './crypto.js';

const STRIPE_API = 'https://api.stripe.com/v1';

// Creates a Stripe-hosted Checkout Session for one credit package.
// Returns { id, url }.
export async function createCheckoutSession(env, { userId, pkg, successUrl, cancelUrl }) {
  requireEnv(env, ['STRIPE_SECRET_KEY']);

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', successUrl);
  params.set('cancel_url', cancelUrl);
  params.set('client_reference_id', String(userId));
  params.set('metadata[user_id]', String(userId));
  params.set('metadata[package_id]', pkg.id);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', pkg.currency);
  params.set('line_items[0][price_data][unit_amount]', String(pkg.amountCents));
  params.set('line_items[0][price_data][product_data][name]', pkg.label);
  params.set('line_items[0][price_data][product_data][description]', pkg.description);

  let response;
  try {
    response = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
  } catch (err) {
    console.error('Stripe request failed:', err);
    throw new ApiError(502, 'payment_provider_error', 'The payment provider is unavailable.');
  }

  if (!response.ok) {
    console.error('Stripe error:', response.status, await response.text());
    throw new ApiError(502, 'payment_provider_error', 'Could not start the checkout.');
  }

  const data = await response.json();
  if (!data || typeof data.url !== 'string' || typeof data.id !== 'string') {
    throw new ApiError(502, 'payment_provider_error', 'Could not start the checkout.');
  }
  return { id: data.id, url: data.url };
}

// Verifies the "Stripe-Signature" header against the RAW request body.
// Header format: "t=<timestamp>,v1=<signature>[,v1=<signature>...]"
export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;

  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(',')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber)) return false;
  if (Math.abs(nowSeconds() - timestampNumber) > toleranceSeconds) return false;

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  let valid = false;
  for (const signature of signatures) {
    if (timingSafeEqual(expected, signature)) valid = true;
  }
  return valid;
}
