import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const releaseModule = new URL('../src/data/releases.ts', import.meta.url);

test('Windows artifact metadata is centralized and matches the frozen release', async () => {
  const { release } = await import(releaseModule.href);
  assert.equal(
    release.downloads.windowsX64.filename,
    'Slate-0.3.2-Windows-x64.exe',
  );
  assert.equal(
    release.downloads.windowsARM64.filename,
    'Slate-0.3.2-Windows-ARM64.exe',
  );
  assert.equal(
    release.downloads.windowsX64.sha256,
    'FAF241B4F6884994AC1C0AADAB3D2D7B2FC356C09FD2DD4945919EE4A749D327',
  );
  assert.equal(
    release.downloads.windowsARM64.sha256,
    '0B4CD2DC092DFC3E6B512B7C2A185CBED6E2CB302E3FB17C839F32A2CEB9984B',
  );
  assert.equal(release.extensionVersion, '0.1.1');
});

test('Windows activation destinations match the exact approved release assets', async () => {
  assert.ok(
    existsSync(releaseModule),
    'Central release configuration must exist',
  );
  const { release, downloadUrl } = await import(releaseModule.href);
  assert.equal(release.version, '0.3.2');
  for (const [id, filename] of [
    ['windowsX64', 'Slate-0.3.2-Windows-x64.exe'],
    ['windowsARM64', 'Slate-0.3.2-Windows-ARM64.exe'],
  ]) {
    const destination = release.downloads[id];
    const expected = `https://github.com/kim-mac/Slate/releases/download/v0.3.2/${filename}`;
    assert.equal(destination.state, 'verified');
    assert.equal(destination.url, expected);
    assert.equal(downloadUrl(destination), expected);
  }
});

test('published Chrome destination resolves to the official Slate Web Store listing', async () => {
  const { release, downloadUrl } = await import(releaseModule.href);
  const expected =
    'https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh';
  assert.equal(release.downloads.chrome.state, 'verified');
  assert.equal(release.downloads.chrome.url, expected);
  assert.equal(downloadUrl(release.downloads.chrome), expected);
  assert.equal(release.extensionVersion, '0.1.1');
});

test('unpublished macOS destination remains fail-closed', async () => {
  const { release, downloadUrl } = await import(releaseModule.href);
  const destination = release.downloads.macOSAppleSilicon;
  assert.equal(destination.state, 'unverified');
  assert.equal(destination.url, null);
  assert.equal(downloadUrl(destination), null);
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
