import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const file = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFileSync(file(path), 'utf8');

test('three focused product demos replace the feature placeholders', () => {
  const features = read('src/components/Features.astro');
  assert.equal((features.match(/<FeatureCard\b/g) ?? []).length, 3);
  for (const name of [
    'BrowserCaptureDemo',
    'DesktopCaptureDemo',
    'QuickSearchDemo',
  ]) {
    assert.match(features, new RegExp(`<${name}\\s*/>`));
    assert.ok(existsSync(file(`src/components/${name}.astro`)));
  }
  assert.doesNotMatch(features, /Video coming soon|demo-placeholder|Merge/);
});

test('browser demo uses real floating feedback and context-menu labels', () => {
  const path = file('src/components/BrowserCaptureDemo.astro');
  assert.ok(existsSync(path), 'Browser demo must exist');
  const source = readFileSync(path, 'utf8');
  for (const text of [
    'Save',
    'Saving',
    'Saved',
    'Saved locally',
    'Save selection',
    'Save this page',
  ]) {
    assert.ok(
      source.includes(text),
      `Missing actual extension wording: ${text}`,
    );
  }
  assert.match(source, /browser-ai-scene/);
  assert.match(source, /browser-web-scene/);
  assert.match(source, /API gateway/);
  assert.doesNotMatch(source, /<button|<input|<a\b|tabindex/);
});

test('desktop demo shows direct-save notification, not an invented capture dialog', () => {
  const path = file('src/components/DesktopCaptureDemo.astro');
  assert.ok(existsSync(path), 'Desktop demo must exist');
  const source = readFileSync(path, 'utf8');
  assert.match(source, /keys=\{\['Ctrl', 'Alt', 'Shift', 'C'\]\}/);
  assert.match(source, /Saved to Slate/);
  assert.doesNotMatch(
    source,
    /<button|<input|<dialog|Create clip|Save changes/,
  );
});

test('Quick Search has verified shortcut, actual launcher affordances and Enter copy feedback', () => {
  const path = file('src/components/QuickSearchDemo.astro');
  assert.ok(existsSync(path), 'Quick Search demo must exist');
  const source = readFileSync(path, 'utf8');
  assert.match(source, /keys=\{\['Ctrl', 'Shift', 'Space'\]\}/);
  for (const text of [
    'Quick Search',
    'New',
    'Search clips',
    'API gateway',
    'Copy all',
    'Copied',
  ]) {
    assert.ok(source.includes(text), `Missing launcher affordance: ${text}`);
  }
  assert.match(source, /<kbd class="demo-enter-key">Enter<\/kbd>/);
  assert.match(source, /demo-result-tools/);
  assert.doesNotMatch(source, /Icon name="copy"/);
  assert.doesNotMatch(source, /Ctrl \+ Shift \+ C|<button|<input|tabindex/);
});

test('demos are decorative with real accessible pause controls and reduced-motion static states', () => {
  assert.ok(existsSync(file('src/components/FeatureCard.astro')));
  const card = read('src/components/FeatureCard.astro');
  assert.match(card, /feature-demo feature-demo-\$\{demo\}/);
  assert.match(card, /class="demo-visual" aria-hidden="true"/);
  assert.match(card, /data-demo-toggle/);
  assert.match(card, /type="button"/);
  const css = read('src/styles/feature-demos.css');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation-play-state:\s*paused/);
  assert.match(css, /data-static/);
  assert.doesNotMatch(css, /animation:\s*[^;]*(?:bounce|spin)/);
});

async function controller() {
  const path = file('src/scripts/featureDemos.ts');
  assert.ok(existsSync(path), 'Viewport animation controller must exist');
  return import(path.href);
}

function harness({
  reduced = false,
  observerAvailable = true,
  count = 1,
} = {}) {
  let intersect;
  let disconnected = false;
  const media = new EventTarget();
  media.matches = reduced;
  const doc = new EventTarget();
  doc.hidden = false;
  const buttons = Array.from({ length: count }, () => {
    const button = new EventTarget();
    button.attributes = {};
    button.setAttribute = (key, value) => {
      button.attributes[key] = value;
    };
    return button;
  });
  const demos = buttons.map((button, index) => {
    const demo = new EventTarget();
    demo.dataset = {
      demoLabel: ['Browser capture', 'Desktop capture', 'Quick Search'][index],
    };
    demo.querySelector = () => button;
    return demo;
  });
  const [demo] = demos;
  const [button] = buttons;
  doc.querySelectorAll = () => demos;
  class Observer {
    constructor(callback) {
      intersect = callback;
    }
    observe(target) {
      assert.ok(demos.includes(target));
    }
    disconnect() {
      disconnected = true;
    }
  }
  return {
    doc,
    demo,
    button,
    demos,
    buttons,
    media,
    environment: {
      matchMedia: () => media,
      IntersectionObserver: observerAvailable ? Observer : undefined,
    },
    enter: (visible, index = 0) =>
      intersect([{ target: demos[index], isIntersecting: visible }]),
    enterAll: () =>
      intersect(demos.map((target) => ({ target, isIntersecting: true }))),
    finish: (index, name = 'demo-cycle') => {
      const event = new Event('animationiteration');
      event.animationName = name;
      demos[index].dispatchEvent(event);
    },
    disconnected: () => disconnected,
  };
}

