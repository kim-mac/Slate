import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const routes = [
  'index.html',
  'privacy/index.html',
  'support/index.html',
  '404.html',
];
const page = (path) => {
  assert.ok(existsSync(resolve(output, path)), 'Built route missing: ' + path);
  return readFileSync(resolve(output, path), 'utf8');
};

test('Support explains shipping workflows and a truthful reporting destination', () => {
  const html = page('support/index.html');
  for (const heading of [
    'Slate Support',
    'Getting started',
    'Saving from Chrome',
    'Quick Search',
    'Merge',
    'Troubleshooting',
    'Platform support',
    'Reporting a problem',
  ]) {
    assert.ok(html.includes(heading), 'Missing Support section: ' + heading);
  }
  for (const text of [
    'Save selection',
    'Save this page',
    'Ctrl',
    'Shift',
    'Space',
    'Windows x64',
    'Windows ARM64',
    'Unmerge',
  ]) {
    assert.ok(html.includes(text), 'Missing verified guidance: ' + text);
  }
  assert.match(html, /desktop app installed/);
  assert.match(html, /original clips/);
  assert.match(html, /source and date/);
  assert.match(html, /href="https:\/\/github\.com\/kim-mac\/Slate"/);
  assert.doesNotMatch(html, /mailto:|Smart Merge|macOS|MCP|delete.*database/i);
});

test('404 is branded, non-indexable, and offers a working return home link', () => {
  const html = page('404.html');
  assert.match(html, /This page isn't in Slate/);
  assert.match(html, /href="\/">Return home/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test('all launch routes preserve accessible structure, safe links, themes and concise copy', () => {
  for (const route of routes) {
    const html = page(route);
    assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1);
    assert.match(html, /<html[^>]*lang="en"/);
    assert.match(html, /href="#main"/);
    assert.match(html, /<main[^>]*id="main"/);
    assert.match(html, /href="\/support\/"/);
    assert.match(html, /data-theme-toggle/);
    assert.match(html, /data-slate-theme/);
    assert.match(html, /name="description" content="[^"]+"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(html, /\u2014|&mdash;|&#8212;|&#x2014;/i);
    assert.doesNotMatch(html, /https?:\/\/localhost|pages\.dev/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]*)"/g)) {
      assert.ok(url);
      if (url.startsWith('#')) assert.ok(ids.includes(url.slice(1)));
      if (url.startsWith('/')) {
        const path = url.split('#')[0].split('?')[0];
        assert.ok(
          existsSync(
            resolve(
              output,
              '.' + path + (path.endsWith('/') ? 'index.html' : ''),
            ),
          ),
          'Missing ' + url,
        );
      }
    }
    for (const [, attrs] of html.matchAll(
      /<a\b([^>]*href="https:\/\/github\.com[^>]*)>/g,
    )) {
      assert.match(attrs, /target="_blank"/);
      assert.match(attrs, /rel="noopener noreferrer"/);
    }
    assert.equal(
      (html.match(/<script\b/g) ?? []).length,
      route === 'index.html' ? 3 : 1,
    );
    assert.doesNotMatch(html, /<form|astro-island|<iframe|googletagmanager/);
  }
});

test('download area explains desktop pairing and uses the centralized release version', () => {
  const html = page('index.html');
  assert.match(
    html,
    /Slate for Windows and the Chrome extension work together/,
  );
  assert.match(html, /browser capture requires the desktop app/i);
  const privacy = readFileSync(
    resolve(root, 'src/pages/privacy.astro'),
    'utf8',
  );
  assert.match(privacy, /release\.version/);
  assert.doesNotMatch(privacy, /0\.1\.0/);
});

test('social preview is a site-owned 1200 by 630 PNG, not a copied installer or screenshot', () => {
  const file = resolve(output, 'brand/social-preview.png');
  assert.ok(existsSync(file), 'Social preview is missing');
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
});

test('domain configuration generates only the three public launch routes', async () => {
  const { site, canonicalUrl, sitemapXml, robotsText } =
    await import('../src/data/site.ts');
  assert.equal(site.url, 'https://tryslate.tech');
  assert.equal(canonicalUrl('/support/'), 'https://tryslate.tech/support/');
  assert.equal(canonicalUrl('/support/', null), null);
  assert.equal(sitemapXml(null), null);
  assert.equal(robotsText(null), 'User-agent: *\nDisallow: /\n');
  const base = 'https://slate.example';
  for (const invalid of [
    'http://slate.example',
    'not a URL',
    'https://user:password@slate.example',
    'https://slate.example?draft=1',
  ]) {
    assert.equal(canonicalUrl('/', invalid), null);
    assert.equal(sitemapXml(invalid), null);
    assert.equal(robotsText(invalid), 'User-agent: *\nDisallow: /\n');
  }
  assert.equal(canonicalUrl('/support/', base), base + '/support/');
  const xml = sitemapXml(base);
  for (const path of ['/', '/privacy/', '/support/'])
    assert.ok(xml.includes('<loc>' + base + path + '</loc>'));
  assert.equal((xml.match(/<loc>/g) ?? []).length, 3);
  assert.doesNotMatch(xml, /404|localhost|pages\.dev/);
  assert.match(
    robotsText(base),
    /Sitemap: https:\/\/slate\.example\/sitemap\.xml/,
  );
  assert.equal(
    robotsText(),
    'User-agent: *\nAllow: /\nSitemap: https://tryslate.tech/sitemap.xml\n',
  );
  assert.deepEqual(
    [...sitemapXml().matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]),
    [
      'https://tryslate.tech/',
      'https://tryslate.tech/privacy/',
      'https://tryslate.tech/support/',
    ],
  );
});
