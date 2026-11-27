// HTTP helpers: JSON responses, errors, cookies, request parsing, small utilities.

export class ApiError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// Current UTC calendar day as "YYYY-MM-DD".
export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function errorResponse(status, code, message, extraHeaders = {}) {
  return json({ error: { code, message } }, status, extraHeaders);
}

// Redirect with optional Set-Cookie headers (array of cookie strings).
export function redirect(location, cookies = [], status = 302) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status, headers });
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
export function parseCookies(request) {
  const result = {};
  const header = request.headers.get('Cookie');
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name && !(name in result)) result[name] = value;
  }
  return result;
}

// Always Secure + HttpOnly + Path=/ (required for the "__Host-" prefix).
export function serializeCookie(name, value, { maxAge, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'Secure', 'HttpOnly', `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  return parts.join('; ');
}

export function clearCookie(name) {
  return serializeCookie(name, '', { maxAge: 0 });
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------
export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// Rejects requests whose Origin header does not match the host they were sent to.
// Browsers always send Origin on cross-site POST requests, so this blocks CSRF
// from other websites. (The per-session CSRF token is a second layer.)
export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new ApiError(403, 'bad_origin', 'Cross-origin requests are not allowed.');
  }
}

// Reads a small JSON object body with validation.
export async function readJson(request, maxBytes = 4096) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Expected a JSON request body.');
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'The request body is too large.');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(400, 'invalid_json', 'The request body must be a JSON object.');
  }
  return data;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------
// Public base URL without trailing slash. Uses SITE_URL if it is configured,
// otherwise falls back to the origin of the current request.
export function getSiteUrl(env, request) {
  const configured = typeof env.SITE_URL === 'string' ? env.SITE_URL.trim().replace(/\/+$/, '') : '';
  if (/^https?:\/\/[^/]+$/.test(configured) && !configured.includes('REPLACE_WITH')) {
    return configured;
  }
  return new URL(request.url).origin;
}

// Throws a generic 500 if required variables are missing or still placeholders.
// The names are only logged on the server, never sent to the browser.
export function requireEnv(env, names) {
  const missing = names.filter((name) => {
    const value = env[name];
    return typeof value !== 'string' || value === '' || value.startsWith('REPLACE_WITH');
  });
  if (missing.length > 0) {
    console.error('Missing server configuration:', missing.join(', '));
    throw new ApiError(500, 'server_misconfigured', 'The server is not configured correctly.');
  }
}
