import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homepage = () =>
  readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const miniatures = (html) =>
  html.match(/<aside\b[^>]*data-hero-miniatures[\s\S]*?<\/aside>/)?.[0];

test('hero has four static Slate feature miniatures with no pretend interactive controls', () => {
  const illustration = miniatures(homepage());
  assert.ok(illustration, 'Four decorative hero miniatures must be rendered');
  assert.match(illustration, /aria-hidden="true"/);
  assert.match(illustration, /\binert(?:\s|>)/);
  assert.deepEqual(
    [...illustration.matchAll(/data-hero-miniature="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ['saved', 'search', 'pinned', 'capture'],
  );
  assert.match(illustration, /Quick Search/);
  assert.match(illustration, /API gateway/);
  assert.match(illustration, /Pinned/);
  assert.match(illustration, /Save selection/);
  assert.match(illustration, /Saved locally/);
  assert.doesNotMatch(
    illustration,
    /<(?:button|a|input|textarea|select|script)\b|tabindex=|contenteditable|role="(?:button|searchbox)"/,
  );
});

test('miniatures do not change the existing large library and Calendar illustration', () => {
  const html = homepage();
  assert.ok(miniatures(html));
  const figure = html.match(
    /<figure\b[^>]*id="product"[\s\S]*?<\/figure>/,
  )?.[0];
  assert.ok(figure);
  assert.equal(
    createHash('sha256').update(figure).digest('hex'),
    '56e9dd7cf661b12af3b87f9d10efa82bba52bba59133bfe52cd7fb52a2425792',
  );
  assert.ok(
    html.indexOf('data-hero-miniatures') < html.indexOf('id="product"'),
  );
});

test('four cards share a restrained inward inset without changing their designs', () => {
  const source = readFileSync(
    new URL('../src/components/HeroMiniatures.astro', import.meta.url),
    'utf8',
  );
  const inset = source.match(/--hero-card-inset:\s*(\d+)px/);
  assert.ok(inset, 'Cards must use one shared inward inset');
  assert.ok(Number(inset[1]) >= 20 && Number(inset[1]) <= 35);
  for (const [name, side] of [
    ['saved-clip', 'left'],
    ['quick-search', 'right'],
    ['pinned-clip', 'left'],
    ['browser-capture', 'right'],
  ]) {
    const rule = source.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(rule);
    assert.match(rule, new RegExp(`${side}:\\s*var\\(--hero-card-inset\\)`));
  }
});
