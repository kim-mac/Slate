import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { release } from '../src/data/releases.ts';

const controller = new URL(
  '../src/scripts/windowsDownloadGuide.ts',
  import.meta.url,
);
async function initialize(harness) {
  assert.ok(existsSync(controller), 'Windows guide controller must exist');
  const { initializeWindowsDownloadGuide } = await import(controller.href);
  return initializeWindowsDownloadGuide(
    harness.root,
    harness.browser,
    harness.window,
  );
}

function harness({
  query = '?start=1',
  hints = { platform: 'Windows', architecture: 'x86', bitness: '64' },
  platform = 'Windows',
  denied = false,
  delayed = false,
  hidden = false,
  historyFails = false,
  blocked = false,
} = {}) {
  const events = [];
  const status = { textContent: '' };
  const disclosure = { open: false };
  const listeners = {};
  let resolve;
  let markStarted;
  const started = new Promise((done) => {
    markStarted = done;
  });
  const detection = delayed
    ? new Promise((done) => {
        resolve = done;
      })
    : Promise.resolve(hints);
  const cards = Object.fromEntries(
    ['windowsX64', 'windowsARM64'].map((id) => [
      id,
      { dataset: {}, querySelector: () => ({ hidden: true }) },
    ]),
  );
  const links = [0, 1].map((index) => ({
    addEventListener: (name, fn) => {
      assert.ok(['click', 'auxclick'].includes(name));
      listeners[`manual${index}${name}`] = fn;
    },
  }));
  const document = {
    visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    removeEventListener: (name) => {
      delete listeners[name];
    },
  };
  const root = {
    ownerDocument: document,
    querySelector: (selector) => {
      if (selector === '[data-download-status]') return status;
      if (selector === '[data-download-options]') return disclosure;
      if (selector === '[data-manual-download]')
        return {
          addEventListener: (name, callback) => {
            assert.equal(name, 'click');
            listeners.fallback = callback;
          },
        };
      return cards[selector.match(/"([^"]+)"/)?.[1]];
    },
    querySelectorAll: (selector) =>
      selector === '[data-copy-hash]' ? [] : links,
  };
  const state = { retained: 'history state' };
  const location = {
    href: `https://tryslate.tech/download/windows/${query}#steps`,
    assign: (url) => {
      events.push(['assign', url]);
      if (blocked) throw new Error('blocked');
    },
  };
  const window = {
    location,
    history: {
      state,
      replaceState: (next, title, url) => {
        events.push(['replace', next, title, String(url)]);
        if (historyFails) throw new Error('denied');
        location.href = new URL(url, location.href).href;
      },
    },
  };
  const browser = {
    userAgentData: {
      platform,
      getHighEntropyValues: async () => {
        events.push(['detect']);
        markStarted();
        if (denied) throw new Error('denied');
        return detection;
      },
    },
  };
  return {
    root,
    browser,
    window,
    status,
    disclosure,
    events,
    state,
    document,
    listeners,
    started,
    finish: () => resolve(hints),
    manual: (index = 0, name = 'click') => {
      const callback = listeners[`manual${index}${name}`];
      assert.equal(
        typeof callback,
        'function',
        `${name} should cancel automatic requests`,
      );
      return callback({
        preventDefault: () =>
          assert.fail('native link behavior must be preserved'),
      });
    },
  };
}

test('exact opt-in consumes only start before detection and requests the approved architecture once', async () => {
  for (const [architecture, id] of [
    ['x86', 'windowsX64'],
    ['arm', 'windowsARM64'],
  ]) {
    const h = harness({
      query: '?keep=a%20b&start=1&keep=c',
      hints: { platform: 'Windows', architecture, bitness: '64' },
    });
    const pending = initialize(h);
    await pending;
    assert.equal(h.events[0][0], 'replace');
    assert.equal(h.events[0][1], h.state);
    const consumed = new URL(h.window.location.href);
    assert.deepEqual(consumed.searchParams.getAll('keep'), ['a b', 'c']);
    assert.equal(consumed.hash, '#steps');
    assert.equal(consumed.searchParams.has('start'), false);
    assert.deepEqual(
      h.events.filter(([name]) => name === 'assign'),
      [['assign', release.downloads[id].url]],
    );
    assert.equal(
      h.status.textContent,
      'Your download should start automatically.',
    );
    assert.doesNotMatch(h.status.textContent, /complete|installed|finished/i);
    await initialize(h);
    assert.equal(h.events.filter(([name]) => name === 'detect').length, 1);
    assert.equal(h.events.filter(([name]) => name === 'assign').length, 1);
    const refreshed = harness({ query: consumed.search });
    await initialize(refreshed);
    assert.equal(
      refreshed.events.some(([name]) => name === 'assign'),
      false,
    );
  }
});

test('prominent manual fallback opens the disclosure and cancels pending detection without hijacking the link', async () => {
  const h = harness({ delayed: true });
  const pending = initialize(h);
  await h.started;
  assert.equal(typeof h.listeners.fallback, 'function');
  h.listeners.fallback({
    preventDefault: () => assert.fail('keep the native fragment navigation'),
  });
  assert.equal(h.disclosure.open, true);
  h.finish();
  await pending;
  assert.equal(
    h.events.some(([name]) => name === 'assign'),
    false,
  );
  assert.match(h.status.textContent, /choose|manual/i);
  assert.doesNotMatch(h.status.textContent, /should start|started|complete/i);
});

