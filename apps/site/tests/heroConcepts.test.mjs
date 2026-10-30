import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homepage = () =>
  readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

test('hero contains three original decorative concepts, not third-party logos or controls', () => {
  const html = homepage();
  const concepts = html.match(
    /<span\b[^>]*data-hero-concepts[\s\S]*?<\/span>\s*<\/span>/,
  )?.[0];
  assert.ok(concepts, 'Original concept tiles must be rendered');
  assert.match(concepts, /aria-hidden="true"/);
  assert.match(concepts, /\binert(?:\s|>)/);
  assert.deepEqual(
    [...concepts.matchAll(/data-hero-concept="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ['browser', 'conversation', 'snippet'],
  );
  assert.equal((concepts.match(/<svg\b/g) ?? []).length, 3);
  assert.equal((concepts.match(/focusable="false"/g) ?? []).length, 3);
  assert.doesNotMatch(
    concepts,
    /<(?:img|a|button|input|script|iframe)\b|https?:|tabindex=|contenteditable|ChatGPT|Claude|Gemini|Google|OpenAI|Twitter|Chrome/i,
  );
  assert.ok(
    html.indexOf('data-hero-miniatures') < html.indexOf('data-hero-concepts'),
  );
  assert.ok(html.indexOf('data-hero-concepts') < html.indexOf('id="product"'));
});

test('hero dot layer reuses the preview pattern with a quiet masked center', () => {
  const source = readFileSync(
    new URL('../src/components/Hero.astro', import.meta.url),
    'utf8',
  );
  const dots = (
    source.match(/\.hero \.hero-stage::before\s*\{([^}]+)\}/)?.[1] ?? ''
  ).replace(/\s+/g, ' ');
  assert.ok(dots, 'Dots must be scoped to the hero stage');
  assert.match(dots, /var\(--stage-dot\) 0\.65px, transparent 0\.9px/);
  assert.match(dots, /7px 7px/);
  assert.match(dots, /mask-image:/);
  assert.match(dots, /mask-composite:\s*intersect/);
  assert.match(dots, /pointer-events:\s*none/);
  assert.match(dots, /z-index:\s*-1/);
});

test('concept decorations stay homepage-only without adding runtime scripts', () => {
  const html = homepage();
  assert.match(html, /data-hero-concepts/);
  assert.equal(
    (html.match(/<script\b(?![^>]*\btype="application\/ld\+json")/g) ?? [])
      .length,
    2,
  );
  for (const path of [
    'download/windows/index.html',
    'support/index.html',
    'privacy/index.html',
  ]) {
    const page = readFileSync(
      new URL('../dist/' + path, import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(page, /data-hero-concepts/);
  }
});

test('hero dots soften only in light mode while retaining the dark treatment', () => {
  const source = readFileSync(
    new URL('../src/components/Hero.astro', import.meta.url),
    'utf8',
  );
  const base = source.match(/\.hero \.hero-stage::before\s*\{([^}]+)\}/)?.[1];
  assert.ok(base);
  assert.match(base, /opacity:\s*0\.35\s*;/);
  const dark = source.match(
    /:root\[data-theme=['"]dark['"]\] \.hero \.hero-stage::before\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(dark, 'Dark mode must retain its separate opacity');
  assert.match(dark, /opacity:\s*0\.45\s*;/);
});
