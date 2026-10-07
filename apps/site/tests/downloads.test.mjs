import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const controller = new URL('../src/scripts/downloads.ts', import.meta.url);

test('empty copy feedback reserves no space below the fingerprint row', () => {
  const css = readFileSync(
    new URL('../src/styles/global.css', import.meta.url),
    'utf8',
  );
  const status = css.match(/\.copy-status\s*\{([^}]+)\}/)?.[1];
  assert.ok(status);
  assert.doesNotMatch(status, /min-height\s*:/);
  assert.match(css, /\.copy-status:empty\s*\{\s*margin-top:\s*0;\s*\}/);
});

function panelHarness(hash) {
  const label = { textContent: 'Copy' };
  const status = { textContent: '' };
  let click;
  const button = {
    dataset: { copyHash: hash },
    querySelector: () => label,
    closest: () => ({ querySelector: () => status }),
    addEventListener: (name, callback) => {
      assert.equal(name, 'click');
      click = callback;
    },
  };
  const cards = Object.fromEntries(
    ['windowsX64', 'windowsARM64'].map((id) => {
      const badge = { hidden: true };
      return [id, { dataset: {}, badge, querySelector: () => badge }];
    }),
  );
  const root = {
    querySelector: (selector) => cards[selector.match(/"([^"]+)"/)?.[1]],
    querySelectorAll: () => [button],
  };
  return { root, label, status, cards, click: () => click() };
}

test('copy writes the complete fingerprint, announces success and resets after two seconds', async (t) => {
  const { initializeDownloads } = await functions();
  const { release } = await import(
    new URL('../src/data/releases.ts', import.meta.url).href
  );
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const id of ['windowsX64', 'windowsARM64']) {
    const hash = release.downloads[id].sha256;
    const panel = panelHarness(hash);
    let copied;
    initializeDownloads(panel.root, {
      clipboard: {
        writeText: async (value) => {
          copied = value;
        },
      },
    });
    await panel.click();
    assert.equal(copied, hash);
    assert.equal(panel.label.textContent, 'Copied');
    assert.equal(panel.status.textContent, 'SHA-256 copied.');
    t.mock.timers.tick(2000);
    assert.equal(panel.label.textContent, 'Copy');
    assert.equal(panel.status.textContent, '');
  }
});

test('missing or denied clipboard access fails gracefully and can be retried', async () => {
  const { initializeDownloads } = await functions();
  for (const clipboard of [
    undefined,
    {
      writeText: async () => {
        throw new Error('Denied');
      },
    },
  ]) {
    const panel = panelHarness('A'.repeat(64));
    initializeDownloads(panel.root, { clipboard });
    await panel.click();
    await panel.click();
    assert.equal(panel.label.textContent, 'Copy');
    assert.match(panel.status.textContent, /Could not copy\. Expand SHA-256/);
  }
});

test('one pending clipboard write cannot launch overlapping writes', async () => {
  const { initializeDownloads } = await functions();
  const panel = panelHarness('A'.repeat(64));
  let writes = 0;
  let reject;
  initializeDownloads(panel.root, {
    clipboard: {
      writeText: () => {
        writes++;
        return new Promise((_resolve, fail) => {
          reject = fail;
        });
      },
    },
  });
  const pending = panel.click();
  await panel.click();
  assert.equal(writes, 1);
  reject(new Error('Denied'));
  await pending;
  assert.match(panel.status.textContent, /Could not copy/);
});

test('recommendation marks only the appropriate option and leaves both options intact', async () => {
  const { initializeDownloads } = await functions();
  for (const [architecture, id] of [
    ['x86', 'windowsX64'],
    ['arm', 'windowsARM64'],
    ['unknown', null],
  ]) {
    const panel = panelHarness('A'.repeat(64));
    initializeDownloads(panel.root, {
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({
          platform: 'Windows',
          architecture,
          bitness: '64',
        }),
      },
    });
    await new Promise((resolve) => queueMicrotask(resolve));
    for (const [key, card] of Object.entries(panel.cards)) {
      assert.equal(card.badge.hidden, key !== id);
      assert.equal(card.dataset.recommended, key === id ? 'true' : undefined);
    }
  }
});
async function functions() {
  assert.ok(existsSync(controller), 'Local download enhancement must exist');
  return import(controller.href);
}

