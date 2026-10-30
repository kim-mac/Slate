import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { site, canonicalUrl } from '../src/data/site.ts';
import { release, downloadUrl } from '../src/data/releases.ts';

const read = (path) =>
  readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const description =
  'Slate is a free, open-source productivity app that saves useful snippets from ChatGPT, Claude, and the web to a private local library. Available for Windows, with macOS coming soon.';
const home = () => read('dist/index.html');
const structuredData = (html) =>
  [
    ...html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => JSON.parse(match[1]));

test('canonical product description is consistent without changing visible hero copy', () => {
  assert.equal(site.description, description);
  for (const meta of [
    'name="description"',
    'property="og:description"',
    'name="twitter:description"',
  ])
    assert.ok(home().includes(`<meta ${meta} content="${description}"`));
  const readme = readFileSync(
    new URL('../../../README.md', import.meta.url),
    'utf8',
  );
  assert.equal(readme.split(/\r?\n\r?\n/)[1].replace(/\s+/g, ' '), description);
  assert.match(
    home(),
    /Save useful information from ChatGPT, Claude, the web, and your desktop/,
  );
});

test('homepage describes only the released Windows app and its optional companion', () => {
  const tags = [
    ...home().matchAll(/<script\b([^>]*\btype="application\/ld\+json"[^>]*)>/g),
  ];
  assert.equal(tags.length, 1);
  assert.doesNotMatch(tags[0][1], /\bsrc=|\bon\w+=/i);
  const records = structuredData(home());
  assert.equal(records.length, 1);
  const app = records[0];
  assert.equal(app['@context'], 'https://schema.org');
  assert.equal(app['@type'], 'SoftwareApplication');
  assert.equal(app.name, site.name);
  assert.equal(app.description, description);
  assert.equal(app.url, canonicalUrl('/'));
  assert.equal(app.softwareVersion, release.version);
  assert.equal(app.operatingSystem, 'Windows 11');
  assert.match(app.processorRequirements, /x64.*ARM64/);
  assert.equal(app.applicationCategory, 'ProductivityApplication');
  assert.equal(Number(app.offers.price), 0);
  assert.equal(app.offers['@type'], 'Offer');
  assert.equal(app.license, `${site.repositoryUrl}/blob/main/LICENSE`);
  assert.equal(app.image, canonicalUrl('/brand/slate-icon.png'));
  assert.deepEqual(app.downloadUrl, [
    downloadUrl(release.downloads.windowsX64),
    downloadUrl(release.downloads.windowsARM64),
  ]);
  assert.equal(app.sameAs, site.repositoryUrl);
  assert.equal(app.softwareAddOn.url, downloadUrl(release.downloads.chrome));
  assert.match(app.softwareAddOn.softwareRequirements, /Slate Desktop/);
  for (const key of ['review', 'aggregateRating', 'screenshot'])
    assert.equal(app[key], undefined);
  for (const path of [
    'privacy/index.html',
    'support/index.html',
    'download/windows/index.html',
    '404.html',
  ]) {
    assert.deepEqual(structuredData(read('dist/' + path)), []);
  }
});

test('generated llms.txt reuses release metadata and gives accurate capture and availability guidance', () => {
  const text = read('dist/llms.txt');
  assert.match(text, /^# Slate\n/);
  assert.ok(text.includes(description));
  assert.ok(text.includes(`Desktop version: ${release.version}`));
  assert.match(text, /Windows 11.*x64.*ARM64/);
  assert.match(text, /macOS.*coming soon/);
  assert.match(text, /MIT/);
  assert.match(text, /No Slate account/);
  assert.match(text, /SQLite.*not encrypted/);
  assert.match(text, /Save selection.*selected text/);
  assert.match(text, /Save this page.*title and URL.*not.*full/);
  assert.match(text, /ChatGPT, Claude, and Gemini/);
  assert.match(text, /extension is optional.*requires Slate Desktop/);
  assert.match(text, /Quick Search/);
  for (const url of [
    canonicalUrl('/'),
    canonicalUrl('/download/windows/'),
    canonicalUrl('/support/'),
    canonicalUrl('/privacy/'),
    site.repositoryUrl,
    downloadUrl(release.downloads.chrome),
  ])
    assert.ok(text.includes(url));
  assert.doesNotMatch(
    text,
    /0\.1\.2|cloud sync|Download for macOS|guaranteed.*index/i,
  );
});

test('security.txt publishes the verified contact and an unexpired RFC 9116 record', () => {
  const text = read('dist/.well-known/security.txt');
  const fields = Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const index = line.indexOf(':');
        return [line.slice(0, index), line.slice(index + 1).trim()];
      }),
  );
  assert.deepEqual(fields, {
    Contact: 'mailto:support@tryslate.tech',
    Expires: '2027-10-27T00:00:00.000Z',
    'Preferred-Languages': 'en',
    Canonical: canonicalUrl('/.well-known/security.txt'),
  });
  assert.ok(Date.parse(fields.Expires) > Date.now());
  assert.match(
    read('dist/support/index.html'),
    /href="mailto:support@tryslate.tech"/,
  );
  assert.equal(read('public/.well-known/security.txt'), text);
});

test('favicon ICO contains complete 16, 32 and 48 pixel images and preserves PNG declarations', () => {
  const icon = readFileSync(new URL('../dist/favicon.ico', import.meta.url));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 3);
  for (const [index, size] of [16, 32, 48].entries()) {
    const offset = 6 + index * 16;
    assert.equal(icon[offset], size);
    assert.equal(icon[offset + 1], size);
    const bytes = icon.readUInt32LE(offset + 8);
    const start = icon.readUInt32LE(offset + 12);
    assert.ok(bytes > 0 && start >= 54 && start + bytes <= icon.length);
  }
  assert.match(home(), /<link\b[^>]*rel="icon"[^>]*href="\/favicon.ico"/);
  assert.match(
    home(),
    /<link\b[^>]*type="image\/png"[^>]*href="\/favicon.png"/,
  );
  assert.deepEqual(
    icon,
    readFileSync(new URL('../public/favicon.ico', import.meta.url)),
  );
});

test('immutable caching is restricted to the verified fingerprinted Astro output', () => {
  const headers = read('dist/_headers');
  const rules = headers.trim().split(/\n\s*\n/);
  const immutable = rules.filter((rule) => /\bimmutable\b/.test(rule));
  assert.equal(immutable.length, 1);
  assert.match(immutable[0], /^\/_astro\/\*\n/);
  assert.match(
    immutable[0],
    /Cache-Control: public, max-age=31536000, immutable/,
  );
  const assets = readdirSync(new URL('../dist/_astro/', import.meta.url));
  assert.ok(assets.length > 0);
  for (const name of assets) assert.match(name, /\.[\w-]{8,}\.[a-z0-9]+$/i);
  assert.doesNotMatch(
    headers,
    /Cross-Origin-Opener-Policy|Content-Security-Policy|payment=|usb=/i,
  );
  assert.match(
    headers,
    /Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\)/,
  );
});

test('public documentation agrees on released desktop and preserves pending extension availability', () => {
  for (const path of ['../../../README.md', '../../../SECURITY.md']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(
      text,
      new RegExp(`Desktop\\s*\\|\\s*${release.version.replaceAll('.', '\\.')}`),
    );
    assert.match(text, /Chrome extension\s*\|\s*0\.1\.1/);
  }
  const readme = read('README.md');
  assert.doesNotMatch(
    readme,
    /locally prepared Slate Desktop 0\.3\.1 activation|still serve public v0\.3\.0/,
  );
});
