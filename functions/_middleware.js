// Global middleware for all Pages Functions routes.
//  - Same-origin check for state-changing API requests (CSRF defense in depth)
//  - Central error handling (no internal details leak to the browser)
//  - Security headers on every response
//  - Injects the canonical URL and Open Graph/Twitter image URLs into HTML pages,
//    based on the SITE_URL variable. The HTML files must contain these tags:
//      <link rel="canonical" href="">
//      <meta property="og:url" content="">
//      <meta property="og:image" content="">
//      <meta name="twitter:image" content="">

import { CONTENT_SECURITY_POLICY } from './_lib/config.js';
import { ApiError, assertSameOrigin, errorResponse, getSiteUrl } from './_lib/http.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function toCanonicalPath(pathname) {
  let path = pathname.replace(/\.html$/, '');
  if (path === '/index') path = '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path || '/';
}

function handleError(err, isApi) {
  if (err instanceof ApiError) {
    return errorResponse(err.status, err.code, err.message, err.headers);
  }
  console.error('Unhandled error:', err);
  if (isApi) {
    return errorResponse(500, 'internal_error', 'Something went wrong. Please try again later.');
  }
  return new Response('Internal Server Error', {
    status: 500,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function injectSiteUrls(response, request, env) {
  const contentType = response.headers.get('Content-Type') || '';
  if (response.status !== 200 || !contentType.includes('text/html')) return response;

  const siteUrl = getSiteUrl(env, request);
  const canonicalUrl = siteUrl + toCanonicalPath(new URL(request.url).pathname);
  const imageUrl = `${siteUrl}/og-image.png`;

  return new HTMLRewriter()
    .on('link[rel="canonical"]', { element: (el) => el.setAttribute('href', canonicalUrl) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', canonicalUrl) })
    .on('meta[property="og:image"]', { element: (el) => el.setAttribute('content', imageUrl) })
    .on('meta[name="twitter:image"]', { element: (el) => el.setAttribute('content', imageUrl) })
    .transform(response);
}

function withSecurityHeaders(response) {
  // Re-wrap the response so its headers are mutable (redirects/fetched responses are immutable).
  const out = new Response(response.body, response);
  out.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('X-Frame-Options', 'DENY');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  out.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  out.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return out;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/');

  let response;
  try {
    // The Stripe webhook is called by Stripe (no browser Origin); it is protected by its signature.
    const needsOriginCheck =
      isApi && !SAFE_METHODS.has(request.method) && url.pathname !== '/api/stripe-webhook';
    if (needsOriginCheck) assertSameOrigin(request);

    response = await next();
    response = injectSiteUrls(response, request, env);
  } catch (err) {
    response = handleError(err, isApi);
  }

  return withSecurityHeaders(response);
}