test('Windows recommendations require explicit supported 64-bit architecture hints', async () => {
  const { recommendedArchitecture } = await functions();
  assert.equal(
    recommendedArchitecture({
      platform: 'Windows',
      architecture: 'x86',
      bitness: '64',
    }),
    'windowsX64',
  );
  assert.equal(
    recommendedArchitecture({
      platform: 'Windows',
      architecture: 'arm',
      bitness: '64',
    }),
    'windowsARM64',
  );
  for (const hints of [
    undefined,
    {},
    { platform: 'Windows' },
    { platform: 'Windows', architecture: 'x86' },
    { platform: 'Windows', architecture: 'arm', bitness: '32' },
    { platform: 'Windows', architecture: 'unknown', bitness: '64' },
    { platform: 'macOS', architecture: 'arm', bitness: '64' },
    { platform: 'Linux', architecture: 'x86', bitness: '64' },
  ]) {
    assert.equal(recommendedArchitecture(hints), null);
  }
});

test('detection fails closed when Client Hints are absent, withheld, rejected or non-Windows', async () => {
  const { detectArchitecture } = await functions();
  for (const browser of [
    {},
    { userAgent: 'Windows ARM64' },
    { userAgentData: { platform: 'Windows' } },
    {
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({ platform: 'Windows' }),
      },
    },
    {
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => {
          throw new Error('Denied');
        },
      },
    },
  ]) {
    assert.equal(await detectArchitecture(browser), null);
  }
  assert.equal(
    await detectArchitecture({
      userAgentData: {
        platform: 'macOS',
        getHighEntropyValues: () => {
          throw new Error('Must not query non-Windows');
        },
      },
    }),
    null,
  );
  assert.equal(
    await detectArchitecture({
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async (keys) => {
          assert.deepEqual(keys, ['architecture', 'bitness']);
          return { platform: 'Windows', architecture: 'arm', bitness: '64' };
        },
      },
    }),
    'windowsARM64',
  );
});

test('built download panel includes both architectures, public hashes and unavailable controls', () => {
  const html = readFileSync(
    new URL('../dist/index.html', import.meta.url),
    'utf8',
  );
  const section = html.match(
    /<section\b[^>]*id="download"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(section);
  for (const [id, name, hash] of [
    [
      'windowsX64',
      'Windows x64',
      'EE3A0832A002905CCBC5567401093CB1F5D6ED1D209F521B04F418D39594E5DA',
    ],
    [
      'windowsARM64',
      'Windows ARM64',
      'EDD641A2231AE846B224FCE0BAA4B7E11FCFBAA63E75D08B2F6FCD9117CFF57C',
    ],
  ]) {
    const card = section.match(
      new RegExp(
        `<article\\b[^>]*data-windows-installer="${id}"[\\s\\S]*?<\\/article>`,
      ),
    )?.[0];
    assert.ok(card, `${name} must always be rendered`);
    assert.ok(card.includes(hash));
    assert.match(card, /<button[^>]*class="button secondary"[^>]*disabled/);
    assert.match(card, new RegExp(`aria-label="Copy SHA-256 for ${name}"`));
    assert.match(card, /data-recommendation[^>]*hidden/);
  }
  assert.match(section, /For Intel &amp; AMD PCs/);
  assert.match(section, /For Snapdragon &amp; ARM PCs/);
  assert.match(section, /Chrome extension/);
  assert.doesNotMatch(
    section,
    /href="[^"]*(?:\.exe|releases\/download|chromewebstore)/,
  );
  assert.match(section, /<p class="small-note download-safety">/);
});
