export const site = {
  name: 'Slate',
  title: 'Slate | Save what matters. Without breaking your flow.',
  description:
    'Save useful information from ChatGPT, Claude, the web, and your desktop directly to your private local library without having to copy and paste.',
  // Canonical production origin; never derive it from a Pages preview URL.
  url: 'https://tryslate.tech' as string | null,
  repositoryUrl: 'https://github.com/kim-mac/Slate',
  // Public GitHub API returned 404 during verification. Show the Star action,
  // not an invented count. Set only from verified public repository metadata.
  githubStars: null as number | null,
};

export function canonicalUrl(
  path: string,
  base: string | null = site.url,
): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return new URL(path, url.origin).href;
  } catch {
    return null;
  }
}

export const publicRoutes = ['/', '/privacy/', '/support/'] as const;

export function sitemapXml(base: string | null = site.url): string | null {
  if (!canonicalUrl('/', base)) return null;
  const locations = publicRoutes
    .map((path) => `<url><loc>${canonicalUrl(path, base)}</loc></url>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations}</urlset>`;
}

export function robotsText(base: string | null = site.url): string {
  const sitemap = canonicalUrl('/sitemap.xml', base);
  return sitemap
    ? `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`
    : 'User-agent: *\nDisallow: /\n';
}
