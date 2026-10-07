import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const releaseModule = new URL('../src/data/releases.ts', import.meta.url);

test('Windows artifact metadata is centralized and matches the frozen release', async () => {
  const { release } = await import(releaseModule.href);
  assert.equal(
    release.downloads.windowsX64.filename,
    'Slate-0.1.0-Windows-x64.exe',
  );
  assert.equal(
    release.downloads.windowsARM64.filename,
    'Slate-0.1.0-Windows-ARM64.exe',
  );
  assert.equal(
    release.downloads.windowsX64.sha256,
    'EE3A0832A002905CCBC5567401093CB1F5D6ED1D209F521B04F418D39594E5DA',
  );
  assert.equal(
    release.downloads.windowsARM64.sha256,
    'EDD641A2231AE846B224FCE0BAA4B7E11FCFBAA63E75D08B2F6FCD9117CFF57C',
  );
  assert.equal(release.extensionVersion, '0.1.1');
});

test('the site has centralized, fail-closed release destinations', async () => {
  assert.ok(
    existsSync(releaseModule),
    'Central release configuration must exist',
  );
  const { release, downloadUrl } = await import(releaseModule.href);
  assert.equal(release.version, '0.1.0');
  for (const destination of Object.values(release.downloads)) {
    assert.equal(destination.state, 'unverified');
    assert.equal(destination.url, null);
    assert.equal(downloadUrl(destination), null);
  }
});

test('only explicitly verified HTTPS destinations become links', async () => {
  assert.ok(
    existsSync(releaseModule),
    'Central release configuration must exist',
  );
  const { downloadUrl } = await import(releaseModule.href);
  assert.equal(
    downloadUrl({ state: 'unverified', url: 'https://example.test/file.exe' }),
    null,
  );
  assert.equal(downloadUrl({ state: 'verified', url: null }), null);
  assert.equal(
    downloadUrl({ state: 'verified', url: 'javascript:alert(1)' }),
    null,
  );
  assert.equal(
    downloadUrl({ state: 'verified', url: 'http://example.test/file.exe' }),
    null,
  );
  assert.equal(
    downloadUrl({ state: 'verified', url: 'https://example.test/file.exe' }),
    'https://example.test/file.exe',
  );
});

test('future macOS is represented without claiming it is available', async () => {
  assert.ok(
    existsSync(releaseModule),
    'Central release configuration must exist',
  );
  const { release, publicDownloads } = await import(releaseModule.href);
  assert.equal(release.downloads.macOSAppleSilicon.state, 'unverified');
  assert.deepEqual(
    publicDownloads.map((item) => item.id),
    ['windowsX64', 'windowsARM64', 'chrome'],
  );
});
