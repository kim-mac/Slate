import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { STABLE_ENDPOINT } from './validate-desktop-update-release.mjs';
import {
  rehearsalConfiguration,
  TEST_PUBLIC_KEY_SHA256,
} from './release-rehearsal.mjs';
import { testConfiguration } from './updater-e2e/prepare.mjs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
const productionFingerprint =
  '2641A4781B6B0004D449EE4DE626E8378A87AC89C3800A405972F0ACAA59AFC9';
const fingerprint = (key) =>
  createHash('sha256')
    .update(Buffer.from(key, 'base64'))
    .digest('hex')
    .toUpperCase();

test('bundled production trust contains the approved public envelope, distinct from TEST and fixture identities', () => {
  const key = config.plugins?.updater?.pubkey;
  assert.equal(
    typeof key,
    'string',
    'production public envelope must be configured',
  );
  assert.equal(Buffer.from(key, 'base64').toString('base64'), key);
  assert.equal(fingerprint(key), productionFingerprint);
  const lines = Buffer.from(key, 'base64')
    .toString('utf8')
    .trim()
    .split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^untrusted comment: minisign public key:/);
  assert.equal(Buffer.from(lines[1], 'base64').length, 42);
  assert.equal(Buffer.from(lines[1], 'base64').subarray(0, 2).toString(), 'Ed');
  assert.notEqual(productionFingerprint, TEST_PUBLIC_KEY_SHA256);
  assert.notEqual(
    productionFingerprint,
    fingerprint(
      JSON.parse(
        read(
          'scripts/windows/update-signature-verifier/fixtures/signatures.json',
        ),
      ).publicKey,
    ),
  );
});

test('production config has one permanent endpoint and explicit signed-version, downgrade and TLS safeguards', () => {
  assert.equal(
    STABLE_ENDPOINT,
    'https://tryslate.tech/updates/windows/latest.json',
  );
  assert.deepEqual(config.plugins?.updater?.endpoints, [STABLE_ENDPOINT]);
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  for (const flag of [
    'allowDowngrades',
    'dangerousInsecureTransportProtocol',
    'dangerousAcceptInvalidCerts',
    'dangerousAcceptInvalidHostnames',
  ]) {
    assert.equal(config.plugins.updater[flag], false, flag);
  }
  assert.equal(config.version, '0.3.2');
  assert.equal(config.bundle.windows.allowDowngrades, false);
});

test(
  'v0.3.2 release validation selects both Windows targets and preserves installer version metadata',
  { skip: process.platform !== 'win32' },
  () => {
    for (const [architecture, target] of [
      ['arm64', 'aarch64-pc-windows-msvc'],
      ['x64', 'x86_64-pc-windows-msvc'],
    ]) {
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          fileURLToPath(
            new URL('scripts/windows/Build-WindowsInstaller.ps1', root),
          ),
          '-Architecture',
          architecture,
          '-ReleaseVersion',
          '0.3.2',
          '-ValidateOnly',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 30_000 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()), {
        Version: '0.3.2',
        Target: target,
        Profile: 'release',
      });
    }
    const template = read('apps/desktop/src-tauri/windows/installer.nsi');
    for (const declaration of [
      '!define VERSION "{{version}}"',
      '!define VERSIONWITHBUILD "{{version_with_build}}"',
      'VIProductVersion "${VERSIONWITHBUILD}"',
      'VIAddVersionKey "FileVersion" "${VERSION}"',
      'VIAddVersionKey "ProductVersion" "${VERSION}"',
    ])
      assert.ok(template.includes(declaration), declaration);
  },
);