test('CSS loops run only when observed onscreen and the page is visible', async () => {
  const { initializeFeatureDemos } = await controller();
  const h = harness();
  initializeFeatureDemos(h.doc, h.environment);
  assert.equal(h.demo.dataset.running, 'false');
  h.enter(true);
  assert.equal(h.demo.dataset.running, 'true');
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.demo.dataset.running, 'false');
  h.doc.hidden = false;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.demo.dataset.running, 'true');
  h.enter(false);
  assert.equal(h.demo.dataset.running, 'false');
});

test('manual pause survives viewport changes and resumes explicitly', async () => {
  const { initializeFeatureDemos } = await controller();
  const h = harness();
  initializeFeatureDemos(h.doc, h.environment);
  h.enter(true);
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.demo.dataset.running, 'false');
  assert.equal(h.button.attributes['aria-pressed'], 'true');
  assert.equal(h.button.attributes['aria-label'], 'Resume feature demos');
  h.enter(false);
  h.enter(true);
  assert.equal(h.demo.dataset.running, 'false');
  h.button.dispatchEvent(new Event('click'));
  assert.equal(h.demo.dataset.running, 'true');
  assert.equal(h.button.attributes['aria-label'], 'Pause feature demos');
});

test('only one card runs, handing visual emphasis from browser to desktop to search and back', async () => {
  const { initializeFeatureDemos } = await controller();
  const h = harness({ count: 3 });
  const cleanup = initializeFeatureDemos(h.doc, h.environment);
  h.enterAll();
  const active = () => h.demos.map((demo) => demo.dataset.active);
  const running = () => h.demos.map((demo) => demo.dataset.running);
  assert.deepEqual(running(), ['true', 'false', 'false']);
  assert.deepEqual(active(), ['true', 'false', 'false']);
  h.finish(0, 'save-done');
  h.finish(1);
  assert.deepEqual(running(), ['true', 'false', 'false']);
  h.finish(0);
  assert.deepEqual(running(), ['false', 'true', 'false']);
  assert.deepEqual(active(), ['false', 'true', 'false']);
  h.finish(1);
  assert.deepEqual(running(), ['false', 'false', 'true']);
  h.finish(2);
  assert.deepEqual(running(), ['true', 'false', 'false']);
  cleanup();
  h.finish(0);
  assert.deepEqual(running(), ['false', 'false', 'false']);
});

test('pause and hidden-page gates stop the entire sequence without advancing it', async () => {
  const { initializeFeatureDemos } = await controller();
  const h = harness({ count: 3 });
  const cleanup = initializeFeatureDemos(h.doc, h.environment);
  h.enterAll();
  h.buttons[1].dispatchEvent(new Event('click'));
  h.finish(0);
  assert.ok(h.demos.every((demo) => demo.dataset.running === 'false'));
  assert.equal(h.demos[0].dataset.active, 'true');
  assert.ok(
    h.buttons.every((button) => button.attributes['aria-pressed'] === 'true'),
  );
  h.buttons[2].dispatchEvent(new Event('click'));
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  h.finish(0);
  assert.equal(h.demos[0].dataset.active, 'true');
  h.doc.hidden = false;
  h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.demos[0].dataset.running, 'true');
  cleanup();
});

test('stacked cards follow the visible card without scrolling or running offscreen demos', async () => {
  const { initializeFeatureDemos } = await controller();
  const h = harness({ count: 3 });
  const cleanup = initializeFeatureDemos(h.doc, h.environment);
  h.enter(true);
  h.enter(false);
  assert.ok(h.demos.every((demo) => demo.dataset.running === 'false'));
  h.enter(true, 1);
  assert.deepEqual(
    h.demos.map((demo) => demo.dataset.running),
    ['false', 'true', 'false'],
  );
  h.finish(1);
  assert.equal(h.demos[1].dataset.running, 'true');
  h.enter(true, 2);
  h.finish(1);
  assert.deepEqual(
    h.demos.map((demo) => demo.dataset.running),
    ['false', 'false', 'true'],
  );
  cleanup();
});

test('reduced motion and unavailable observation leave meaningful static demos', async () => {
  const { initializeFeatureDemos } = await controller();
  for (const options of [{ reduced: true }, { observerAvailable: false }]) {
    const h = harness(options);
    initializeFeatureDemos(h.doc, h.environment);
    if (options.reduced) h.enter(true);
    assert.equal(h.demo.dataset.static, 'true');
    assert.equal(h.demo.dataset.running, 'false');
    assert.equal(h.button.hidden, true);
  }
  const h = harness();
  initializeFeatureDemos(h.doc, h.environment);
  h.enter(true);
  h.media.matches = true;
  h.media.dispatchEvent(new Event('change'));
  assert.equal(h.demo.dataset.running, 'false');
  assert.equal(h.demo.dataset.static, 'true');
  h.media.matches = false;
  h.media.dispatchEvent(new Event('change'));
  assert.equal(h.demo.dataset.running, 'true');
  assert.equal(h.demo.dataset.static, 'false');
});

test('cleanup disconnects observation and removes all animation listeners', async () => {
  const { initializeFeatureDemos } = await controller();
  const h = harness();
  const cleanup = initializeFeatureDemos(h.doc, h.environment);
  h.enter(true);
  cleanup();
  assert.equal(h.disconnected(), true);
  assert.equal(h.demo.dataset.running, 'false');
  h.button.dispatchEvent(new Event('click'));
  h.doc.dispatchEvent(new Event('visibilitychange'));
  h.media.dispatchEvent(new Event('change'));
  assert.equal(h.demo.dataset.running, 'false');
  assert.equal(h.button.attributes['aria-pressed'], 'false');
});
