// @ts-check
// Offline private candidate preparation only. Never builds, signs, uploads or installs.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import {
  STABLE_ENDPOINT,
  localInputPath,
  validateManifestJson,
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
import { validateRehearsalUrl } from '../release-rehearsal.mjs';
import { assertRehearsalEnvironment } from './prepare.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRATE = 'apps/desktop/src-tauri';
const PARENT = 'dist/test/updater-production-rehearsal';
export const ACKNOWLEDGEMENT =
  'private-production-0.2.9-to-0.3.0-no-public-release';
export const PRODUCTION_PUBLIC_KEY_SHA256 =
  '2641A4781B6B0004D449EE4DE626E8378A87AC89C3800A405972F0ACAA59AFC9';
const hash = (/** @type {Uint8Array | string} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex').toUpperCase();
const json = (/** @type {unknown} */ value) =>
  `${JSON.stringify(value, null, 2)}\n`;
const extras = [
  'package.json',
  'apps/desktop/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
];

/** @param {unknown} value */
function optIn(value) {
  assert.equal(
    value,
    ACKNOWLEDGEMENT,
    'Explicit private-only acknowledgement required',
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
    'Expected isolated local path',
  );
  ordinaryPath(path);
  return path;
}
/** @param {string} source @param {RegExp} pattern @param {string | ((...args: any[]) => string)} replacement */
function replaceOne(source, pattern, replacement) {
  assert.equal(
    [...source.matchAll(new RegExp(pattern, 'g'))].length,
    1,
    'Reviewed source anchor changed',
  );
  return typeof replacement === 'string'
    ? source.replace(pattern, replacement)
    : source.replace(pattern, replacement);
}
/** @param {Record<string, any>} source */
function productionTrust(source) {
  const updater = source.plugins?.updater;
  assert.ok(
    updater && typeof updater.pubkey === 'string',
    'Production trust missing',
  );
  assert.equal(
    hash(Buffer.from(updater.pubkey, 'base64')),
    PRODUCTION_PUBLIC_KEY_SHA256,
    'Production trust mismatch',
  );
  assert.equal(
    Buffer.from(updater.pubkey, 'base64').toString('base64'),
    updater.pubkey,
    'Production trust envelope malformed',
  );
  assert.deepEqual(
    updater.endpoints,
    [STABLE_ENDPOINT],
    'Production trust endpoint changed',
  );
  assert.equal(
    updater.requireSignedVersion,
    true,
    'Production trust must authenticate versions',
  );
  for (const flag of [
    'allowDowngrades',
    'dangerousInsecureTransportProtocol',
    'dangerousAcceptInvalidCerts',
    'dangerousAcceptInvalidHostnames',
  ])
    assert.equal(updater[flag], false, 'Production trust weakened');
  assert.equal(source.version, '0.3.0');
  assert.equal(source.identifier, 'com.aiclipmemory.desktop');
  assert.equal(source.productName, 'AI Clip Memory');
  assert.deepEqual(source.bundle.targets, ['nsis']);
  assert.equal(source.bundle.windows.nsis.installMode, 'currentUser');
  assert.equal(source.bundle.windows.allowDowngrades, false);
  assert.ok(
    !source.bundle.createUpdaterArtifacts,
    'Automatic signing must stay disabled',
  );
}
/** Only the baseline carries temporary private delivery. The target never does.
 * @param {Record<string, any>} source @param {string} role @param {string} [endpoint]
 * @param {import('../release-rehearsal.mjs').R2Policy} [policy] @param {number} [now]
 */
