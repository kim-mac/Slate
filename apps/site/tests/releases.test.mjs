import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const releaseModule = new URL('../src/data/releases.ts', import.meta.url);

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
