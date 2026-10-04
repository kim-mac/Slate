import type { APIRoute } from 'astro';
import { sitemapXml } from '../data/site';

// No fabricated sitemap in previews. Setting the verified domain enables it.
export function getStaticPaths() {
  return sitemapXml() ? [{ params: { sitemap: 'sitemap' } }] : [];
}

export const GET: APIRoute = () =>
  new Response(sitemapXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
