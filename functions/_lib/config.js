// Shared configuration for THE BUTTON.
// Change packages, limits and milestones here.

// ---------------------------------------------------------------------------
// Credit packages. Prices are defined here and sent to Stripe via price_data,
// so no products have to be created in the Stripe dashboard.
// ---------------------------------------------------------------------------
export const PACKAGES = Object.freeze({
  pack_10: Object.freeze({
    id: 'pack_10',
    credits: 10,
    amountCents: 99,
    currency: 'eur',
    label: 'THE BUTTON: 10 clicks',
    description: '10 additional clicks. Credits never expire. Maximum one click per day.',
  }),
  pack_20: Object.freeze({
    id: 'pack_20',
    credits: 20,
    amountCents: 199,
    currency: 'eur',
    label: 'THE BUTTON: 20 clicks',
    description: '20 additional clicks. Credits never expire. Maximum one click per day.',
  }),
});

export function getPackage(id) {
  if (typeof id !== 'string' || !Object.hasOwn(PACKAGES, id)) return null;
  return PACKAGES[id];
}

// ---------------------------------------------------------------------------
// Milestones. To add one: append a number that is HIGHER than the current
// global counter. Never remove or change milestones that were already reached.
// After the last entry, a new milestone is generated every
// MILESTONE_FALLBACK_STEP clicks, so the experiment has no final ending.
// ---------------------------------------------------------------------------
export const MILESTONES = Object.freeze([
  1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000,
]);
export const MILESTONE_FALLBACK_STEP = 1000000;

// ---------------------------------------------------------------------------
// Sessions and cookies
// ---------------------------------------------------------------------------
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const SESSION_COOKIE = '__Host-session';
export const OAUTH_COOKIE = '__Host-oauth';
export const OAUTH_TTL_SECONDS = 600; // 10 minutes to finish the Google login

// ---------------------------------------------------------------------------
// Rate limits (fixed windows, per hashed IP unless noted otherwise)
// ---------------------------------------------------------------------------
export const RATE_LIMITS = Object.freeze({
  login:    { limit: 20, windowSeconds: 600 },
  callback: { limit: 20, windowSeconds: 600 },
  click:    { limit: 30, windowSeconds: 60 },
  clickUser: { limit: 10, windowSeconds: 60 },
  checkout: { limit: 10, windowSeconds: 600 },
});

// ---------------------------------------------------------------------------
// Content Security Policy.
// No inline scripts and no inline style attributes are allowed.
// Only Cloudflare Turnstile is allowed as an external script/frame source.
// ---------------------------------------------------------------------------
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
