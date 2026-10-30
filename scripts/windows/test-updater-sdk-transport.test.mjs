import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const runner = new URL('./test-updater-sdk-transport.mjs', import.meta.url);
const crate = new URL('./updater-sdk-transport/', import.meta.url);

test('a separate headless transport harness exists', () => {
  assert.ok(existsSync(runner), 'Missing test-only HTTPS runner');
  assert.ok(existsSync(new URL('src/main.rs', crate)), 'Missing SDK harness');
});

test('source guard rejects installer calls and payload execution/file writes', async () => {
  const { assertSafeRustSource } = await import(runner.href);
  for (const forbidden of [
    'update.install(bytes)',
    'update . install (bytes)',
    'Update::install(&update, bytes)',
    'update.download_and_install(callback, done)',
    'std::process::Command::new(path)',
    'std::fs::write(path, bytes)',
    'File::create(path)',
    'OpenOptions::new()',
    'include!("other.rs")',
  ]) {
    assert.throws(() => assertSafeRustSource(forbidden));
  }
  assert.doesNotThrow(() =>
    assertSafeRustSource('update.download(chunk, done).await'),
  );
  assertSafeRustSource(readFileSync(new URL('src/main.rs', crate), 'utf8'));
});

test('harness dependencies pin the actual SDK and exclude the desktop runtime', () => {
  const cargo = readFileSync(new URL('Cargo.toml', crate), 'utf8');
  assert.match(
    cargo,
    /tauri = \{ version = "=2\.12\.3", default-features = false, features = \["test"\] \}/,
  );
  assert.match(
    cargo,
    /tauri-plugin-updater = \{ version = "=2\.13\.3", default-features = false, features = \["native-tls", "zip", "system-proxy"\] \}/,
  );
  assert.doesNotMatch(cargo, /\bwry\b|ai-clip-memory|path\s*=/);
  const rust = readFileSync(new URL('src/main.rs', crate), 'utf8');
  assert.match(rust, /mock_builder/);
  assert.match(rust, /requireSignedVersion"\s*:\s*true/);
  assert.match(rust, /tls_certs_only/);
  assert.match(rust, /https_only\(true\)/);
  assert.match(rust, /Abortable/);
});

test('test endpoint policy rejects non-loopback, credentials and other origins', async () => {
  const { assertTestUrl } = await import(runner.href);
  const origin = 'https://127.0.0.1:43210';
  assert.doesNotThrow(() =>
    assertTestUrl(`${origin}/slate-sdk-test/case/manifest.json`, origin),
  );
  for (const url of [
    'https://tryslate.tech/updates/windows/latest.json',
    'https://github.com/kim-mac/Slate/releases/download/v0.2.0/file.exe',
    'http://127.0.0.1:43210/slate-sdk-test/case/manifest.json',
    'https://localhost:43210/slate-sdk-test/case/manifest.json',
    'https://user@127.0.0.1:43210/slate-sdk-test/case/manifest.json',
    'https://127.0.0.1:43211/slate-sdk-test/case/manifest.json',
    `${origin}/unexpected`,
    `${origin}/slate-sdk-test/case/manifest.json?secret=1`,
  ])
    assert.throws(() => assertTestUrl(url, origin));
});

test('production release contract rejects loopback URLs and synthetic artifact names', async () => {
  const { validateManifestJson } =
    await import('./validate-desktop-update-release.mjs');
  const known = JSON.parse(
    readFileSync(
      new URL(
        './update-signature-verifier/fixtures/signatures.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  function manifest(urlFor) {
    return JSON.stringify({
      version: '0.2.0',
      platforms: Object.fromEntries(
        [
          ['windows-x86_64', 'x64', 'x64'],
          ['windows-aarch64', 'ARM64', 'arm64'],
        ].map(([platform, name, fixture]) => [
          platform,
          { url: urlFor(name), signature: known.cases[fixture].signature },
        ]),
      ),
    });
  }
  assert.throws(() =>
    validateManifestJson(
      manifest(
        (name) => `https://127.0.0.1:43210/Slate-0.2.0-Windows-${name}.exe`,
      ),
      '0.2.0',
    ),
  );
  assert.throws(() =>
    validateManifestJson(
      manifest(
        (name) =>
          `https://github.com/kim-mac/Slate/releases/download/v0.2.0/synthetic-${name}.txt`,
      ),
      '0.2.0',
    ),
  );
});

test('production configuration and build entry points do not import the harness', () => {
  for (const path of [
    '../../apps/desktop/src-tauri/tauri.conf.json',
    '../../apps/desktop/src-tauri/Cargo.toml',
    '../../apps/desktop/src-tauri/src/lib.rs',
    '../../apps/desktop/src-tauri/build.rs',
    './Build-WindowsInstaller.ps1',
    './Stage-WindowsRelease.ps1',
  ]) {
    assert.doesNotMatch(
      readFileSync(new URL(path, import.meta.url), 'utf8'),
      /updater-sdk-transport|slate-sdk-transport-test/,
    );
  }
});
