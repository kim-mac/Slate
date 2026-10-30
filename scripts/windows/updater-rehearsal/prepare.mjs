// @ts-check
// Local rehearsal staging and command plans only. Never executes a build or installer.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { assertCleanEnvironment } from '../disposable-test-signing.mjs';
import {
  localInputPath,
  verifyReleaseArtifacts,
} from '../validate-desktop-update-release.mjs';
import {
  ordinaryPath,
  auditWindowsPaths,
  readOrdinary,
  writeNew,
  sourceInventory,
  nativeManifest,
} from '../updater-e2e/prepare.mjs';
import {
  TEST_PUBLIC_KEY_SHA256,
  rehearsalArtifacts,
  rehearsalConfiguration,
  validateRehearsalUrl,
  validateRehearsalManifestJson,
} from '../release-rehearsal.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRATE = 'apps/desktop/src-tauri';
const PARENT = 'dist/test/updater-release-rehearsal';
const hash = (/** @type {Uint8Array | string} */ value) =>
  createHash('sha256').update(value).digest('hex').toUpperCase();
const json = (/** @type {unknown} */ value) =>
  `${JSON.stringify(value, null, 2)}\n`;

/** @param {NodeJS.ProcessEnv} environment */
export function assertRehearsalEnvironment(environment) {
  assertCleanEnvironment(environment);
  assert.ok(
    !Object.keys(environment).some((name) =>
      /^(TAURI_.*CONFIG|TAURI_ENV_DEBUG|RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_PROFILE_.*|CARGO_TARGET_.*_RUSTFLAGS|RUSTC(?:_WORKSPACE)?_WRAPPER)$/i.test(
        name,
      ),
    ),
    'Remove rehearsal build configuration overrides',
  );
}
/** @param {string} parent @param {string} path */
function inside(parent, path) {
  path = localInputPath(path);
  const rel = relative(localInputPath(parent), path);
  assert.ok(
    rel &&
      !isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('../') &&
      !rel.startsWith('..\\'),
    'Expected a worktree-local rehearsal path',
  );
  ordinaryPath(path);
  return path;
}
/** @param {string} source @param {RegExp} pattern @param {(substring: string, ...args: any[]) => string} replacement */
function replaceOne(source, pattern, replacement) {
  assert.equal(
    [...source.matchAll(new RegExp(pattern, 'g'))].length,
    1,
    'Expected exactly one reviewed version/enablement anchor',
  );
  return source.replace(pattern, replacement);
}

/** @typedef {{version: string, endpoint: string, policy: import('../release-rehearsal.mjs').R2Policy, publicKeyPath: string, frontendDist: string}} Inputs */
/** Prebuilt normal production frontend required. No dependency links/copies.
 * @param {Inputs} input @param {string} [worktree] @param {number} [now]
 */
