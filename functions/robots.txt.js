export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const base = env.PUBLIC_CANONICAL_URL || url.origin;
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
