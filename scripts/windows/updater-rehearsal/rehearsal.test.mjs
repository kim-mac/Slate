import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, sep } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { validateManifestJson } from '../validate-desktop-update-release.mjs';
import * as config from '../release-rehearsal.mjs';
import { sourceInventory } from '../updater-e2e/prepare.mjs';

const api = await import('./prepare.mjs').catch(() => ({}));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const publicKey = read(
  'scripts/windows/updater-rehearsal/test-public-key.pub',
).trim();
const now = Date.UTC(2026, 9, 16, 12);
const policy = {
  accountId: 'a'.repeat(32),
  bucket: 'slate-private-test',
  prefix: 'slate-rehearsal/unit',
};
function presigned(path, changes = {}) {
  const url = new URL(
    `https://${policy.accountId}.r2.cloudflarestorage.com/${policy.bucket}/${policy.prefix}/${path}`,
  );
  for (const [key, value] of Object.entries({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': 'SYNTHETICACCESSID/20261016/auto/s3/aws4_request',
    'X-Amz-Date': '20261016T110000Z',
    'X-Amz-Expires': '604800',
    'X-Amz-SignedHeaders': 'host',
    'X-Amz-Signature': 'b'.repeat(64),
    ...changes,
  }))
    url.searchParams.set(key, value);
  return url.href;
}
function signature(version) {
  const packet = Buffer.alloc(74, 1);
  packet.write('ED');
  return Buffer.from(
    [
      'untrusted comment: synthetic; not authenticated',
      packet.toString('base64'),
      `trusted comment: timestamp:1\tfile:synthetic\tversion:${version}`,
      Buffer.alloc(64, 1).toString('base64'),
      '',
    ].join('\n'),
  ).toString('base64');
}
function manifest(version = '0.2.2') {
  return {
    version,
    platforms: Object.fromEntries(
      config.rehearsalArtifacts(version).map((a) => [
        a.platform,
        {
          url: presigned(`${version}/${a.installer}`),
          signature: signature(version),
        },
      ]),
    ),
  };
}
test('TEST identity is pinned to the approved envelope fingerprint, not caller-selected trust', () => {
  assert.equal(
    config.TEST_PUBLIC_KEY_SHA256,
    '9868697D6D22F6667160A764C94933FD9C754951E7840FEE51B0A7A93C7ED36D',
  );
  const source = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
  const known = JSON.parse(
    read('scripts/windows/update-signature-verifier/fixtures/signatures.json'),
  ).publicKey;
  assert.throws(
    () =>
      config.rehearsalConfiguration(source, {
        version: '0.2.2',
        endpoint: 'https://example.test/updates/windows/rehearsal.json',
        testPublicKey: known,
        expectedTestPublicKeySha256: createHash('sha256')
          .update(Buffer.from(known, 'base64'))
          .digest('hex'),
      }),
    /fingerprint/,
  );
});
test('private R2 URL policy accepts only the explicit account, bucket, object and live SigV4 GET shape', () => {
  assert.equal(typeof config.validateRehearsalUrl, 'function');
  assert.equal(
    config.validateRehearsalUrl(
      presigned('updates/windows/rehearsal.json'),
      policy,
      'updates/windows/rehearsal.json',
      now,
    ).expiresAt,
    '2026-10-23T11:00:00.000Z',
  );
  for (const change of [
    { 'X-Amz-Algorithm': 'other' },
    { 'X-Amz-Date': '20260230T110000Z' },
    { 'X-Amz-Date': '20261017T110000Z' },
    { 'X-Amz-Expires': '604801' },
    { 'X-Amz-Expires': '1' },
    { 'X-Amz-SignedHeaders': 'host;authorization' },
    { 'X-Amz-Signature': '' },
    { 'X-Amz-Credential': 'ID/20261016/not-auto/s3/aws4_request' },
    { versionId: 'old-object' },
    { redirect: 'https://tryslate.tech/updates/windows/latest.json' },
  ])
    assert.throws(() =>
      config.validateRehearsalUrl(
        presigned('updates/windows/rehearsal.json', change),
        policy,
        'updates/windows/rehearsal.json',
        now,
      ),
    );
  const good = presigned('updates/windows/rehearsal.json');
  for (const url of [
    good.replace('https:', 'http:'),
    good.replace(policy.accountId, 'c'.repeat(32)),
    good.replace(policy.bucket, 'different-bucket'),
    good.replace('rehearsal.json', 'stable.json'),
    good + '&X-Amz-Date=20261016T110000Z',
    good + '#secret',
    good.replace('https://', 'https://user:secret@'),
  ]) {
    let error;
    try {
      config.validateRehearsalUrl(
        url,
        policy,
        'updates/windows/rehearsal.json',
        now,
      );
    } catch (caught) {
      error = caught;
    }
    assert.ok(error);
    assert.ok(!String(error).includes('X-Amz-'));
  }
});
test('rehearsal adapter preserves strict manifest checks without changing production URL policy', () => {
  assert.equal(typeof config.validateRehearsalManifestJson, 'function');
  for (const version of ['0.2.2', '0.2.3']) {
    const text = JSON.stringify(manifest(version));
    const contract = config.validateRehearsalManifestJson(
      text,
      version,
      policy,
      now,
    );
    assert.equal(contract.version, version);
    assert.equal(contract.artifacts.length, 2);
    assert.equal(
      contract.artifacts[0].url,
      manifest(version).platforms['windows-x86_64'].url,
    );
    assert.throws(() => validateManifestJson(text, version));
  }
  const original = manifest();
  for (const mutate of [
    (m) => {
      delete m.platforms['windows-aarch64'];
    },
    (m) => {
      m.extra = true;
    },
    (m) => {
      m.platforms['windows-x86_64'].url = m.platforms['windows-aarch64'].url;
    },
    (m) => {
      m.platforms['windows-x86_64'].signature = signature('0.2.3');
    },
    (m) => {
      m.platforms['windows-x86_64'].url = presigned(
        '0.2.2/Slate-Extension-0.1.1.zip',
      );
    },
  ]) {
    const m = JSON.parse(JSON.stringify(original));
    mutate(m);
    assert.throws(() =>
      config.validateRehearsalManifestJson(
        JSON.stringify(m),
        '0.2.2',
        policy,
        now,
      ),
    );
  }
  const text = JSON.stringify(original);
  assert.throws(() =>
    config.validateRehearsalManifestJson(
      text.replace('"version":"0.2.2"', '"version":"0.2.3","version":"0.2.2"'),
      '0.2.2',
      policy,
      now,
    ),
  );
  assert.throws(() =>
    config.validateRehearsalManifestJson(
      text.replace('"version":', '"ver\\u0073ion":"0.2.2","version":'),
      '0.2.2',
      policy,
      now,
    ),
  );
  assert.throws(
    () =>
      config.validateRehearsalManifestJson(
        '{"secret-bearer-URL":',
        '0.2.2',
        policy,
        now,
      ),
    (error) => !String(error).includes('secret-bearer-URL'),
  );
});

