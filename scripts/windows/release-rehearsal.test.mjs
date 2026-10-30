import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const api = await import('./release-rehearsal.mjs').catch(() => ({}));
const productionSource = JSON.parse(
  read('apps/desktop/src-tauri/tauri.conf.json'),
);
// Historical TEST-only input. Real production trust must never be overwritten.
const source = JSON.parse(JSON.stringify(productionSource));
delete source.plugins.updater;
const publicKey = read(
  'scripts/windows/updater-rehearsal/test-public-key.pub',
).trim();
const fingerprint = createHash('sha256')
  .update(Buffer.from(publicKey, 'base64'))
  .digest('hex')
  .toUpperCase();
const options = (version = '0.2.2') => ({
  version,
  endpoint: 'https://updates.example.test/updates/windows/rehearsal.json',
  testPublicKey: publicKey,
  expectedTestPublicKeySha256: fingerprint,
});

test('rehearsal configuration preserves identity, installer safeguards and normal frontend build', () => {
  assert.equal(typeof api.rehearsalConfiguration, 'function');
  const before = JSON.stringify(source);
  for (const version of ['0.2.2', '0.2.3']) {
    const config = api.rehearsalConfiguration(source, options(version));
    assert.equal(config.version, version);
    assert.equal(config.identifier, source.identifier);
    assert.equal(config.productName, source.productName);
    assert.deepEqual(config.app, source.app);
    assert.deepEqual(config.build, source.build);
    assert.deepEqual(config.bundle.windows.nsis, source.bundle.windows.nsis);
    assert.equal(config.bundle.windows.allowDowngrades, false);
    assert.deepEqual(config.bundle.windows.webviewInstallMode, {
      type: 'skip',
    });
    assert.equal(config.bundle.createUpdaterArtifacts, false);
    assert.deepEqual(config.plugins.updater, {
      endpoints: [options().endpoint],
      pubkey: publicKey,
      requireSignedVersion: true,
      allowDowngrades: false,
      dangerousInsecureTransportProtocol: false,
      dangerousAcceptInvalidCerts: false,
      dangerousAcceptInvalidHostnames: false,
    });
  }
  assert.equal(JSON.stringify(source), before);
});

test('both rehearsal versions map x64 and ARM64 to the existing signed NSIS contract', () => {
  assert.equal(typeof api.rehearsalArtifacts, 'function');
  for (const version of ['0.2.2', '0.2.3']) {
    assert.deepEqual(api.rehearsalArtifacts(version), [
      {
        platform: 'windows-x86_64',
        target: 'x86_64-pc-windows-msvc',
        installer: `Slate-${version}-Windows-x64.exe`,
        signature: `Slate-${version}-Windows-x64.exe.sig`,
      },
      {
        platform: 'windows-aarch64',
        target: 'aarch64-pc-windows-msvc',
        installer: `Slate-${version}-Windows-ARM64.exe`,
        signature: `Slate-${version}-Windows-ARM64.exe.sig`,
      },
    ]);
  }
});

for (const version of [
  '0.2.0',
  '0.2.1',
  '0.2.4',
  'v0.2.2',
  '0.2.2-test',
  '0.2.2+test',
  undefined,
]) {
  test(`refuses unapproved rehearsal version ${version}`, () => {
    assert.equal(typeof api.rehearsalConfiguration, 'function');
    assert.throws(
      () => api.rehearsalConfiguration(source, { ...options(), version }),
      /version/,
    );
  });
}

for (const endpoint of [
  undefined,
  'http://updates.example.test/updates/windows/rehearsal.json',
  'https://tryslate.tech/updates/windows/latest.json',
  'https://updates.example.test/latest.json',
  'https://localhost/updates/windows/rehearsal.json',
  'https://127.0.0.1/updates/windows/rehearsal.json',
  'https://[::1]/updates/windows/rehearsal.json',
  'https://user:secret@updates.example.test/updates/windows/rehearsal.json',
  'https://updates.example.test/updates/windows/rehearsal.json#fragment',
  'https://updates.example.test/a/../updates/windows/rehearsal.json',
]) {
  test(`refuses unsafe or non-rehearsal endpoint ${endpoint?.split('@').at(-1)}`, () => {
    assert.equal(typeof api.rehearsalConfiguration, 'function');
    assert.throws(
      () => api.rehearsalConfiguration(source, { ...options(), endpoint }),
      /endpoint/,
    );
  });
}

test('allows an explicit temporary bearer URL without networking or logging it', () => {
  assert.equal(typeof api.rehearsalConfiguration, 'function');
  const endpoint = `${options().endpoint}?synthetic-test-only=expiry`;
  assert.deepEqual(
    api.rehearsalConfiguration(source, { ...options(), endpoint }).plugins
      .updater.endpoints,
    [endpoint],
  );
});

