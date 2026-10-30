// Actual pinned Tauri bundle selection. The first NSIS directive aborts compilation:
// only rendered inputs are inspected, never a produced/installed Slate package.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const crate = path.join(root, 'apps/desktop/src-tauri');
const read = (name) => readFileSync(path.join(crate, name), 'utf8');
const cli = path.join(
  root,
  'apps/desktop/node_modules/@tauri-apps/cli/tauri.js',
);
const stop = 'SLATE_PACKAGING_CONTRACT_STOP';

test('Cargo target selection is unconditional with normal defaults and explicit macos-dev/no-default-features', () => {
  for (const features of [
    [],
    ['--no-default-features', '--features', 'macos-dev'],
  ]) {
    const result = spawnSync(
      'cargo',
      [
        'metadata',
        '--locked',
        '--offline',
        '--no-deps',
        '--format-version',
        '1',
        '--manifest-path',
        path.join(crate, 'Cargo.toml'),
        ...features,
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const pkg = JSON.parse(result.stdout).packages.find(
      (p) => p.name === 'ai-clip-memory-desktop',
    );
    assert.ok(
      pkg.targets.some(
        (t) => t.name === 'ai-clip-memory-desktop' && t.kind.includes('bin'),
      ),
    );
    const host = pkg.targets.find(
      (t) => t.name === 'ai-clip-memory-native-host',
    );
    assert.ok(host);
    assert.equal(host['required-features'], undefined);
    assert.equal(pkg.features.default, undefined);
    assert.equal(pkg.features['native-host'], undefined);
    assert.deepEqual(pkg.features['macos-dev'], []);
  }
});

test(
  'pinned Tauri Windows selection renders native host and its exact maintenance alias without host feature flags',
  {
    skip: process.platform !== 'win32',
    timeout: 120000,
  },
  () => {
    for (const name of Object.keys(process.env))
      assert.ok(
        !/^(TAURI_CONFIG|TAURI_SIGNING_PRIVATE_KEY.*|APPLE_CERTIFICATE.*|APPLE_SIGNING_IDENTITY)$/.test(
          name,
        ),
        'Signing/configuration overrides forbidden',
      );
    assert.equal(
      JSON.parse(
        readFileSync(path.join(path.dirname(cli), 'package.json'), 'utf8'),
      ).version,
      '2.12.2',
    );
    const version = spawnSync(process.execPath, [cli, '--version'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^tauri-cli 2\.12\.2\s*$/);
    const baseline = spawnSync(
      'git',
      [
        'show',
        'abd997637dedf0955afa15fe68114eba8154ea56:apps/desktop/src-tauri/windows/installer.nsi',
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(baseline.status, 0);
    assert.equal(
      read('windows/installer.nsi').replaceAll('\r\n', '\n'),
      baseline.stdout.replaceAll('\r\n', '\n'),
    );
    const manifest = read('Cargo.toml');
    const features = manifest.match(/\[features\]([\s\S]*?)(?=\n\[)/)[0];
    const hostTarget = manifest.match(/\[\[bin\]\][\s\S]*?(?=\n\[|$)/)[0];
    const oldManifest = spawnSync(
      'git',
      [
        'show',
        'abd997637dedf0955afa15fe68114eba8154ea56:apps/desktop/src-tauri/Cargo.toml',
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(oldManifest.status, 0);
    assert.equal(
      hostTarget.trim(),
      oldManifest.stdout.match(/\[\[bin\]\][\s\S]*?(?=\n\[|$)/)[0].trim(),
      'Restore the exact shipped binary target',
    );
    const oldEntry = spawnSync(
      'git',
      [
        'show',
        'abd997637dedf0955afa15fe68114eba8154ea56:apps/desktop/src-tauri/src/bin/ai-clip-memory-native-host.rs',
      ],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(oldEntry.status, 0);
    const windowsEntry = read('src/bin/ai-clip-memory-native-host.rs')
      .replaceAll('\r\n', '\n')
      .replace(
        /^#\[cfg\(feature = "macos-dev"\)\]\ninclude!\("\.\.\/macos_dev\/inert_host.rs"\);\n\n/,
        '',
      )
      .replaceAll('#[cfg(not(feature = "macos-dev"))]\n', '')
      .replace(
        '#[cfg(all(windows, not(feature = "macos-dev")))]',
        '#[cfg(windows)]',
      );
    assert.equal(
      windowsEntry,
      oldEntry.stdout.replaceAll('\r\n', '\n'),
      'Windows host implementation must remain byte-identical after removing Mac cfg attributes',
    );
    const parent = path.join(root, 'dist/test/macos-m1');
    mkdirSync(parent, { recursive: true });
    const output = mkdtempSync(path.join(parent, 'packaging-contract-'));
    const run = (command, args, cwd, env = {}) =>
      spawnSync(command, args, {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
    const proof = [];
    for (const target of [
      'aarch64-pc-windows-msvc',
      'x86_64-pc-windows-msvc',
    ]) {
      const fixture = path.join(output, target);
      const tauri = path.join(fixture, 'src-tauri');
      mkdirSync(path.join(tauri, 'src/bin'), { recursive: true });
      writeFileSync(
        path.join(fixture, 'package.json'),
        JSON.stringify({
          name: 'slate-packaging-contract',
          version: '0.3.1',
          private: true,
        }),
      );
      writeFileSync(
        path.join(tauri, 'Cargo.toml'),
        `[package]\nname="ai-clip-memory-desktop"\nversion="0.3.1"\nedition="2021"\ndefault-run="ai-clip-memory-desktop"\n${features}\n${hostTarget}\n[dependencies]\ntauri={version="=2.12.3",features=[]}\n`,
      );
      const stub = '#![windows_subsystem = "windows"]\nfn main() {}\n';
      writeFileSync(path.join(tauri, 'src/main.rs'), stub);
      writeFileSync(
        path.join(tauri, 'src/bin/ai-clip-memory-native-host.rs'),
        stub,
      );
      const cargoTarget = path.join(fixture, 'target');
      const binaries = path.join(cargoTarget, target, 'debug');
      mkdirSync(binaries, { recursive: true });
      const main = path.join(binaries, 'ai-clip-memory-desktop.exe');
      const compiled = run(
        'rustc',
        [
          '--edition=2021',
          '--target',
          target,
          '-C',
          'debuginfo=0',
          path.join(tauri, 'src/main.rs'),
          '-o',
          main,
        ],
        fixture,
      );
      assert.equal(compiled.status, 0, compiled.stderr);
      copyFileSync(main, path.join(binaries, 'ai-clip-memory-native-host.exe'));
      copyFileSync(
        path.join(crate, 'icons/icon.ico'),
        path.join(tauri, 'icon.ico'),
      );
      writeFileSync(
        path.join(tauri, 'diagnostic.nsi'),
        `!error "${stop}"\n${baseline.stdout}`,
      );
      writeFileSync(
        path.join(tauri, 'tauri.conf.json'),
        JSON.stringify({
          productName: 'Slate Packaging Contract Fixture',
          version: '0.3.1',
          identifier: 'com.aiclipmemory.packaging-contract',
          bundle: {
            active: true,
            targets: ['nsis'],
            icon: ['icon.ico'],
            windows: {
              webviewInstallMode: { type: 'skip' },
              nsis: { installMode: 'currentUser', template: 'diagnostic.nsi' },
            },
          },
        }),
      );
      // Like normal tauri build, select custom-protocol, never native-host.
      const bundled = run(
        process.execPath,
        [
          cli,
          'bundle',
          '--debug',
          '--target',
          target,
          '--bundles',
          'nsis',
          '--features',
          'tauri/custom-protocol',
        ],
        fixture,
        { CARGO_TARGET_DIR: cargoTarget, CARGO_NET_OFFLINE: 'true' },
      );
      const log = bundled.stdout + bundled.stderr;
      writeFileSync(path.join(fixture, 'bundle.log'), log);
      assert.notEqual(
        bundled.status,
        0,
        'Diagnostic compiler must stop without producing an installer',
      );
      assert.ok(
        log.includes(stop),
        `Did not reach intentional NSIS stop: ${log}`,
      );
      const walk = (dir) =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? walk(path.join(dir, e.name))
            : [path.join(dir, e.name)],
        );
      const entries = walk(path.join(binaries, 'bundle'));
      assert.ok(
        !entries.some((p) => p.endsWith('.exe')),
        'No installer/uninstaller may be emitted',
      );
      const input = walk(path.join(binaries, 'nsis')).find((p) =>
        p.endsWith('.nsi'),
      );
      assert.ok(input, 'Rendered NSIS inputs required');
      const rendered = readFileSync(input, 'utf8');
      const native = rendered.match(
        /File \/a "\/oname=ai-clip-memory-native-host\.exe" "([^"\r\n]+)"/,
      );
      const alias = rendered.match(
        /File \/oname=slate-maintenance-host\.exe "([^"\r\n]+)"/,
      );
      assert.ok(native, `${target}: pinned selector omitted native host`);
      assert.ok(alias, `${target}: maintenance alias missing`);
      assert.equal(
        path.resolve(native[1]),
        path.resolve(alias[1]),
        'Alias must embed the same selected host bytes',
      );
      assert.equal(
        path.resolve(native[1]),
        path.join(binaries, 'ai-clip-memory-native-host.exe'),
      );
      proof.push({
        target,
        nativeHostSelected: true,
        maintenanceAliasFromSameHost: true,
        installerGenerated: false,
      });
    }
    writeFileSync(
      path.join(output, 'receipt.json'),
      JSON.stringify({ cli: '2.12.2', proof }, null, 2),
    );
  },
);
