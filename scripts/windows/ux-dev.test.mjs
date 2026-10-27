import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
const root = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
test('explicit debug-only UX configuration differs from production and disables upstream transport', () => {
  const file = 'apps/desktop/src-tauri/tauri.ux-dev.conf.json';
  assert.ok(
    existsSync(new URL(file, root)),
    'Dedicated UX configuration must exist',
  );
  const dev = JSON.parse(read(file));
  const prod = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
  assert.equal(dev.identifier, 'com.aiclipmemory.desktop.ux-dev');
  assert.notEqual(dev.identifier, prod.identifier);
  assert.equal(dev.productName, 'Slate UX Development');
  assert.deepEqual(dev.plugins.updater.endpoints, []);
  assert.equal(dev.plugins.updater.pubkey, '');
  assert.equal(prod.version, '0.3.2');
  assert.deepEqual(prod.plugins.updater.endpoints, [
    'https://tryslate.tech/updates/windows/latest.json',
  ]);
  assert.equal(dev.bundle.active, false);
  assert.equal(
    dev.app.windows[0].create,
    false,
    'Do not let Tauri create a default-profile main window',
  );
  assert.deepEqual(dev.app.security?.capabilities, [
    'default',
    'launcher',
    {
      identifier: 'ux-dev-identity',
      windows: ['main'],
      permissions: ['core:app:allow-name'],
    },
  ]);
  assert.ok(
    !JSON.parse(
      read('apps/desktop/src-tauri/capabilities/default.json'),
    ).permissions.includes('core:app:allow-name'),
  );
});
test('the opt-in compiles an inert updater instead of production transport and handoff', () => {
  assert.ok(
    existsSync(new URL('apps/desktop/src-tauri/src/ux_dev/updater.rs', root)),
    'Inert native updater must exist',
  );
  const source = read('apps/desktop/src-tauri/src/ux_dev/updater.rs');
  assert.doesNotMatch(
    source,
    /TauriDriver|WindowsInstall|begin_user_preparation|reqwest|\.install\(|download_and_install/,
  );
  for (const command of [
    'check_for_updates',
    'download_update',
    'restart_to_update',
  ])
    assert.ok(source.includes(command));
  const lib = read('apps/desktop/src-tauri/src/lib.rs');
  assert.match(lib, /#\[cfg\(not\(feature = "ux-dev"\)\)\]\s*pub mod updater/);
  assert.match(lib, /#\[path = "ux_dev\/updater.rs"\]/);
  assert.match(
    lib,
    /WebviewWindowBuilder::from_config\([\s\S]*?\.data_directory\(app.state::<ux_dev::Profile>\(\).webview.clone\(\)\)/,
  );
});
test('guarded launcher refuses unsafe inherited configuration and has a read-only preflight', () => {
  assert.ok(
    existsSync(new URL('scripts/windows/ux-dev.mjs', root)),
    'Guarded launch command must exist',
  );
  const source = read('scripts/windows/ux-dev.mjs');
  assert.match(source, /--preflight/);
  assert.match(source, /WEBVIEW2_/);
  assert.match(source, /TAURI_CONFIG/);
  assert.match(source, /shell: false/);
  assert.match(source, /aarch64-pc-windows-msvc/);
  assert.doesNotMatch(
    source,
    /Register-NativeMessagingHost|signer|\.private-key/,
  );
});

test('UX feature is nondefault and release compilation fails on the exact native guard', () => {
  const cargo = read('apps/desktop/src-tauri/Cargo.toml');
  assert.match(cargo, /\[features\]\s*ux-dev = \[\]/);
  assert.match(
    read('apps/desktop/src-tauri/build.rs'),
    /CARGO_FEATURE_UX_DEV[\s\S]*?PROFILE[\s\S]*?!= Ok\("debug"\)/,
  );
  const result = spawnSync(
    'rustc',
    [
      '--crate-type',
      'lib',
      '-C',
      'debug-assertions=no',
      '--out-dir',
      mkdtempSync(path.join(tmpdir(), 'slate-ux-guard-')),
      fileURLToPath(
        new URL('apps/desktop/src-tauri/src/ux_dev/guard.rs', root),
      ),
    ],
    { encoding: 'utf8', shell: false },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ux-dev is unavailable in release builds/);
});
test('backend entrypoints cannot register hosts, mutate autostart, or acquire production maintenance in dev', () => {
  const lib = read('apps/desktop/src-tauri/src/lib.rs');
  assert.match(
    lib,
    /#\[cfg\(all\(windows, not\(feature = "ux-dev"\)\)\)\]\s*let builder = builder.plugin/,
  );
  assert.match(
    lib,
    /#\[cfg\(all\(windows, not\(feature = "ux-dev"\)\)\)\]\s*let safety = SafetyCoordinator::for_current_installation/,
  );
  assert.match(
    lib,
    /#\[cfg\(any\(not\(windows\), feature = "ux-dev"\)\)\]\s*let safety = SafetyCoordinator::new/,
  );
  const windows = read('apps/desktop/src-tauri/src/platform/windows.rs');
  for (const name of ['get_autostart_enabled', 'set_autostart_enabled']) {
    const fn = windows.slice(windows.indexOf(`pub fn ${name}`));
    assert.ok(
      fn.indexOf('Autostart is disabled in UX development mode.') <
        fn.indexOf('.autolaunch()'),
    );
  }
  assert.match(
    read('apps/desktop/src-tauri/src/bin/ai-clip-memory-native-host.rs'),
    /if cfg!\(feature = "ux-dev"\)[\s\S]*?return;/,
  );
  const dev = read('apps/desktop/src-tauri/src/ux_dev/mod.rs');
  assert.doesNotMatch(
    dev,
    /RegKey|NativeMessagingHosts|InstallationGate::|for_current_user/,
  );
});
test('development Quick Search differs and neither production shortcut is registered for dev', () => {
  const source = read('apps/desktop/src-tauri/src/platform/windows.rs');
  assert.match(
    source,
    /#\[cfg\(feature = "ux-dev"\)\]\s*return Shortcut::new\([\s\S]*?Modifiers::CONTROL \| Modifiers::ALT \| Modifiers::SHIFT[\s\S]*?Code::Space/,
  );
  assert.match(
    source,
    /cfg!\(feature = "ux-dev"\) \|\| app.global_shortcut\(\).register\(capture_shortcut\(\)\)/,
  );
});
test('development frontend is behind DEV elimination and cannot supply real updater actions', () => {
  const source = read('apps/desktop/src/main.tsx');
  assert.match(
    source,
    /if \(import.meta.env.DEV && isTauri\(\)\)[\s\S]*getName\(\)\.catch\([\s\S]*Slate UX Development[\s\S]*import\('\.\/ux-dev\/UxDevApp'\)/,
  );
  const fixture = read('apps/desktop/src/ux-dev/fixtureClient.ts');
  assert.doesNotMatch(fixture, /invoke\(|fetch\(|https?:/);
  assert.match(fixture, /installationEnabled: false/);
  assert.match(fixture, /currentVersion: '0\.3\.1'/);
  assert.doesNotMatch(
    read('apps/desktop/src/ux-dev/UxDevApp.tsx'),
    /location\.reload/,
  );
});