export function prepareCandidate(input, worktree = ROOT, now = Date.now()) {
  assertRehearsalEnvironment(process.env);
  assert.deepEqual(Object.keys(input).sort(), [
    'endpoint',
    'frontendDist',
    'policy',
    'publicKeyPath',
    'version',
  ]);
  worktree = localInputPath(worktree);
  const artifacts = rehearsalArtifacts(input.version);
  const expiry = validateRehearsalUrl(
    input.endpoint,
    input.policy,
    'updates/windows/rehearsal.json',
    now,
  );
  const publicKeyPath = inside(worktree, input.publicKeyPath);
  assert.ok(
    publicKeyPath.endsWith('.pub'),
    'Only a public-key file is accepted',
  );
  const publicKey = readOrdinary(publicKeyPath, 16384).toString('utf8').trim();
  const load = (/** @type {string} */ path) =>
    readOrdinary(join(worktree, path), 16 * 1024 * 1024).toString('utf8');
  const config = rehearsalConfiguration(
    JSON.parse(load(`${CRATE}/tauri.conf.json`)),
    {
      version: input.version,
      endpoint: input.endpoint,
      testPublicKey: publicKey,
      expectedTestPublicKeySha256: TEST_PUBLIC_KEY_SHA256,
    },
  );
  const inventory = sourceInventory(worktree);
  const changes = new Map();
  const snapshots = [...inventory];
  const version = input.version;
  /** @type {string} */
  const originalVersion = JSON.parse(load('package.json')).version;
  for (const path of ['package.json', 'apps/desktop/package.json']) {
    const bytes = readOrdinary(join(worktree, path), 16384);
    const document = JSON.parse(bytes.toString('utf8'));
    assert.equal(document.version, originalVersion);
    document.version = version;
    snapshots.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    changes.set(path, json(document));
  }
  // Reuse the normal byte-preserving staging tool against the copied metadata.
  for (const path of [
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'scripts/windows/Stage-WindowsRelease.ps1',
    'scripts/windows/Windows-ReleaseContract.ps1',
    'scripts/windows/Write-ReleaseChecksums.ps1',
  ]) {
    const bytes = readOrdinary(join(worktree, path), 16 * 1024 * 1024);
    snapshots.push({ path, bytes: bytes.length, sha256: hash(bytes) });
    changes.set(path, bytes);
  }
  assert.match(
    originalVersion,
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
  );
  assert.equal(
    JSON.parse(load(`${CRATE}/tauri.conf.json`)).version,
    originalVersion,
  );
  const cargo = load(`${CRATE}/Cargo.toml`);
  assert.match(cargo, /tauri = \{ version = "=2\.12\.3"/);
  assert.match(cargo, /tauri-plugin-updater = \{ version = "=2\.13\.3"/);
  assert.equal(
    JSON.parse(load('apps/desktop/package.json')).devDependencies[
      '@tauri-apps/cli'
    ],
    '2.12.2',
  );
  changes.set(
    `${CRATE}/Cargo.toml`,
    replaceOne(
      cargo,
      /(^\[package\][\s\S]*?\nversion = ")([^"]+)(")/m,
      (_, before, old, after) => {
        assert.equal(old, originalVersion);
        return before + version + after;
      },
    ),
  );
  changes.set(
    `${CRATE}/Cargo.lock`,
    replaceOne(
      load(`${CRATE}/Cargo.lock`),
      /(name = "ai-clip-memory-desktop"\r?\nversion = ")([^"]+)(")/,
      (_, before, old, after) => {
        assert.equal(old, originalVersion);
        return before + version + after;
      },
    ),
  );
  changes.set(
    `${CRATE}/src/updater/mod.rs`,
    replaceOne(
      load(`${CRATE}/src/updater/mod.rs`),
      / {20}installation_enabled: false,/,
      () => '                    installation_enabled: true,',
    ),
  );
  assert.match(
    load(`${CRATE}/src/main.rs`),
    /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/,
  );
  // Freeze an already-produced normal frontend. No debug/Vite development server.
  const frontend = inside(worktree, input.frontendDist);
  const frontendRelative = relative(worktree, frontend).replaceAll('\\', '/');
  assert.ok(
    frontendRelative === 'apps/desktop/dist' ||
      frontendRelative.startsWith('dist/test/'),
    'Expected normal frontend output or a disposable test fixture',
  );
  readOrdinary(join(frontend, 'index.html'), 8 * 1024 * 1024);
  /** @type {Array<{path: string, bytes: number, sha256: string}>} */
  const frontendFiles = [];
  function visit(/** @type {string} */ path) {
    ordinaryPath(path);
    if (lstatSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
    } else {
      assert.match(path, /\.(html|js|css|json|svg|png|ico|woff2?)$/);
      const bytes = readOrdinary(path, 16 * 1024 * 1024);
      const name = relative(frontend, path).replaceAll('\\', '/');
      frontendFiles.push({
        path: relative(worktree, path).replaceAll('\\', '/'),
        bytes: bytes.length,
        sha256: hash(bytes),
      });
      changes.set(`apps/desktop/dist/${name}`, bytes);
    }
  }
  visit(frontend);
  config.build.beforeBuildCommand = '';
  config.build.beforeDevCommand = '';
  config.build.frontendDist = '../dist';
  changes.set(`${CRATE}/tauri.conf.json`, json(config));
  changes.set(
    `${CRATE}/windows/generated/com.aiclipmemory.bridge.json`,
    json(
      nativeManifest(
        JSON.parse(
          load(`${CRATE}/windows/native-messaging-host.json.template`),
        ),
        JSON.parse(load('apps/extension/public/manifest.json')),
        JSON.parse(load('apps/extension/release-identity.json')),
      ),
    ),
  );
  changes.set('test-public-key.pub', publicKey + '\n');
  // Validate all inputs before creating the fresh ignored destination.
  const inputs = [...snapshots, ...frontendFiles];
  auditWindowsPaths(inputs.map((item) => join(worktree, item.path)));
  const parent = join(worktree, PARENT);
  ordinaryPath(parent);
  mkdirSync(parent, { recursive: true });
  auditWindowsPaths([parent]);
  const run = mkdtempSync(join(parent, 'run-'));
  const candidate = join(run, version);
  const staged = [];
  for (const item of snapshots) {
    const bytes = readOrdinary(join(worktree, item.path), 16 * 1024 * 1024);
    assert.equal(hash(bytes), item.sha256, 'Source changed during preparation');
    if (!changes.has(item.path)) changes.set(item.path, bytes);
  }
  for (const [path, bytes] of changes) {
    writeNew(join(candidate, path), bytes);
    staged.push({ path, sha256: hash(bytes) });
  }
  for (const item of inputs)
    assert.equal(
      hash(readOrdinary(join(worktree, item.path), 16 * 1024 * 1024)),
      item.sha256,
      'Source changed during preparation',
    );
  writeNew(
    join(candidate, 'rehearsal-inventory.json'),
    json({
      testOnly: true,
      version,
      worktree,
      source: inputs,
      staged,
      policy: input.policy,
      publicKeySha256: TEST_PUBLIC_KEY_SHA256,
      manifestExpiresAt: expiry.expiresAt,
    }),
  );
  return {
    prepared: true,
    candidate,
    version,
    artifacts,
    installationEnabledOnlyInCopy: true,
    buildExecuted: false,
    manifestExpiresAt: expiry.expiresAt,
  };
}

/** Revalidate staged bytes and unchanged source before returning argv arrays.
 * Does not execute any command, contact an endpoint, or read a signing private key.
 * @param {string} candidate @param {string} architecture @param {string} [worktree] @param {number} [now]
 */
export function rehearsalBuildPlan(
  candidate,
  architecture,
  worktree = ROOT,
  now = Date.now(),
) {
  assertRehearsalEnvironment(process.env);
  candidate = inside(join(worktree, PARENT), candidate);
  const metadata = JSON.parse(
    readOrdinary(
      join(candidate, 'rehearsal-inventory.json'),
      1024 * 1024,
    ).toString('utf8'),
  );
  assert.ok(
    metadata.testOnly === true &&
      metadata.worktree === localInputPath(worktree),
  );
  const artifact = rehearsalArtifacts(metadata.version).find((a) =>
    a.target.startsWith(
      architecture === 'arm64'
        ? 'aarch64-'
        : architecture === 'x64'
          ? 'x86_64-'
          : 'unsupported-',
    ),
  );
  assert.ok(artifact, 'Unsupported rehearsal architecture');
  assert.equal(metadata.publicKeySha256, TEST_PUBLIC_KEY_SHA256);
  for (const [parent, files] of [
    [candidate, metadata.staged],
    [worktree, metadata.source],
  ]) {
    for (const file of files)
      assert.equal(
        hash(
          readOrdinary(
            inside(parent, join(parent, file.path)),
            16 * 1024 * 1024,
          ),
        ),
        file.sha256,
        'Candidate/source changed; prepare a new candidate',
      );
  }
  const config = JSON.parse(
    readOrdinary(join(candidate, CRATE, 'tauri.conf.json'), 16384).toString(
      'utf8',
    ),
  );
  validateRehearsalUrl(
    config.plugins.updater.endpoints[0],
    metadata.policy,
    'updates/windows/rehearsal.json',
    now,
  );
  assert.equal(
    hash(Buffer.from(config.plugins.updater.pubkey, 'base64')),
    TEST_PUBLIC_KEY_SHA256,
  );
  const crate = join(candidate, CRATE);
  const cache = join(worktree, CRATE, 'target');
  ordinaryPath(cache);
  const env = {
    CARGO_TARGET_DIR: cache,
    CARGO_NET_OFFLINE: 'true',
    RUST_LOG: 'off',
  };
  return {
    profile: 'release',
    artifact,
    expectedBundle: join(
      cache,
      artifact.target,
      'release/bundle/nsis',
      `AI Clip Memory_${metadata.version}_${architecture}-setup.exe`,
    ),
    stagingScriptAfterBothBuilds: join(
      candidate,
      'scripts/windows/Stage-WindowsRelease.ps1',
    ),
    commands: [
      {
        command: 'cargo',
        args: [
          'build',
          '--release',
          '--offline',
          '--locked',
          '--manifest-path',
          join(crate, 'Cargo.toml'),
          '--target',
          artifact.target,
          '--target-dir',
          cache,
          '--bin',
          'ai-clip-memory-native-host',
        ],
        cwd: candidate,
        env,
      },
      {
        command: process.execPath,
        args: [
          join(worktree, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'),
          'build',
          '--no-sign',
          '--bundles',
          'nsis',
          '--target',
          artifact.target,
          '--',
          '--offline',
          '--locked',
        ],
        cwd: join(candidate, 'apps/desktop'),
        env,
      },
    ],
  };
}

/** Same Gate A1 engine; no compilation fallback. Only the pinned TEST public key.
 * @param {{text: string, version: string, policy: import('../release-rehearsal.mjs').R2Policy, directory: string, publicKeyPath: string, verifierPath: string}} input
 * @param {number} [now]
 */
export async function verifyRehearsalRelease(input, now = Date.now()) {
  const contract = validateRehearsalManifestJson(
    input.text,
    input.version,
    input.policy,
    now,
  );
  assert.ok(input.publicKeyPath.endsWith('.pub'), 'Public key only');
  const key = readOrdinary(input.publicKeyPath, 16384).toString('utf8').trim();
  assert.equal(
    hash(Buffer.from(key, 'base64')),
    TEST_PUBLIC_KEY_SHA256,
    'TEST identity mismatch',
  );
  return verifyReleaseArtifacts(
    contract,
    input.directory,
    input.publicKeyPath,
    input.verifierPath,
  );
}

if (
  process.argv[1] &&
  localInputPath(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    let report;
    if (process.argv[2] === 'prepare' && process.argv.length === 4) {
      assert.ok(process.argv[3].endsWith('.json'));
      report = prepareCandidate(
        JSON.parse(readOrdinary(process.argv[3], 16384).toString('utf8')),
      );
    } else if (process.argv[2] === 'plan' && process.argv.length === 5) {
      report = rehearsalBuildPlan(process.argv[3], process.argv[4]);
    } else throw new Error('Unsupported arguments');
    process.stdout.write(json(report));
  } catch {
    process.stderr.write(
      'Rehearsal preparation/plan rejected. Check explicit inputs, key pin, source inventory and URL expiry. No build or signing was executed.\n',
    );
    process.exitCode = 1;
  }
}