test('absent, malformed and duplicate start flags never request a download', async () => {
  for (const query of [
    '',
    '?start',
    '?start=0',
    '?start=true',
    '?start=01',
    '?start=1%20',
    '?START=1',
    '?start=1&start=1',
    '?start=1&start=0',
  ]) {
    const h = harness({ query });
    await initialize(h);
    assert.equal(
      h.events.some(([name]) => name === 'assign'),
      false,
      query,
    );
    assert.doesNotMatch(h.status.textContent, /should start|started|complete/i);
  }
});

test('unknown, 32-bit, missing, non-Windows and denied architecture hints retain manual fallback', async () => {
  for (const options of [
    { hints: {} },
    { hints: undefined, platform: '' },
    { hints: { platform: 'Windows', architecture: 'arm', bitness: '32' } },
    { hints: { platform: 'Windows', architecture: 'unknown', bitness: '64' } },
    { platform: 'macOS' },
    { denied: true },
  ]) {
    const h = harness(options);
    await initialize(h);
    assert.equal(
      h.events.some(([name]) => name === 'assign'),
      false,
    );
    assert.match(h.status.textContent, /choose|manual/i);
    assert.doesNotMatch(h.status.textContent, /should start|started|complete/i);
  }
});

test('manual architecture choice during delayed detection cancels the automatic request', async () => {
  for (const index of [0, 1]) {
    const h = harness({ delayed: true });
    const pending = initialize(h);
    await h.started;
    await initialize(h);
    assert.equal(h.events.filter(([name]) => name === 'detect').length, 1);
    h.manual(index);
    h.finish();
    await pending;
    assert.equal(
      h.events.some(([name]) => name === 'assign'),
      false,
    );
    assert.match(h.status.textContent, /Manual download selected/);
  }
});

test('middle-clicking a manual installer also cancels a pending automatic request', async () => {
  const h = harness({ delayed: true });
  const pending = initialize(h);
  await h.started;
  h.manual(0, 'auxclick');
  h.finish();
  await pending;
  assert.equal(
    h.events.some(([name]) => name === 'assign'),
    false,
  );
});

test('initially hidden or subsequently hidden pages never silently request an installer', async () => {
  const hidden = harness({ hidden: true });
  await initialize(hidden);
  assert.equal(
    hidden.events.some(([name]) => name === 'assign'),
    false,
  );
  const h = harness({ delayed: true });
  const pending = initialize(h);
  await h.started;
  h.document.visibilityState = 'hidden';
  h.listeners.visibilitychange();
  h.document.visibilityState = 'visible';
  h.finish();
  await pending;
  assert.equal(
    h.events.some(([name]) => name === 'assign'),
    false,
  );
});

test('history failure fails closed before asynchronous detection', async () => {
  const h = harness({ historyFails: true });
  await initialize(h);
  assert.deepEqual(
    h.events.map(([name]) => name),
    ['replace'],
  );
  assert.match(h.status.textContent, /choose|manual/i);
});

test('query destinations and versions cannot replace approved release metadata', async () => {
  const h = harness({
    query:
      '?start=1&url=https://evil.example/a.exe&version=999&architecture=arm',
  });
  await initialize(h);
  assert.deepEqual(
    h.events.filter(([name]) => name === 'assign'),
    [['assign', release.downloads.windowsX64.url]],
  );
});

test('blocked initiation offers manual fallback without retries', async () => {
  const h = harness({ blocked: true });
  await initialize(h);
  await initialize(h);
  assert.equal(h.events.filter(([name]) => name === 'assign').length, 1);
  assert.match(h.status.textContent, /choose|manual/i);
});

