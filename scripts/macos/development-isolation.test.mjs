import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const read = (relative) =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const rust = 'apps/desktop/src-tauri/';

test('macOS startup requires explicit debug feature and validates before constructing windows', () => {
  const source = read(`${rust}src/lib.rs`);
  assert.match(
    source,
    /compile_error!\("macOS requires the explicit macos-dev feature/,
  );
  assert.match(
    source,
    /compile_error!\("macos-dev is restricted to macOS debug builds/,
  );
  assert.match(source, /macos_dev::validate\(context.config\(\)\)/);
  assert.ok(
    source.indexOf('macos_dev::Profile::open()') <
      source.indexOf('tauri::Builder::default()'),
  );
  assert.match(source, /data_store_identifier\(macos_dev::policy::STORE_ID\)/);
  assert.match(source, /profile.validate_data\(\)/);
});

test('macOS compiles the inert updater and a separate standalone host entry point', () => {
  const source = read(`${rust}src/lib.rs`);
  assert.ok(
    source
      .replaceAll('\r\n', '\n')
      .includes(
        '#[cfg(not(feature = "macos-dev"))]\n#[cfg(not(feature = "ux-dev"))]\npub mod updater;',
      ),
  );
  assert.ok(
    source
      .replaceAll('\r\n', '\n')
      .includes(
        '#[cfg(any(feature = "ux-dev", feature = "macos-dev"))]\n#[path = "ux_dev/updater.rs"]',
      ),
  );
  assert.match(
    read(`${rust}src/bin/ai-clip-memory-native-host.rs`),
    /#\[cfg\(feature = "macos-dev"\)\]\s*include!\("\.\.\/macos_dev\/inert_host.rs"\);/,
  );
  const guard = read(`${rust}src/macos_dev/mod.rs`);
  for (const protection of [
    'getpwuid_r',
    'geteuid',
    'O_NOFOLLOW',
    'LOCK_NB',
    'validate_data',
    'sysctlbyname',
  ])
    assert.ok(guard.includes(protection), protection);
  assert.doesNotMatch(guard, /std::env::(?:var|var_os)\("HOME"/);
});

test('development PNG preserves the existing Slate artwork for Tauri ICNS conversion', () => {
  const file = (name) =>
    readFileSync(
      fileURLToPath(new URL(`../../${rust}icons/${name}`, import.meta.url)),
    );
  const icon = file('macos-dev.png');
  const original = file('icon.ico');
  assert.equal(icon.toString('hex', 0, 8), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
  assert.ok(original.includes(icon));
});
