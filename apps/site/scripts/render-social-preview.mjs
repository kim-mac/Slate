// Optional one-time asset renderer using Astro's existing Sharp dependency.
// Does not run in the browser or during the normal site build.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const requireAstro = createRequire(require.resolve('astro/package.json'));
const sharp = requireAstro('sharp');
const mark = readFileSync(
  resolve(root, '../../assets/brand/slate-icon-master-1024.png'),
).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#171717"/>
  <image href="data:image/png;base64,${mark}" x="80" y="92" width="144" height="144"/>
  <text x="252" y="205" fill="#ffffff" font-family="Segoe UI,Arial,sans-serif" font-weight="600" font-size="86">Slate</text>
  <text x="80" y="374" fill="#ffffff" font-family="Segoe UI,Arial,sans-serif" font-size="60">Your memory,</text>
  <text x="80" y="450" fill="#ffffff" font-family="Segoe UI,Arial,sans-serif" font-size="60">outside the tab.</text>
</svg>`;
await sharp(Buffer.from(svg))
  .png()
  .toFile(resolve(root, 'public/brand/social-preview.png'));
