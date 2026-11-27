// Stripe helpers using the REST API directly (no npm package needed).

import { ApiError, nowSeconds, requireEnv } from './http.js';
import { hmacSha256Hex, timingSafeEqual } from './crypto.js';

const STRIPE_API = 'https://api.stripe.com/v1';

export async function createCheckoutSession(env, { userId, pkg, successUrl, cancelUrl }) {
  requireEnv(env, ['STRIPE_SECRET_KEY']);

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
  
  // NEU: Deaktiviert die neue "Managed Payments" Funktion von Stripe für diese Session.
  // Verhindert die Fehlermeldung bezüglich des fehlenden Steuercodes (tax_code).
  params.set('managed_payments[enabled]', 'false');

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
    throw new ApiError(502, 'payment_provider_error', `Stripe Network Error: ${err.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new ApiError(502, 'stripe_error', `Stripe API Error: ${errorText}`);
  }

  const data = await response.json();
  if (!data || typeof data.url !== 'string' || typeof data.id !== 'string') {
    throw new ApiError(502, 'stripe_error', `Stripe Invalid Data: ${JSON.stringify(data)}`);
  }
  return { id: data.id, url: data.url };
}

export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;
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
