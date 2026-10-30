import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateManifestJson } from '../../../scripts/windows/validate-desktop-update-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const route = '/updates/windows/latest.json';
const publicManifest = resolve(root, 'public/updates/windows/latest.json');
const outputManifest = resolve(root, 'dist/updates/windows/latest.json');

test('the static Windows manifest is the approved signed activation candidate', async () => {
  assert.ok(existsSync(resolve(root, 'public/updates/windows/.gitkeep')));
  assert.ok(
    existsSync(publicManifest),
    'Production manifest must not be omitted',
  );
  const bytes = readFileSync(publicManifest);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    '961E9768EBECE757D74773A0690F4F283D76D5BD3F880DBF82098DFCD6730E5B',
  );
  const { release } = await import('../src/data/releases.ts');
  const text = bytes.toString('utf8');
  const contract = validateManifestJson(text, release.version);
  assert.equal(contract.version, '0.3.2');
  for (const [platform, id] of [
    ['windows-x86_64', 'windowsX64'],
    ['windows-aarch64', 'windowsARM64'],
  ]) {
    const artifact = contract.artifacts.find(
      (item) => item.platform === platform,
    );
    assert.equal(artifact.url, release.downloads[id].url);
    assert.equal(artifact.filename, release.downloads[id].filename);
  }
  assert.doesNotMatch(
    text,
    /r2\.cloudflarestorage|X-Amz-|rehearsal|disposable/i,
  );
});

test('the previous production manifest is preserved outside deploy output for recovery', () => {
  const file = resolve(
    root,
    '../../docs/releases/v0.3.1/recovery/latest-0.3.0.json',
  );
  const bytes = readFileSync(file);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    'C12D5475652AFE4269A9A826B26705A4D936EFA2A6DC893DD1EB5F7190ED0B05',
  );
  const contract = validateManifestJson(bytes.toString('utf8'), '0.3.0');
  assert.deepEqual(
    contract.artifacts.map((artifact) => artifact.platform).sort(),
    ['windows-aarch64', 'windows-x86_64'],
  );
  assert.ok(
    !existsSync(
      resolve(root, 'public/releases/v0.3.1/recovery/latest-0.3.0.json'),
    ),
  );
  assert.ok(
    !existsSync(
      resolve(root, 'dist/releases/v0.3.1/recovery/latest-0.3.0.json'),
    ),
  );
});

test('Pages scopes JSON and no-store headers to the exact permanent endpoint', () => {
  const headers = readFileSync(resolve(root, 'public/_headers'), 'utf8');
  const blocks = headers.trim().split(/\r?\n\s*\r?\n/);
  const matches = blocks.filter((block) => block.split(/\r?\n/)[0] === route);
  assert.equal(matches.length, 1);
  assert.match(
    matches[0],
    /^ {2}Content-Type: application\/json; charset=utf-8$/m,
  );
  assert.match(matches[0], /^ {2}Cache-Control: no-store$/m);
  assert.match(headers, /^ {2}X-Content-Type-Options: nosniff$/m);
  assert.doesNotMatch(matches[0], /Location:|Authorization:|Refresh:/i);
});

test('static build preserves production manifest bytes and headers', () => {
  assert.ok(existsSync(resolve(root, 'dist/404.html')));
  assert.deepEqual(
    readFileSync(resolve(root, 'dist/_headers')),
    readFileSync(resolve(root, 'public/_headers')),
  );
  assert.deepEqual(readFileSync(outputManifest), readFileSync(publicManifest));
});

test('deploy output contains only expected public static files and no rehearsal data', () => {
  const expected = new Set([
    'index.html',
    'privacy/index.html',
    'support/index.html',
    'download/windows/index.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    '_headers',
    'favicon.png',
    'favicon.ico',
    'llms.txt',
    '.well-known/security.txt',
    'brand/slate-icon.png',
    'brand/social-preview.png',
    'fonts/OFL.txt',
    'licenses/bootstrap-icons-LICENSE.txt',
    'product/README.md',
    'updates/windows/.gitkeep',
    'updates/windows/latest.json',
  ]);
  assert.deepEqual(
    readFileSync(resolve(root, 'dist/updates/windows/.gitkeep')),
    readFileSync(resolve(root, 'public/updates/windows/.gitkeep')),
  );
  for (const entry of readdirSync(resolve(root, 'dist'), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const file = resolve(entry.parentPath, entry.name);
    const relative = file
      .slice(resolve(root, 'dist').length + 1)
      .replaceAll('\\', '/');
    assert.ok(
      expected.has(relative) ||
        /^_astro\/[\w.-]+\.(?:css|js|woff2)$/.test(relative),
      'Unexpected deployment file: ' + relative,
    );
    if (/\.(?:html|json|js|css|md|txt)$/.test(relative)) {
      assert.doesNotMatch(
        readFileSync(file, 'utf8'),
        /r2\.cloudflarestorage|X-Amz-|disposable-test|SLATE_PRIVATE_REHEARSAL|-----BEGIN [\w ]*PRIVATE KEY-----|releases\/download\/v0\.1\.0/i,
        'Unexpected private or obsolete content in ' + relative,
      );
    }
  }
});