test('static guide contains accessible original illustrated steps, truthful warnings and both no-JS downloads', () => {
  const file = new URL('../dist/download/windows/index.html', import.meta.url);
  assert.ok(existsSync(file), 'Static guide route must be built');
  const html = readFileSync(file, 'utf8');
  assert.match(html, /<h1[^>]*>Thanks for downloading Slate!<\/h1>/);
  assert.match(html, /Just a few steps left\./);
  assert.match(
    html,
    /href="#manual-installers"[^>]*data-manual-download[^>]*>\s*Didn't start\? Download manually/,
  );
  const disclosure = html.match(
    /<details\b([^>]*data-download-options[^>]*)>([\s\S]*?)<\/details>\s*<\/article>/,
  );
  assert.ok(
    disclosure,
    'All optional downloads and verification belong in the disclosure',
  );
  assert.doesNotMatch(disclosure[1], /\bopen(?:\s|=|$)/);
  assert.match(disclosure[2], /<summary[^>]*>\s*Downloads &amp; verification/);
  assert.match(disclosure[2], /id="manual-installers"/);
  assert.doesNotMatch(
    html.slice(0, html.indexOf('<details class="download-options"')),
    /Get-FileHash|hash-commands|guide-trust|guide-links|Your library is a few steps away/,
  );
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/tryslate.tech\/download\/windows\/"/,
  );
  assert.match(
    html,
    /data-download-status[^>]*role="status"[^>]*aria-live="polite"/,
  );
  assert.equal((html.match(/class="install-step"/g) ?? []).length, 4);
  assert.equal((html.match(/<figure\b/g) ?? []).length, 4);
  assert.equal(
    (html.match(/<svg\b[^>]*data-install-illustration/g) ?? []).length,
    4,
  );
  for (const artifact of [
    release.downloads.windowsX64,
    release.downloads.windowsARM64,
  ]) {
    assert.ok(disclosure[2].includes(`href="${artifact.url}"`));
    assert.ok(disclosure[2].includes(artifact.sha256));
    assert.ok(disclosure[2].includes(artifact.filename));
  }
  for (const text of [
    'Windows 11',
    'More info',
    'Run anyway',
    'Unknown Publisher',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /Check before opening|SHA256SUMS|PowerShell|Get-FileHash|Authenticode|Updater signatures|malware detection|organization|Official release|Source code|Installation help|verification-commands|guide-links/,
  );
  const steps = [
    ...html.matchAll(/<li class="install-step"[^>]*>([\s\S]*?)<\/li>/g),
  ].map((match) => match[1]);
  const protection = steps[1];
  assert.doesNotMatch(protection, /<a\b/);
  const protectionCopy = protection
    .match(/<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1]
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  assert.equal(
    protectionCopy,
    'If Windows shows a protection warning, select More info, then Run anyway only if you trust the installer.',
  );
  const extension = steps[3];
  assert.ok(extension);
  assert.match(
    extension,
    /Save useful things from your browser directly into Slate\./,
  );
  assert.match(extension, /Optional companion to Slate Desktop\./);
  const extensionLink = extension.match(/<a\b([^>]*)>\s*Get Chrome extension/);
  assert.ok(extensionLink);
  assert.ok(
    extensionLink[1].includes(`href="${release.downloads.chrome.url}"`),
  );
  assert.match(extensionLink[1], /target="_blank"/);
  assert.match(extensionLink[1], /rel="noopener noreferrer"/);
  assert.doesNotMatch(
    html,
    /<iframe|HeyClicky|Verified publisher|disable (?:Defender|SmartScreen)/i,
  );
  const source = readFileSync(
    new URL('../src/components/WindowsInstallGuide.astro', import.meta.url),
    'utf8',
  );
  assert.match(source, /@media/);
  assert.match(source, /var\(--surface\)/);
  assert.match(html, /Open the installer/);
  assert.match(html, /Windows protection/);
  assert.match(html, /Open Slate/);
  assert.match(html, /Add the Chrome extension/);
  assert.doesNotMatch(html, /<figcaption/);
});

test('only the Windows download guide omits the shared footer', () => {
  for (const route of [
    'download/windows/index.html',
    'index.html',
    'privacy/index.html',
    'support/index.html',
    '404.html',
  ]) {
    const html = readFileSync(
      new URL('../dist/' + route, import.meta.url),
      'utf8',
    );
    if (route === 'download/windows/index.html')
      assert.doesNotMatch(html, /<footer\b/);
    else assert.match(html, /<footer\b[^>]*class="site-footer"/);
    assert.match(html, /class="site-header"/);
    assert.match(html, /Star on GitHub/);
    assert.match(html, /data-theme-toggle/);
  }
});

test('each complete installation step has a quiet theme-aware card border', () => {
  const source = readFileSync(
    new URL('../src/components/WindowsInstallGuide.astro', import.meta.url),
    'utf8',
  );
  const card = source.match(/\.install-step\s*\{([^}]+)\}/)?.[1];
  assert.ok(card);
  assert.match(card, /border:\s*1px solid var\(--line\)/);
  assert.match(card, /border-radius:\s*var\(--radius-panel\)/);
  assert.match(card, /overflow:\s*hidden/);
  assert.doesNotMatch(card, /box-shadow|background|animation|transition/);
  assert.doesNotMatch(source, /\.install-step:hover/);
  assert.match(
    source,
    /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
  );
  const html = readFileSync(
    new URL('../dist/download/windows/index.html', import.meta.url),
    'utf8',
  );
  const steps = [
    ...html.matchAll(/<li class="install-step"[^>]*>([\s\S]*?)<\/li>/g),
  ];
  assert.equal(steps.length, 4);
  for (const [, content] of steps) {
    assert.match(content, /<figure\b/);
    assert.match(content, /class="step-copy"/);
    assert.match(content, /<h2\b/);
    assert.match(content, /<p\b/);
  }
  assert.match(steps[3][1], /Get Chrome extension/);
});

test('manual installer titles follow the section heading without skipping a level', () => {
  const html = readFileSync(
    new URL('../dist/download/windows/index.html', import.meta.url),
    'utf8',
  );
  assert.match(html, /<h2[^>]*>Choose your Windows installer<\/h2>/);
  for (const id of ['windowsX64', 'windowsARM64']) {
    assert.match(html, new RegExp(`<h3 id="${id}-title"`));
  }
});
