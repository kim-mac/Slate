import type { APIRoute } from 'astro';
import { site, canonicalUrl } from '../data/site';
import { release, downloadUrl } from '../data/releases';

export const GET: APIRoute = () => {
  const links = [
    ['Official website', canonicalUrl('/')],
    ['Windows download guide', canonicalUrl('/download/windows/')],
    ['Support', canonicalUrl('/support/')],
    ['Privacy', canonicalUrl('/privacy/')],
    ['Source code', site.repositoryUrl],
    ['Chrome Web Store', downloadUrl(release.downloads.chrome)],
  ];
  const text = `# ${site.name}

> ${site.description}

## Availability

- Desktop version: ${release.version}
- Available for Windows 11 on x64 (Intel/AMD) and ARM64 PCs.
- macOS is coming soon; no macOS download or release date is available.
- Free and open source under the MIT license.
- No Slate account or sign-in is required.

## Storage and capabilities

- Clips and source metadata are stored locally in SQLite, not encrypted by Slate.
- Create, edit, search, pin, and organize clips into groups. Quick Search finds saved clips for reuse.
- The core desktop library works offline. Opening websites and downloading software require internet access.
- The Chrome extension is optional and requires Slate Desktop and its installed native host for browser capture.
- Save selection captures selected text. Save this page saves the page title and URL, not the full webpage.
- Supported ChatGPT, Claude, and Gemini pages offer selected-snippet capture, not entire conversation export.
- Browser captures pass through local Native Messaging to the desktop library.

## Official links

${links
  .filter(([, url]) => url)
  .map(([label, url]) => `- [${label}](${url})`)
  .join('\n')}
`;
  return new Response(text, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