export function configuration(
  source,
  role,
  endpoint,
  policy,
  now = Date.now(),
) {
  productionTrust(source);
  assert.ok(
    role === 'baseline' || role === 'candidate',
    'Unknown rehearsal role',
  );
  if (role === 'baseline') {
    assert.ok(
      policy &&
        /^slate-rehearsal\/production-v029-v030-[a-z0-9-]+$/.test(
          policy.prefix,
        ),
      'Private rehearsal namespace required',
    );
    assert.equal(policy.bucket, 'slate-updater-rehearsal');
    assert.ok(typeof endpoint === 'string', 'Private endpoint required');
    validateRehearsalUrl(
      endpoint,
      policy,
      'updates/windows/rehearsal.json',
      now,
    );
  } else
    assert.ok(
      endpoint === undefined && policy === undefined,
      'Production candidate forbids private delivery inputs',
    );
  const copy = JSON.parse(JSON.stringify(source));
  copy.version = role === 'baseline' ? '0.2.9' : '0.3.0';
  copy.plugins.updater.endpoints = [
    role === 'baseline' ? endpoint : STABLE_ENDPOINT,
  ];
  copy.build.beforeBuildCommand = '';
  copy.build.beforeDevCommand = '';
  copy.build.frontendDist = '../dist';
  return copy;
}

/** Both opt-ins exist ONLY in the ignored copy. No runtime endpoint/key override.
 * @param {string} source
 */
