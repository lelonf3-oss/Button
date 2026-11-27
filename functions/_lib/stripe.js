// Stripe helpers using the REST API directly (no npm package needed).

import { ApiError, nowSeconds, requireEnv } from './http.js';
import { hmacSha256Hex, timingSafeEqual } from './crypto.js';

const STRIPE_API = 'https://api.stripe.com/v1';

// Creates a Stripe-hosted Checkout Session for one credit package.
// Returns { id, url }.
export async function createCheckoutSession(env, { userId, pkg, successUrl, cancelUrl }) {
  requireEnv(env, ['STRIPE_SECRET_KEY']);

  // WICHTIG: .trim() entfernt unsichtbare Leerzeichen am Anfang/Ende des Keys, 
  // die beim Kopieren oft entstehen und Stripe blockieren.
  const secretKey = env.STRIPE_SECRET_KEY.trim();

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
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
  } catch (err) {
    console.error('Stripe request failed:', err);
    throw new ApiError(502, 'payment_provider_error', 'The payment provider is unavailable.');
  }

  if (!response.ok) {
    // Gibt den exakten Fehler von Stripe im Cloudflare-Log aus, damit wir sehen, was kaputt ist.
    const errorText = await response.text();
    console.error('Stripe API Error:', response.status, errorText);
    throw new ApiError(502, 'payment_provider_error', 'Could not start the checkout.');
  }

  const data = await response.json();
  if (!data || typeof data.url !== 'string' || typeof data.id !== 'string') {
    console.error('Stripe returned invalid data:', data);
    throw new ApiError(502, 'payment_provider_error', 'Could not start the checkout.');
  }
  return { id: data.id, url: data.url };
}

// Verifies the "Stripe-Signature" header against the RAW request body.
export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;

  // Auch hier entfernen wir eventuelle Leerzeichen beim Webhook Secret
  const secretKey = secret.trim();

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

  const expected = await hmacSha256Hex(secretKey, `${timestamp}.${rawBody}`);
  let valid = false;
  for (const signature of signatures) {
    if (timingSafeEqual(expected, signature)) {
      valid = true;
    }
  }
  return valid;
}
