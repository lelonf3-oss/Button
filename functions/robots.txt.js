import { getSiteUrl } from './_lib/http.js';

export async function onRequestGet({ env, request }) {
  const base = getSiteUrl(env, request);
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