test('production enables only configured Windows installation and retains explicit main-window safety gates', () => {
  const controller = read('apps/desktop/src-tauri/src/updater/mod.rs');
  assert.match(
    controller,
    /installation_enabled: cfg!\(windows\) && driver\.configured\(\),/,
  );
  assert.doesNotMatch(
    controller,
    /SLATE_PRIVATE_REHEARSAL_|SLATE_UPDATER_E2E_/,
  );
  const restart = controller.slice(controller.indexOf('fn restart('));
  assert.ok(restart.includes('if !state.snapshot.installation_enabled'));
  assert.ok(restart.includes('begin_user_preparation()'));
  assert.ok(
    restart.indexOf('if !state.snapshot.installation_enabled') <
      restart.indexOf('begin_user_preparation()'),
  );
  assert.ok(restart.includes('state.snapshot.phase != Phase::Ready'));
  assert.ok(
    restart.includes(
      'let (Some(offer), Some(bytes)) = (&state.offer, &state.verified_bytes)',
    ),
  );
  assert.ok(restart.includes('guard.handoff(|| staged.launch())'));
  assert.match(
    read('apps/desktop/src/hooks/useUpdater.ts'),
    /!snapshot\.installationEnabled/,
  );
  assert.match(
    read('apps/desktop/src/components/UpdateNotice.tsx'),
    /!state\.installationEnabled/,
  );
  const driver = read('apps/desktop/src-tauri/src/updater/tauri_driver.rs');
  assert.match(
    driver,
    /trusted_config\(app\.config\(\)\.plugins\.0\.get\("updater"\)\)/,
  );
  assert.match(driver, /Duration::from_secs\(30\)/);
  assert.match(driver, /https_only\(true\)/);
  assert.doesNotMatch(
    driver,
    /env::|\.install\(|download_and_install|r2\.cloudflarestorage|test-public-key/,
  );
  for (const capability of ['default', 'launcher']) {
    assert.ok(
      JSON.parse(
        read(`apps/desktop/src-tauri/capabilities/${capability}.json`),
      ).permissions.every((p) => !p.startsWith('updater:')),
    );
  }
});

test('startup checks metadata only; downloads and restart remain separate explicit commands without polling', () => {
  const controller = read('apps/desktop/src-tauri/src/updater/mod.rs');
  const initialize = controller.slice(
    controller.indexOf('pub fn initialize('),
    controller.indexOf('fn require_main('),
  );
  assert.equal([...initialize.matchAll(/controller\.check\(\)/g)].length, 1);
  assert.doesNotMatch(
    initialize,
    /\.download\(|\.restart\(|\.install\(|interval\(/,
  );
  const download = controller.slice(
    controller.indexOf('pub fn download('),
    controller.indexOf('fn restart('),
  );
  assert.doesNotMatch(
    download,
    /\.restart\(|staged\.launch\(|boundary\.quit\(/,
  );
  const driver = read('apps/desktop/src-tauri/src/updater/tauri_driver.rs');
  assert.match(
    driver,
    /current\.cmp_precedence\(&release\.version\)\.is_lt\(\)/,
  );
  assert.match(driver, /update\.version != offer\.version/);
  assert.match(driver, /Error::SignedVersionMismatch/);
  assert.match(driver, /Error::MissingSignedVersion/);
});

test('historical TEST configuration helpers refuse to overwrite production trust', () => {
  const before = JSON.stringify(config);
  assert.throws(
    () =>
      rehearsalConfiguration(config, {
        version: '0.2.2',
        endpoint: 'https://example.test/updates/windows/rehearsal.json',
        testPublicKey: read(
          'scripts/windows/updater-rehearsal/test-public-key.pub',
        ).trim(),
        expectedTestPublicKeySha256: TEST_PUBLIC_KEY_SHA256,
      }),
    /unconfigured/,
  );
  assert.throws(
    // Exercise the trust guard at the helper's historical approved version,
    // rather than letting the newer source-version guard mask it.
    () =>
      testConfiguration(
        { ...config, version: '0.3.0' },
        '0.2.0',
        '../frontend',
        'PUBLIC',
      ),
    /unconfigured/,
  );
  assert.throws(() =>
    testConfiguration(config, '0.2.0', '../frontend', 'PUBLIC'),
  );
  assert.equal(JSON.stringify(config), before);
});