export function rehearsalController(source) {
  return replaceOne(
    source,
    / {20}installation_enabled: (?:false|cfg!\(windows\) && driver\.configured\(\)),/,
    `                    installation_enabled: option_env!("SLATE_PRIVATE_REHEARSAL_BUILD")
                        == Some("${ACKNOWLEDGEMENT}")
                        && std::env::var("SLATE_PRIVATE_REHEARSAL_RUN").as_deref()
                            == Ok("${ACKNOWLEDGEMENT}")
                        && ["0.2.9", "0.3.0"].contains(&env!("CARGO_PKG_VERSION")),`,
  );
}
/** @param {string} source */
function rehearsalBuildScript(source) {
  return replaceOne(
    source,
    /fn main\(\) \{/,
    `fn main() {
    println!("cargo:rerun-if-env-changed=SLATE_PRIVATE_REHEARSAL_BUILD");
    assert!(std::env::var("SLATE_PRIVATE_REHEARSAL_BUILD").as_deref()
        == Ok("${ACKNOWLEDGEMENT}"),
        "PRIVATE REHEARSAL ONLY: not a public release build");`,
  );
}
/** @param {string} version */
export function artifacts(version) {
  assert.ok(['0.2.9', '0.3.0'].includes(version), 'Unapproved private version');
  return [
    {
      platform: 'windows-x86_64',
      target: 'x86_64-pc-windows-msvc',
      architecture: 'x64',
    },
    {
      platform: 'windows-aarch64',
      target: 'aarch64-pc-windows-msvc',
      architecture: 'ARM64',
    },
  ].map((item) => ({
    ...item,
    filename: `Slate-PRIVATE-REHEARSAL-${version}-Windows-${item.architecture}.exe`,
    signatureFilename: `Slate-PRIVATE-REHEARSAL-${version}-Windows-${item.architecture}.exe.sig`,
  }));
}

/** @typedef {{acknowledgement: string, frontendDist: string, baselineEndpoint: string, policy: import('../release-rehearsal.mjs').R2Policy}} Input */
/** Validate all input before fresh ignored copies; no dependency installation or build.
 * @param {Input} input @param {string} [worktree] @param {number} [now]
 */
export function prepare(input, worktree = ROOT, now = Date.now()) {
  optIn(input.acknowledgement);
  assertRehearsalEnvironment(process.env);
  assert.deepEqual(Object.keys(input).sort(), [
    'acknowledgement',
    'baselineEndpoint',
    'frontendDist',
    'policy',
  ]);
  worktree = localInputPath(worktree);
  const load = (/** @type {string} */ path) =>
    readOrdinary(join(worktree, path), 16 * 1024 * 1024);
  const sourceConfig = JSON.parse(
    load(`${CRATE}/tauri.conf.json`).toString('utf8'),
  );
  const configs = {
    baseline: configuration(
      sourceConfig,
      'baseline',
      input.baselineEndpoint,
      input.policy,
      now,
    ),
    candidate: configuration(sourceConfig, 'candidate'),
  };
  // Reuse the existing inventory, but never copy the historical TEST public key.
  const source = sourceInventory(worktree).filter(
    (file) => !file.path.startsWith('dist/'),
  );
  for (const path of extras) {
    const bytes = load(path);
    source.push({ path, bytes: bytes.length, sha256: hash(bytes) });
  }
  const controller = rehearsalController(
    load(`${CRATE}/src/updater/mod.rs`).toString('utf8'),
  );
  const buildScript = rehearsalBuildScript(
    load(`${CRATE}/build.rs`).toString('utf8'),
  );
  const cargo = load(`${CRATE}/Cargo.toml`).toString('utf8');
  assert.match(cargo, /tauri = \{ version = "=2\.12\.3"/);
  assert.match(cargo, /tauri-plugin-updater = \{ version = "=2\.13\.3"/);
  assert.match(
    load(`${CRATE}/src/main.rs`).toString('utf8'),
    /cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)/,
  );
  assert.equal(
    JSON.parse(load('apps/desktop/package.json').toString('utf8'))
      .devDependencies['@tauri-apps/cli'],
    '2.12.2',
  );
  const native = nativeManifest(
    JSON.parse(
      load(`${CRATE}/windows/native-messaging-host.json.template`).toString(
        'utf8',
      ),
    ),
    JSON.parse(load('apps/extension/public/manifest.json').toString('utf8')),
    JSON.parse(load('apps/extension/release-identity.json').toString('utf8')),
  );
  const frontend = inside(worktree, input.frontendDist);
  const frontendRel = relative(worktree, frontend).replaceAll('\\', '/');
  assert.ok(
    frontendRel === 'apps/desktop/dist' || frontendRel.startsWith('dist/test/'),
  );
  readOrdinary(join(frontend, 'index.html'));
  const frontendFiles = new Map();
  function visit(/** @type {string} */ path) {
    ordinaryPath(path);
    if (lstatSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    assert.match(path, /\.(html|js|css|json|svg|png|ico|woff2?)$/);
    const bytes = readOrdinary(path, 16 * 1024 * 1024);
    assert.doesNotMatch(
      bytes.toString('utf8'),
      /\.r2\.cloudflarestorage\.com|X-Amz-Credential=|BEGIN PRIVATE KEY/,
      'Private delivery must not enter the frontend',
    );
    source.push({
      path: relative(worktree, path).replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: hash(bytes),
    });
    frontendFiles.set(
      `apps/desktop/dist/${relative(frontend, path).replaceAll('\\', '/')}`,
      bytes,
    );
  }
  visit(frontend);
  const staged = new Map();
  for (const [role, config] of Object.entries(configs)) {
    const version = config.version;
    const files = new Map(frontendFiles);
    for (const file of source) {
      if (file.path.startsWith(frontendRel + '/')) continue;
      const bytes = load(file.path);
      assert.equal(
        hash(bytes),
        file.sha256,
        'Source changed during preparation',
      );
      files.set(file.path, bytes);
    }
    for (const path of ['package.json', 'apps/desktop/package.json']) {
      const document = JSON.parse(load(path).toString('utf8'));
      assert.equal(document.version, '0.3.0');
      document.version = version;
      files.set(path, json(document));
    }
    files.set(
      `${CRATE}/Cargo.toml`,
      replaceOne(
        cargo,
        /(^\[package\][\s\S]*?\nversion = ")([^"]+)(")/m,
        (_match, before, old, after) => {
          assert.equal(old, '0.3.0');
          return before + version + after;
        },
      ),
    );
    files.set(
      `${CRATE}/Cargo.lock`,
      replaceOne(
        load(`${CRATE}/Cargo.lock`).toString('utf8'),
        /(name = "ai-clip-memory-desktop"\r?\nversion = ")([^"]+)(")/,
        (_match, before, old, after) => {
          assert.equal(old, '0.3.0');
          return before + version + after;
        },
      ),
    );
    files.set(`${CRATE}/tauri.conf.json`, json(config));
    files.set(`${CRATE}/src/updater/mod.rs`, controller);
    files.set(`${CRATE}/build.rs`, buildScript);
    files.set(
      'production-public-key.pub',
      sourceConfig.plugins.updater.pubkey + '\n',
    );
    files.set(
      `${CRATE}/windows/generated/com.aiclipmemory.bridge.json`,
      json(native),
    );
    if (role === 'candidate')
      for (const bytes of files.values())
        assert.doesNotMatch(
          bytes.toString('utf8'),
          /\.r2\.cloudflarestorage\.com|X-Amz-Credential=/,
          'Production candidate contains private delivery',
        );
    staged.set(role, { version, files });
  }
  auditWindowsPaths(source.map((file) => join(worktree, file.path)));
  const parent = join(worktree, PARENT);
  ordinaryPath(parent);
  mkdirSync(parent, { recursive: true });
  auditWindowsPaths([parent]);
  const run = mkdtempSync(join(parent, 'run-'));
  const result = {
    privateOnly: true,
    publicationAllowed: false,
    buildExecuted: false,
    baseline: '',
    candidate: '',
  };
  for (const [role, stage] of staged) {
    const directory = join(run, stage.version);
    const inventory = [];
    for (const [path, bytes] of stage.files) {
      writeNew(join(directory, path), bytes);
      inventory.push({ path, sha256: hash(bytes) });
    }
    writeNew(
      join(directory, 'private-rehearsal-inventory.json'),
      json({
        privateOnly: true,
        publicationAllowed: false,
        acknowledgement: ACKNOWLEDGEMENT,
        role,
        version: stage.version,
        worktree,
        frontend: frontendRel,
        source,
        staged: inventory,
        publicKeySha256: PRODUCTION_PUBLIC_KEY_SHA256,
        ...(role === 'baseline' ? { policy: input.policy } : {}),
      }),
    );
    if (role === 'baseline') result.baseline = directory;
    else {
      assert.equal(role, 'candidate');
      result.candidate = directory;
    }
  }
  for (const file of source)
    assert.equal(
      hash(load(file.path)),
      file.sha256,
      'Source changed during preparation',
    );
  return result;
}

/** Strict private-delivery adapter. Only URL string tokens are adapted for the
 * unchanged production schema validator; signatures and every other byte remain
 * untouched. SigV4 checks are structural, never claimed as cryptographic proof.
 * @param {string} text @param {string} version @param {import('../release-rehearsal.mjs').R2Policy} policy @param {number} [now]
 */
export function validatePrivateManifest(
  text,
  version,
  policy,
  now = Date.now(),
) {
  try {
    assert.ok(
      /^slate-rehearsal\/production-v029-v030-[a-z0-9-]+$/.test(policy.prefix),
    );
    assert.equal(policy.bucket, 'slate-updater-rehearsal');
    const mappings = artifacts(version);
    const parsed = JSON.parse(text);
    let adapted = text;
    const urls = new Map();
    for (const artifact of mappings) {
      const value = parsed.platforms?.[artifact.platform]?.url;
      assert.equal(typeof value, 'string');
      const actual = new URL(value);
      assert.equal(actual.href, value);
      assert.equal(
        actual.pathname,
        `/${policy.bucket}/${policy.prefix}/${version}/${artifact.filename}`,
      );
      // The exact original artifact object was checked above. Reuse the existing
      // query/host/expiry checker on its supported manifest path, WITHOUT sending
      // this adapted URL or claiming its retained SigV4 query authenticates a GET.
      const shape = new URL(actual);
      shape.pathname = `/${policy.bucket}/${policy.prefix}/updates/windows/rehearsal.json`;
      validateRehearsalUrl(
        shape.href,
        policy,
        'updates/windows/rehearsal.json',
        now,
      );
      const canonical = `https://github.com/kim-mac/Slate/releases/download/v${version}/Slate-${version}-Windows-${artifact.architecture}.exe`;
      const token = JSON.stringify(value);
      assert.equal(
        adapted.split(token).length,
        2,
        'Expected one unescaped URL token',
      );
      adapted = adapted.replace(token, JSON.stringify(canonical));
      urls.set(artifact.platform, value);
    }
    const contract = validateManifestJson(adapted, version);
    return {
      endpoint: 'private-production-rehearsal',
      version: contract.version,
      artifacts: contract.artifacts.map((artifact, index) => ({
        ...artifact,
        filename: mappings[index].filename,
        signatureFilename: mappings[index].signatureFilename,
        url: urls.get(artifact.platform),
      })),
    };
  } catch {
    throw new Error(
      'Private manifest contract rejected; no authentication or publication performed',
    );
  }
}

/** Public-key-only Gate A1, with no compilation or signing fallback.
 * @param {{text: string, version: string, policy: import('../release-rehearsal.mjs').R2Policy, publicKeyPath: string, directory: string, verifierPath: string}} input
 * @param {number} [now]
 */
export async function verifyPrivateRelease(input, now = Date.now()) {
  assert.ok(input.publicKeyPath.endsWith('.pub'), 'Public key only');
  const key = readOrdinary(input.publicKeyPath, 16384).toString('utf8').trim();
  assert.equal(
    hash(Buffer.from(key, 'base64')),
    PRODUCTION_PUBLIC_KEY_SHA256,
    'Production trust mismatch',
  );
  const contract = validatePrivateManifest(
    input.text,
    input.version,
    input.policy,
    now,
  );
  return verifyReleaseArtifacts(
    contract,
    input.directory,
    input.publicKeyPath,
    input.verifierPath,
  );
}

/** Return argv only, never execute. Verify acknowledgement, complete snapshots and trust.
 * @param {string} candidate @param {string} architecture @param {string} acknowledgement
 * @param {string} [worktree] @param {number} [now]
 */
export function buildPlan(
  candidate,
  architecture,
  acknowledgement,
  worktree = ROOT,
  now = Date.now(),
) {
  optIn(acknowledgement);
  assertRehearsalEnvironment(process.env);
  worktree = localInputPath(worktree);
  candidate = inside(join(worktree, PARENT), candidate);
  const metadata = JSON.parse(
    readOrdinary(
      join(candidate, 'private-rehearsal-inventory.json'),
      1024 * 1024,
    ).toString('utf8'),
  );
  assert.equal(metadata.worktree, worktree);
  assert.ok(
    metadata.privateOnly === true && metadata.publicationAllowed === false,
  );
  optIn(metadata.acknowledgement);
  assert.equal(metadata.publicKeySha256, PRODUCTION_PUBLIC_KEY_SHA256);
  // Inventory omissions must not turn tampered safety/installer files into
  // unchecked inputs. Whitelist paths before reading any inventory-named file.
  const mandatory = new Set([
    ...sourceInventory(worktree)
      .filter((file) => !file.path.startsWith('dist/'))
      .map((file) => file.path),
    ...extras,
  ]);
  assert.ok(
    typeof metadata.frontend === 'string' &&
      (metadata.frontend === 'apps/desktop/dist' ||
        metadata.frontend.startsWith('dist/test/')),
    'Invalid frontend inventory',
  );
  inside(worktree, join(worktree, metadata.frontend));
  /** @type {string[]} */
  const sourcePaths = metadata.source.map(
    (/** @type {{path: string}} */ file) => file.path,
  );
  assert.equal(
    new Set(sourcePaths).size,
    sourcePaths.length,
    'Duplicate source inventory',
  );
  for (const path of mandatory)
    assert.ok(sourcePaths.includes(path), 'Incomplete source inventory');
  for (const path of sourcePaths)
    assert.ok(
      mandatory.has(path) ||
        (path.startsWith(metadata.frontend + '/') &&
          /\.(html|js|css|json|svg|png|ico|woff2?)$/.test(path)),
      'Unexpected source inventory',
    );
  const expectedStaged = [
    ...mandatory,
    ...sourcePaths
      .filter((path) => !mandatory.has(path))
      .map(
        (path) =>
          'apps/desktop/dist/' + path.slice(metadata.frontend.length + 1),
      ),
    `${CRATE}/windows/generated/com.aiclipmemory.bridge.json`,
    'production-public-key.pub',
  ];
  assert.deepEqual(
    metadata.staged
      .map((/** @type {{path: string}} */ file) => file.path)
      .sort(),
    expectedStaged.sort(),
    'Incomplete or unexpected staged inventory',
  );
  for (const [parent, inventory] of [
    [worktree, metadata.source],
    [candidate, metadata.staged],
  ])
    for (const file of inventory) {
      assert.equal(
        hash(
          readOrdinary(
            inside(parent, join(parent, file.path)),
            16 * 1024 * 1024,
          ),
        ),
        file.sha256,
        'Candidate/source changed; do not build',
      );
    }
  const readConfig = (/** @type {string} */ parent) =>
    JSON.parse(
      readOrdinary(join(parent, CRATE, 'tauri.conf.json'), 16384).toString(
        'utf8',
      ),
    );
  const config = readConfig(candidate);
  const expected = configuration(
    readConfig(worktree),
    metadata.role,
    metadata.role === 'baseline'
      ? config.plugins.updater.endpoints[0]
      : undefined,
    metadata.policy,
    now,
  );
  assert.deepEqual(config, expected);
  assert.equal(metadata.version, config.version);
  const artifact = artifacts(config.version).find(
    (a) => a.architecture.toLowerCase() === architecture,
  );
  assert.ok(artifact, 'Unsupported architecture');
  assert.equal(
    readOrdinary(join(candidate, CRATE, 'src/updater/mod.rs')).toString('utf8'),
    rehearsalController(
      readOrdinary(join(worktree, CRATE, 'src/updater/mod.rs')).toString(
        'utf8',
      ),
    ),
  );
  assert.equal(
    readOrdinary(join(candidate, CRATE, 'build.rs')).toString('utf8'),
    rehearsalBuildScript(
      readOrdinary(join(worktree, CRATE, 'build.rs')).toString('utf8'),
    ),
  );
  const crate = join(candidate, CRATE);
  const cache = join(worktree, CRATE, 'target');
  ordinaryPath(cache);
  const env = {
    CARGO_TARGET_DIR: cache,
    CARGO_NET_OFFLINE: 'true',
    RUST_LOG: 'off',
    SLATE_PRIVATE_REHEARSAL_BUILD: ACKNOWLEDGEMENT,
  };
  return {
    privateOnly: true,
    publicationAllowed: false,
    profile: 'release',
    artifact,
    expectedBundle: join(
      cache,
      artifact.target,
      'release/bundle/nsis',
      `AI Clip Memory_${config.version}_${architecture}-setup.exe`,
    ),
    privateStagingPath: join(candidate, 'artifacts', artifact.filename),
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

if (
  process.argv[1] &&
  localInputPath(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    let result;
    if (process.argv[2] === 'prepare' && process.argv.length === 4) {
      const input = inside(join(ROOT, PARENT), process.argv[3]);
      assert.ok(input.endsWith('.json'));
      result = prepare(JSON.parse(readOrdinary(input, 16384).toString('utf8')));
    } else if (process.argv[2] === 'plan' && process.argv.length === 6) {
      result = buildPlan(process.argv[3], process.argv[4], process.argv[5]);
    } else throw new Error('Unsupported arguments');
    process.stdout.write(json(result));
  } catch {
    process.stderr.write(
      'Private production rehearsal rejected. Check acknowledgement, production trust, isolated paths, versions, snapshots and URL expiry. No build, signing, publication or installation was executed.\n',
    );
    process.exitCode = 1;
  }
}
