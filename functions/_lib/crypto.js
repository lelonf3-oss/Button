// Crypto helpers based on the Web Crypto API (available in Cloudflare Workers).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Cryptographically secure random token, URL-safe.
export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

// Used for the PKCE code challenge.
export async function sha256Base64Url(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

// Constant-time string comparison.
export function timingSafeEqual(a, b) {
  const bytesA = encoder.encode(String(a));
  const bytesB = encoder.encode(String(b));
  let diff = bytesA.length ^ bytesB.length;
  const length = Math.max(bytesA.length, bytesB.length);
  for (let i = 0; i < length; i++) {
    diff |= (bytesA[i] || 0) ^ (bytesB[i] || 0);
  }
  return diff === 0;
}

// Decodes the payload of a JWT WITHOUT verifying a signature.
// Only use this for tokens received directly from Google's token endpoint over
// HTTPS (as allowed by Google's documentation), and always validate iss/aud/exp.
export function decodeJwtPayload(jwt) {
  if (typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(decoder.decode(base64UrlToBytes(parts[1])));
  } catch {
    return null;
  }
}
