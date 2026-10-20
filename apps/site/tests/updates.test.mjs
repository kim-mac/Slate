import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateManifestJson } from '../../../scripts/windows/validate-desktop-update-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const route = '/updates/windows/latest.json';
const publicManifest = resolve(root, 'public/updates/windows/latest.json');
const outputManifest = resolve(root, 'dist/updates/windows/latest.json');

test('the static Windows manifest directory survives Git without a fake update', () => {
  assert.ok(existsSync(resolve(root, 'public/updates/windows/.gitkeep')));
  // Absence is intentional until final, signed production artifacts are approved.
  // A later real manifest must continue satisfying the existing strict contract.
  if (existsSync(publicManifest)) {
    const text = readFileSync(publicManifest, 'utf8');
    const expectedVersion = JSON.parse(
      readFileSync(resolve(root, '../../package.json'), 'utf8'),
    ).version;
    validateManifestJson(text, expectedVersion);
  }
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

test('static build preserves manifest headers and works before manifest insertion', () => {
  assert.ok(existsSync(resolve(root, 'dist/404.html')));
  assert.deepEqual(
    readFileSync(resolve(root, 'dist/_headers')),
    readFileSync(resolve(root, 'public/_headers')),
  );
  if (existsSync(publicManifest)) {
    assert.deepEqual(
      readFileSync(outputManifest),
      readFileSync(publicManifest),
    );
  } else {
    assert.equal(existsSync(outputManifest), false);
  }
});