test('requires a public-key envelope and an independently supplied matching fingerprint', () => {
  assert.equal(typeof api.rehearsalConfiguration, 'function');
  for (const change of [
    { testPublicKey: '' },
    { testPublicKey: 'PRIVATE KEY' },
    { testPublicKey: Buffer.from('not a public key').toString('base64') },
    { expectedTestPublicKeySha256: undefined },
    { expectedTestPublicKeySha256: '0'.repeat(64) },
    { privateKey: 'must not be accepted' },
  ])
    assert.throws(() =>
      api.rehearsalConfiguration(source, { ...options(), ...change }),
    );
});

test('refuses changed identity or weakened installer defaults', () => {
  assert.equal(typeof api.rehearsalConfiguration, 'function');
  for (const change of [
    { identifier: 'different.identity' },
    { productName: 'Different' },
    { bundle: { ...source.bundle, targets: ['msi'] } },
    {
      bundle: {
        ...source.bundle,
        windows: { ...source.bundle.windows, allowDowngrades: true },
      },
    },
    {
      bundle: {
        ...source.bundle,
        windows: {
          ...source.bundle.windows,
          nsis: { ...source.bundle.windows.nsis, installMode: 'perMachine' },
        },
      },
    },
    {
      plugins: { updater: { endpoints: ['https://example.test/stable.json'] } },
    },
  ])
    assert.throws(() =>
      api.rehearsalConfiguration({ ...source, ...change }, options()),
    );
});

test('default updater and GUI release configuration remain unchanged', () => {
  assert.deepEqual(productionSource.plugins.updater.endpoints, [
    'https://tryslate.tech/updates/windows/latest.json',
  ]);
  assert.throws(
    () => api.rehearsalConfiguration(productionSource, options()),
    /unconfigured/,
  );
  assert.match(
    read('apps/desktop/src-tauri/src/updater/mod.rs'),
    /installation_enabled: cfg!\(windows\) && driver\.configured\(\),/,
  );
  assert.match(
    read('apps/desktop/src-tauri/src/main.rs'),
    /cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)/,
  );
  const implementation = read('scripts/windows/release-rehearsal.mjs');
  for (const forbidden of [
    'child_process',
    'node:https',
    'fetch(',
    'writeFile',
    'installation_enabled: true',
  ])
    assert.ok(!implementation.includes(forbidden));
});

function fixture(version = '0.2.2') {
  const parent = join(root, 'dist/test/updater-release-rehearsal');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'contract-'));
  mkdirSync(join(directory, 'scripts/windows'), { recursive: true });
  mkdirSync(join(directory, 'apps/desktop/src-tauri'), { recursive: true });
  for (const name of [
    'Build-WindowsInstaller.ps1',
    'Stage-WindowsRelease.ps1',
    'Write-ReleaseChecksums.ps1',
    'Windows-ReleaseContract.ps1',
  ]) {
    if (existsSync(join(root, 'scripts/windows', name)))
      copyFileSync(
        join(root, 'scripts/windows', name),
        join(directory, 'scripts/windows', name),
      );
  }
  for (const name of [
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
  ])
    writeFileSync(join(directory, name), JSON.stringify({ version }));
  writeFileSync(
    join(directory, 'apps/desktop/src-tauri/Cargo.toml'),
    `[package]\nname = "ai-clip-memory-desktop"\nversion = "${version}"\n`,
  );
  writeFileSync(
    join(directory, 'apps/desktop/src-tauri/Cargo.lock'),
    `version = 4\n[[package]]\nname = "ai-clip-memory-desktop"\nversion = "${version}"\n`,
  );
  return directory;
}
function powershell(directory, script, args) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'scripts/windows', script),
      ...args,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 15000 },
  );
  assert.ifError(result.error);
  return result;
}

test(
  'build validation accepts explicit consistent candidate versions for both architectures without writes',
  { skip: process.platform !== 'win32' },
  () => {
    for (const version of ['0.1.0', '0.2.2', '0.2.3', '0.3.0'])
      for (const architecture of ['x64', 'arm64']) {
        const directory = fixture(version);
        const result = powershell(directory, 'Build-WindowsInstaller.ps1', [
          '-Architecture',
          architecture,
          '-ReleaseVersion',
          version,
          '-ValidateOnly',
        ]);
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.equal(report.Version, version);
        assert.equal(
          report.Target,
          architecture === 'x64'
            ? 'x86_64-pc-windows-msvc'
            : 'aarch64-pc-windows-msvc',
        );
        assert.equal(report.Profile, 'release');
        assert.equal(
          existsSync(
            join(directory, 'apps/desktop/src-tauri/windows/generated'),
          ),
          false,
        );
      }
  },
);

