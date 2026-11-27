// Shared configuration for THE BUTTON.

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

export const MILESTONES = Object.freeze([
  1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000,
]);
export const MILESTONE_FALLBACK_STEP = 1000000;

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; 
export const SESSION_COOKIE = '__Host-session';
export const OAUTH_COOKIE = '__Host-oauth';
export const OAUTH_TTL_SECONDS = 600; 

export const RATE_LIMITS = Object.freeze({
  login:    { limit: 20, windowSeconds: 600 },
  callback: { limit: 20, windowSeconds: 600 },
  click:    { limit: 30, windowSeconds: 60 },
  clickUser: { limit: 10, windowSeconds: 60 },
  checkout: { limit: 10, windowSeconds: 600 },
});

// SICHERHEITSRICHTLINIE (CSP) - Angepasst für Turnstile & Stripe
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com https://checkout.stripe.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
].join('; ');