function inputs(version = '0.2.2', worktree = root) {
  const parent = join(worktree, 'dist/test/updater-release-rehearsal');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'wiring-unit-'));
  const frontendDist = join(directory, 'frontend');
  mkdirSync(frontendDist);
  writeFileSync(
    join(frontendDist, 'index.html'),
    '<!doctype html><title>Synthetic frontend; not a build</title>',
  );
  const publicKeyPath = join(directory, 'test.key.pub');
  writeFileSync(publicKeyPath, publicKey + '\n');
  return {
    version,
    frontendDist,
    publicKeyPath,
    endpoint: presigned('updates/windows/rehearsal.json'),
    policy,
  };
}
test('stages consistent versions and installation enablement only in a fresh ignored candidate', () => {
  assert.equal(typeof api.prepareCandidate, 'function');
  const productionController = read(
    'apps/desktop/src-tauri/src/updater/mod.rs',
  );
  const originalController = productionController.replace(
    'installation_enabled: cfg!(windows) && driver.configured(),',
    'installation_enabled: false,',
  );
  const originalDriver = read(
    'apps/desktop/src-tauri/src/updater/tauri_driver.rs',
  );
  // Preserve old TEST workflow coverage using explicitly historical inputs.
  // The actual production config remains configured and must be rejected.
  const historicalRoot = mkdtempSync(join(root, 'dist/test/rehearsal-source-'));
  for (const path of [
    ...sourceInventory(root).map((item) => item.path),
    'package.json',
    'apps/desktop/package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'scripts/windows/Stage-WindowsRelease.ps1',
    'scripts/windows/Windows-ReleaseContract.ps1',
    'scripts/windows/Write-ReleaseChecksums.ps1',
  ]) {
    const destination = join(historicalRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, path), destination);
  }
  const historicalConfigPath = join(
    historicalRoot,
    'apps/desktop/src-tauri/tauri.conf.json',
  );
  const historicalConfig = JSON.parse(
    readFileSync(historicalConfigPath, 'utf8'),
  );
  delete historicalConfig.plugins.updater;
  writeFileSync(historicalConfigPath, JSON.stringify(historicalConfig));
  writeFileSync(
    join(historicalRoot, 'apps/desktop/src-tauri/src/updater/mod.rs'),
    originalController,
  );
  assert.throws(
    () => api.prepareCandidate(inputs(), root, now),
    /unconfigured/,
  );
  for (const version of ['0.2.2', '0.2.3']) {
    const result = api.prepareCandidate(
      inputs(version, historicalRoot),
      historicalRoot,
      now,
    );
    const candidate = result.candidate;
    assert.ok(
      candidate.startsWith(
        join(historicalRoot, 'dist/test/updater-release-rehearsal') + sep,
      ),
    );
    assert.equal(result.buildExecuted, false);
    for (const file of [
      'package.json',
      'apps/desktop/package.json',
      'apps/desktop/src-tauri/tauri.conf.json',
    ])
      assert.equal(
        JSON.parse(readFileSync(join(candidate, file), 'utf8')).version,
        version,
      );
    assert.match(
      readFileSync(
        join(candidate, 'apps/desktop/src-tauri/Cargo.toml'),
        'utf8',
      ),
      new RegExp(`version = "${version.replaceAll('.', '\\.')}"`),
    );
    assert.match(
      readFileSync(
        join(candidate, 'apps/desktop/src-tauri/Cargo.lock'),
        'utf8',
      ),
      new RegExp(
        `name = "ai-clip-memory-desktop"\\r?\\nversion = "${version.replaceAll('.', '\\.')}"`,
      ),
    );
    const controller = readFileSync(
      join(candidate, 'apps/desktop/src-tauri/src/updater/mod.rs'),
      'utf8',
    );
    assert.equal(
      controller,
      originalController.replace(
        '                    installation_enabled: false,',
        '                    installation_enabled: true,',
      ),
    );
    assert.equal(
      readFileSync(
        join(candidate, 'apps/desktop/src-tauri/src/updater/tauri_driver.rs'),
        'utf8',
      ),
      originalDriver,
    );
    for (const path of [
      'windows/installer.nsi',
      'windows/installer-hooks.nsh',
      'windows/maintenance-gate.nsh',
      'src/updater/handoff.rs',
      'src/storage.rs',
      'src/main.rs',
    ])
      assert.equal(
        readFileSync(join(candidate, 'apps/desktop/src-tauri', path), 'utf8'),
        read('apps/desktop/src-tauri/' + path),
      );
    const cfg = JSON.parse(
      readFileSync(join(candidate, 'apps/desktop/src-tauri/tauri.conf.json')),
    );
    assert.equal(cfg.build.frontendDist, '../dist');
    assert.equal(cfg.build.beforeBuildCommand, '');
    assert.equal(cfg.plugins.updater.pubkey, publicKey);
    assert.equal(cfg.bundle.windows.nsis.installMode, 'currentUser');
    assert.deepEqual(cfg.bundle.windows.webviewInstallMode, { type: 'skip' });
    assert.equal(existsSync(join(candidate, 'node_modules')), false);
    const files = JSON.parse(
      readFileSync(join(candidate, 'rehearsal-inventory.json')),
    ).staged;
    assert.ok(
      !files.some(
        (f) =>
          f.path.endsWith('.key') ||
          f.path.includes('target/') ||
          f.path.includes('release/v0.1.0'),
      ),
    );
    for (const architecture of ['x64', 'arm64']) {
      const plan = api.rehearsalBuildPlan(
        candidate,
        architecture,
        historicalRoot,
        now,
      );
      assert.equal(plan.profile, 'release');
      assert.ok(plan.commands.every((c) => !c.args.includes('--debug')));
      assert.ok(plan.commands[0].args.includes('--release'));
      assert.ok(plan.commands[1].args.includes('--no-sign'));
      assert.ok(
        plan.commands[1].args.includes(
          architecture === 'x64'
            ? 'x86_64-pc-windows-msvc'
            : 'aarch64-pc-windows-msvc',
        ),
      );
      assert.equal(plan.commands[1].env.RUST_LOG, 'off');
    }
    assert.throws(() =>
      api.rehearsalBuildPlan(candidate, 'x86', historicalRoot, now),
    );
    writeFileSync(
      join(candidate, 'apps/desktop/src-tauri/src/updater/tauri_driver.rs'),
      'tampered',
    );
    assert.throws(() =>
      api.rehearsalBuildPlan(candidate, 'arm64', historicalRoot, now),
    );
  }
  assert.equal(
    read('apps/desktop/src-tauri/src/updater/mod.rs'),
    productionController,
  );
  assert.equal(
    read('apps/desktop/src-tauri/src/updater/tauri_driver.rs'),
    originalDriver,
  );
});
test('unsafe staging inputs and build overrides fail closed without building or signing', () => {
  assert.equal(typeof api.prepareCandidate, 'function');
  for (const change of [
    { version: '0.2.1' },
    { endpoint: 'https://tryslate.tech/updates/windows/latest.json' },
    { frontendDist: root },
    { privateKeyPath: 'not accepted' },
  ])
    assert.throws(() =>
      api.prepareCandidate({ ...inputs(), ...change }, root, now),
    );
  assert.equal(typeof api.assertRehearsalEnvironment, 'function');
  for (const name of [
    'TAURI_CONFIG',
    'TAURI_SIGNING_PRIVATE_KEY',
    'NODE_OPTIONS',
    'RUSTFLAGS',
    'CARGO_ENCODED_RUSTFLAGS',
    'CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS',
  ])
    assert.throws(() =>
      api.assertRehearsalEnvironment({ [name]: 'synthetic' }),
    );
  const implementation = read('scripts/windows/updater-rehearsal/prepare.mjs');
  for (const forbidden of [
    'spawnSync(',
    'execFile(',
    'fetch(',
    'node:https',
    'signer sign',
  ])
    assert.ok(!implementation.includes(forbidden));
});

