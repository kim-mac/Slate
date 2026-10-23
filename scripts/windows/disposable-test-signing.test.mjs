import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { before, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { buildVerifier } from './build-update-signature-verifier.mjs';

const worktree = fileURLToPath(new URL('../../', import.meta.url));
const toolUrl = new URL('./disposable-test-signing.mjs', import.meta.url);
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      './update-signature-verifier/fixtures/signatures.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
let verifier;
before(() => {
  verifier = buildVerifier().executable;
});

function sandbox(t) {
  const parent = join(worktree, 'dist/test');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'disposable-signing-unit-'));
  t.after(() => {
    assert.ok(!relative(parent, directory).startsWith('..'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

async function prepared(t) {
  const module = await import(toolUrl.href);
  const root = sandbox(t);
  const directory = module.prepare(root);
  return { module, root, directory };
}

function signed(directory) {
  // Existing public known-answer fixtures only: no signing or key generation.
  writeFileSync(join(directory, 'disposable-test.key.pub'), fixtures.publicKey);
  for (const name of ['x64', 'arm64']) {
    writeFileSync(
      join(directory, `synthetic-${name}.txt.sig`),
      fixtures.cases[name].signature,
    );
  }
}

test('test-only ceremony tooling exists separately from production', () => {
  assert.ok(existsSync(toolUrl), 'Missing disposable test-signing workflow');
});

test('verifier launch failures retain only safe actionable OS codes', async () => {
  const module = await import(toolUrl.href);
  assert.equal(typeof module.assertVerifierStarted, 'function');
  for (const [result, expected] of [
    [
      {
        error: { code: 'ENOENT', message: 'NEVER-ECHO-SENTINEL' },
        status: null,
      },
      /ENOENT/,
    ],
    [{ error: { code: 'EACCES' }, status: null }, /EACCES/],
    [{ error: { code: 'ETIMEDOUT' }, status: null }, /ETIMEDOUT/],
    [{ error: { code: 'NEVER-ECHO-SENTINEL' }, status: null }, /UNKNOWN/],
    [{ signal: 'SIGTERM', status: null }, /SIGNAL/],
    [{ status: -1073741511 }, /0xC0000139/],
  ]) {
    assert.throws(
      () => module.assertVerifierStarted(result),
      (error) =>
        expected.test(error.message) && !error.message.includes('NEVER-ECHO'),
    );
  }
  assert.doesNotThrow(() => module.assertVerifierStarted({ status: 0 }));
  assert.doesNotThrow(() => module.assertVerifierStarted({ status: 1 }));
});

test('prepare creates only ignored synthetic text and metadata, never keys or manifests', async (t) => {
  const { module, root, directory } = await prepared(t);
  assert.equal(directory, join(root, 'dist/test/updater-disposable-signing'));
  assert.equal(module.TEST_VERSION, '0.2.0');
  for (const name of ['x64', 'arm64']) {
    assert.equal(
      readFileSync(join(directory, `synthetic-${name}.txt`), 'utf8'),
      fixtures.cases[name].artifact,
    );
  }
  for (const name of [
    'disposable-test.key',
    'disposable-test.key.pub',
    'stable.json',
  ]) {
    assert.equal(existsSync(join(directory, name)), false);
  }
  assert.equal(readFileSync(join(directory, '.gitignore'), 'utf8'), '*\n');
  assert.throws(() => module.prepare(root), /already exists/);
});

test('rejects credential/CI environment without exposing values', async () => {
  const { assertCleanEnvironment } = await import(toolUrl.href);
  for (const name of [
    'CI',
    'TAURI_SIGNING_PRIVATE_KEY',
    'TAURI_SIGNING_PRIVATE_KEY_PATH',
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'TAURI_PRIVATE_KEY',
    'TAURI_PRIVATE_KEY_PATH',
    'TAURI_PRIVATE_KEY_PASSWORD',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'NODE_OPTIONS',
  ]) {
    assert.throws(
      () => assertCleanEnvironment({ [name]: 'NEVER-ECHO-SENTINEL' }),
      (error) =>
        /environment/.test(error.message) &&
        !error.message.includes('NEVER-ECHO'),
    );
  }
  assert.doesNotThrow(() => assertCleanEnvironment({ PATH: 'ordinary' }));
});

test('rejects linked destination parents without traversing or writing to them', async (t) => {
  const { prepare } = await import(toolUrl.href);
  const root = sandbox(t);
  const outside = join(root, 'other');
  mkdirSync(outside);
  symlinkSync(
    outside,
    join(root, 'dist'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => prepare(root), /link|redirect/);
  assert.equal(existsSync(join(outside, 'test')), false);
});

test('both synthetic architecture labels pass Gate A1 and all four negative cases fail', async (t) => {
  const { module, directory } = await prepared(t);
  signed(directory);
  const sentinel = join(directory, 'disposable-test.key');
  writeFileSync(sentinel, 'SYNTHETIC PRIVATE-FILE SENTINEL: do not read');
  const report = module.verify(directory, verifier);
  assert.equal(report.testOnly, true);
  assert.equal(report.installationEnabled, false);
  assert.equal(report.checks.length, 10);
  assert.ok(report.checks.every((item) => item.passed));
  assert.equal(
    readFileSync(sentinel, 'utf8'),
    'SYNTHETIC PRIVATE-FILE SENTINEL: do not read',
  );
  assert.throws(() => module.verify(directory, verifier), /already exists/);
});

for (const failure of [
  'unsigned',
  'tampered',
  'wrong version',
  'wrong key',
  'corrupt signature',
]) {
  test(`ceremony aborts rather than reporting success for ${failure} baseline`, async (t) => {
    const { module, directory } = await prepared(t);
    if (failure !== 'unsigned') signed(directory);
    if (failure === 'tampered')
      writeFileSync(join(directory, 'synthetic-x64.txt'), 'unexpected');
    if (failure === 'wrong version')
      writeFileSync(
        join(directory, 'synthetic-x64.txt.sig'),
        fixtures.cases.otherVersion.signature,
      );
    if (failure === 'corrupt signature')
      writeFileSync(join(directory, 'synthetic-x64.txt.sig'), 'invalid');
    if (failure === 'wrong key') {
      writeFileSync(
        join(directory, 'disposable-test.key.pub'),
        module.wrongPublicKey(fixtures.publicKey),
      );
    }
    assert.throws(() => module.verify(directory, verifier));
  });
}

test('rejects changed policy metadata, linked public input and unknown files', async (t) => {
  const { module, directory } = await prepared(t);
  signed(directory);
  writeFileSync(join(directory, 'stable.json'), '{}');
  assert.throws(() => module.verify(directory, verifier), /unexpected/i);
  rmSync(join(directory, 'stable.json'));
  writeFileSync(join(directory, 'TEST-ONLY.json'), '{}');
  assert.throws(() => module.verify(directory, verifier), /policy/);
});

test('public-key symlink is rejected, not read', async (t) => {
  const { module, directory } = await prepared(t);
  signed(directory);
  const path = join(directory, 'disposable-test.key.pub');
  rmSync(path);
  symlinkSync(
    directory,
    path,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => module.verify(directory, verifier), /link|regular/i);
});

test('CLI exposes only preflight, prepare and verify; unknown/generation/sign/install options fail', () => {
  for (const args of [
    [],
    ['generate'],
    ['sign'],
    ['install'],
    ['prepare', '--private-key', 'NEVER-ECHO-SENTINEL'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(toolUrl), ...args],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('NEVER-ECHO-SENTINEL'));
  }
});

test('environment is Git-ignored and not a production build/staging dependency', () => {
  const result = spawnSync(
    'git',
    [
      '-C',
      worktree,
      'check-ignore',
      '--no-index',
      'dist/test/updater-disposable-signing/disposable-test.key',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0);
  for (const path of [
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/build.rs',
    'apps/desktop/src-tauri/Cargo.toml',
    'scripts/windows/Build-WindowsInstaller.ps1',
    'scripts/windows/Stage-WindowsRelease.ps1',
    'package.json',
    'apps/desktop/package.json',
  ]) {
    assert.doesNotMatch(
      readFileSync(resolve(worktree, path), 'utf8'),
      /updater-disposable-signing|disposable-test\.key|disposable-test-signing/,
    );
  }
});
