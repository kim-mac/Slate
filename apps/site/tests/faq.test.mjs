import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const built = (path = 'index.html') =>
  readFileSync(new URL('../dist/' + path, import.meta.url), 'utf8');
const text = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

test('eight FAQs follow Get Slate and precede the homepage footer', () => {
  const html = built();
  const faq = html.match(/<section\b[^>]*id="faq"[\s\S]*?<\/section>/)?.[0];
  assert.ok(faq);
  assert.match(faq, /Frequently asked questions/);
  assert.match(faq, /Everything you need to know about Slate\./);
  assert.ok(html.indexOf('id="download"') < html.indexOf('id="faq"'));
  assert.ok(html.indexOf('id="faq"') < html.indexOf('<footer'));
  assert.deepEqual(
    [...faq.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((match) =>
      text(match[1]),
    ),
    [
      'What is Slate?',
      'Is Slate free?',
      'Is my data private?',
      'How does the Chrome extension work?',
      'Do I need the Chrome extension?',
      'Does Slate work offline?',
      'Is Slate available for macOS?',
      'Do I need to create an account?',
    ],
  );
  const items = [...faq.matchAll(/<details\b([^>]*)>/g)];
  assert.equal(items.length, 8);
  for (const [, attrs] of items) {
    assert.match(attrs, /name="slate-faq"/);
    assert.doesNotMatch(attrs, /\bopen(?:\s|=|$)/);
  }
  assert.equal(
    (faq.match(/class="faq-mark"[^>]*aria-hidden="true"/g) ?? []).length,
    8,
  );
});

test('FAQ copy describes shipped local storage, optional extension, offline use and unavailable macOS', () => {
  const html = built();
  const faq = text(
    html.match(/<section\b[^>]*id="faq"[\s\S]*?<\/section>/)?.[0] ?? '',
  );
  assert.match(faq, /free and open source under the MIT license/);
  assert.match(faq, /not encrypted by Slate/);
  assert.match(faq, /Save selection/);
  assert.match(faq, /Save this page.*link and its title/);
  assert.match(faq, /extension is optional/);
  assert.match(faq, /saved clips without an internet connection/);
  assert.match(faq, /macOS download is not available/);
  assert.match(faq, /No Slate account or sign-in/);
  assert.doesNotMatch(
    faq,
    /end-to-end|encrypted by default|subscription|launching (?:in|on)|coming (?:in|on) \d/i,
  );
});

test('homepage Windows and macOS CTAs use decorative filled platform marks without enabling macOS', () => {
  const html = built();
  const windows = [
    ...html.matchAll(
      /<a\b[^>]*href="\/download\/windows\/\?start=1"[^>]*>([\s\S]*?)<\/a>/g,
    ),
  ];
  assert.equal(windows.length, 2);
  for (const [, content] of windows) {
    assert.match(content, /data-platform-logo="windows"/);
    assert.match(content, /fill="currentColor"/);
    assert.match(content, /aria-hidden="true"/);
    assert.equal(text(content), 'Download for Windows');
  }
  const mac = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
    (match) => text(match[2]) === 'Coming soon for macOS',
  );
  assert.ok(mac);
  assert.match(mac[1], /\bdisabled(?:\s|$)/);
  assert.doesNotMatch(mac[1], /href=|onclick=|tabindex=/);
  assert.match(mac[2], /data-platform-logo="apple"/);
  assert.match(mac[2], /aria-hidden="true"/);
  assert.equal(text(mac[2]), 'Coming soon for macOS');
});

test('vendored platform paths keep their license in source and public build output', () => {
  const source = readFileSync(
    new URL('../src/components/PlatformLogo.astro', import.meta.url),
    'utf8',
  );
  assert.match(source, /Bootstrap Icons v1\.13\.1/);
  const license = readFileSync(
    new URL('../public/licenses/bootstrap-icons-LICENSE.txt', import.meta.url),
  );
  assert.match(license.toString(), /2019-2024 The Bootstrap Authors/);
  assert.match(license.toString(), /The MIT License/);
  assert.deepEqual(
    readFileSync(
      new URL('../dist/licenses/bootstrap-icons-LICENSE.txt', import.meta.url),
    ),
    license,
  );
});