test('private manifest validation cannot replace Gate A1 cryptographic authentication', async () => {
  assert.equal(typeof api.verifyRehearsalRelease, 'function');
  const input = inputs();
  const directory = join(input.frontendDist, 'synthetic-artifacts');
  mkdirSync(directory);
  for (const a of config.rehearsalArtifacts('0.2.2')) {
    writeFileSync(
      join(directory, a.installer),
      'synthetic bytes; NOT AN INSTALLER',
    );
    writeFileSync(join(directory, a.signature), signature('0.2.2'));
  }
  const target =
    process.arch === 'arm64'
      ? 'aarch64-pc-windows-msvc'
      : 'x86_64-pc-windows-msvc';
  const verifierPath = join(
    root,
    'scripts/windows/update-signature-verifier/target',
    target,
    'debug/slate-update-signature-verifier.exe',
  );
  assert.ok(
    existsSync(verifierPath),
    'Existing offline verifier required; no build is permitted by this test',
  );
  await assert.rejects(
    api.verifyRehearsalRelease(
      {
        text: JSON.stringify(manifest()),
        version: '0.2.2',
        policy,
        directory,
        publicKeyPath: input.publicKeyPath,
        verifierPath,
      },
      now,
    ),
    /cryptographic verification failed/,
  );
  // A private-key-looking path is rejected before any attempted read.
  await assert.rejects(
    api.verifyRehearsalRelease(
      {
        text: JSON.stringify(manifest()),
        version: '0.2.2',
        policy,
        directory,
        publicKeyPath: join(directory, 'never-open.key'),
        verifierPath,
      },
      now,
    ),
    /Public key only/,
  );
});
