// GET /sitemap.xml
// Generated dynamically so all URLs follow the SITE_URL variable.
// No <lastmod> is included on purpose (we do not invent dates).

import { getSiteUrl } from './_lib/http.js';

const PATHS = ['/', '/privacy.html', '/terms.html', '/payments.html', '/imprint.html'];

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function onRequestGet({ request, env }) {
  const siteUrl = getSiteUrl(env, request);
  const urls = PATHS.map((path) => `  <url><loc>${escapeXml(siteUrl + path)}</loc></url>`).join('\n');
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
