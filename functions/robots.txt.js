// GET /robots.txt
// Generated dynamically so the sitemap URL follows the SITE_URL variable.

import { getSiteUrl } from './_lib/http.js';

export async function onRequestGet({ request, env }) {
  const siteUrl = getSiteUrl(env, request);
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
