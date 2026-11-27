import { OAUTH_COOKIE, OAUTH_TTL_SECONDS, RATE_LIMITS } from '../../../_lib/config.js';
import { randomToken, sha256Base64Url } from '../../../_lib/crypto.js';
import { getSiteUrl, redirect, requireEnv, serializeCookie } from '../../../_lib/http.js';
import { enforceIpRateLimit } from '../../../_lib/rate-limit.js';

export async function onRequestGet({ request, env }) {
  console.log("1. Login-Funktion gestartet!");
  
  try {
    requireEnv(env, ['GOOGLE_CLIENT_ID', 'APP_SECRET']);
    console.log("2. Environment-Variablen sind da.");

    const siteUrl = getSiteUrl(env, request);
    const requestOrigin = new URL(request.url).origin;
    console.log("3. Request Origin:", requestOrigin, "| SITE_URL:", siteUrl);

    if (requestOrigin !== siteUrl) {
      console.log("4. Origin stimmt nicht überein. Leite weiter zu SITE_URL...");
      return redirect(`${siteUrl}/api/auth/google/login`);
    }

    console.log("5. Starte Rate Limit Prüfung...");
    await enforceIpRateLimit(env, request, 'login', RATE_LIMITS.login);
    console.log("6. Rate Limit OK.");

    const state = randomToken(32);
    const nonce = randomToken(16);
    const codeVerifier = randomToken(48);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    console.log("7. Tokens generiert.");

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${siteUrl}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });

    const oauthCookie = serializeCookie(OAUTH_COOKIE, `${state}.${codeVerifier}.${nonce}`, {
      maxAge: OAUTH_TTL_SECONDS,
    });

    console.log("8. Alles bereit. Leite jetzt zu Google weiter!");
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, [oauthCookie]);
    
  } catch (error) {
    console.error("FEHLER IM LOGIN:", error.message, error.stack);
    throw error;
  }
}