test(
  'build validation rejects malformed, mismatched and lockfile versions before writing',
  { skip: process.platform !== 'win32' },
  () => {
    for (const version of [
      '0.2.3',
      'v0.2.2',
      '0.2.2-test',
      '01.2.2',
      '65536.0.0',
    ]) {
      const directory = fixture();
      const result = powershell(directory, 'Build-WindowsInstaller.ps1', [
        '-Architecture',
        'arm64',
        '-ReleaseVersion',
        version,
        '-ValidateOnly',
      ]);
      assert.notEqual(result.status, 0);
      assert.equal(
        existsSync(join(directory, 'apps/desktop/src-tauri/windows/generated')),
        false,
      );
    }
    for (const file of [
      'package.json',
      'apps/desktop/package.json',
      'apps/desktop/src-tauri/tauri.conf.json',
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
    ]) {
      const directory = fixture();
      writeFileSync(
        join(directory, file),
        readFileSync(join(directory, file), 'utf8').replaceAll(
          '0.2.2',
          '0.2.3',
        ),
      );
      const result = powershell(directory, 'Build-WindowsInstaller.ps1', [
        '-Architecture',
        'x64',
        '-ReleaseVersion',
        '0.2.2',
        '-ValidateOnly',
      ]);
      assert.notEqual(result.status, 0, file);
    }
  },
);

test(
  'staging labels both candidates, refuses overwrite and preserves a frozen release destination',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = fixture();
    const x64 = join(directory, 'AI Clip Memory_0.2.2_x64-setup.exe');
    const arm = join(directory, 'AI Clip Memory_0.2.2_arm64-setup.exe');
    writeFileSync(x64, 'synthetic x64; not executable');
    writeFileSync(arm, 'synthetic ARM64; not executable');
    const output = join(directory, 'staged');
    const args = [
      '-ReleaseVersion',
      '0.2.2',
      '-X64InstallerPath',
      x64,
      '-Arm64InstallerPath',
      arm,
      '-OutputDirectory',
      output,
    ];
    const result = powershell(directory, 'Stage-WindowsRelease.ps1', args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(output, 'Slate-0.2.2-Windows-x64.exe'), 'utf8'),
      'synthetic x64; not executable',
    );
    assert.equal(
      readFileSync(join(output, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')
        .length,
      2,
    );
    assert.notEqual(
      powershell(directory, 'Stage-WindowsRelease.ps1', args).status,
      0,
    );
    assert.notEqual(
      powershell(directory, 'Stage-WindowsRelease.ps1', [
        ...args.slice(0, -1),
        join(directory, 'dist/release/v0.1.0'),
      ]).status,
      0,
    );
    assert.equal(existsSync(join(directory, 'dist/release/v0.1.0')), false);
  },
);

test(
  'staging preflights all inputs before creating output or relabeling wrong architectures',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = fixture();
    const output = join(directory, 'staged');
    const x64 = join(directory, 'AI Clip Memory_0.2.2_x64-setup.exe');
    const arm = join(directory, 'AI Clip Memory_0.2.2_arm64-setup.exe');
    writeFileSync(x64, 'synthetic');
    for (const args of [
      [
        '-ReleaseVersion',
        '0.2.2',
        '-X64InstallerPath',
        x64,
        '-Arm64InstallerPath',
        arm,
      ],
      [
        '-ReleaseVersion',
        '0.2.2',
        '-X64InstallerPath',
        x64,
        '-Arm64InstallerPath',
        x64,
      ],
    ]) {
      assert.notEqual(
        powershell(directory, 'Stage-WindowsRelease.ps1', [
          ...args,
          '-OutputDirectory',
          output,
        ]).status,
        0,
      );
      assert.equal(existsSync(output), false);
    }
  },
);

test(
  'staging refuses a junction rather than traversing its target',
  { skip: process.platform !== 'win32' },
  () => {
    const directory = fixture();
    const target = join(directory, 'untouched');
    const output = join(directory, 'alias');
    mkdirSync(target);
    symlinkSync(target, output, 'junction');
    const result = powershell(directory, 'Stage-WindowsRelease.ps1', [
      '-ReleaseVersion',
      '0.2.2',
      '-OutputDirectory',
      output,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /links or junctions/);
    assert.equal(existsSync(join(target, 'SHA256SUMS.txt')), false);
  },
);
