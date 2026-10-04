export const site = {
  name: 'Slate',
  title: 'Slate | Keep what matters. Find it again.',
  description:
    'Save clips, notes, and links in your own local library. Capture, search, and group what matters with Slate for Windows.',
  // Set only after the production domain is selected and verified. Preview stays noindex.
  url: null as string | null,
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
