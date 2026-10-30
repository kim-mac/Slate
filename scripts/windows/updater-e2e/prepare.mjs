// TEST ONLY. No build, signing, updater-private-key, installer launch or system configuration API.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile, spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { clearInterval, setInterval } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { assertCleanEnvironment } from '../disposable-test-signing.mjs';
import { localInputPath } from '../validate-desktop-update-release.mjs';

const execute = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRATE = 'apps/desktop/src-tauri';
const PUBLIC_KEY =
  'dist/test/updater-disposable-signing/disposable-test.key.pub';
export const ARTIFACT_NAME = 'Slate-UPDATER-TEST-0.2.1-arm64-setup.exe';
export const MANIFEST_URL = 'https://127.0.0.1:17443/slate-e2e/manifest.json';
export const ARTIFACT_URL = `https://127.0.0.1:17443/slate-e2e/${ARTIFACT_NAME}`;
export function architectureContract(architecture = 'arm64') {
  assert.ok(
    ['arm64', 'x64'].includes(architecture),
    'Unsupported TEST architecture',
  );
  const artifactName = `Slate-UPDATER-TEST-0.2.1-${architecture}-setup.exe`;
  return {
    architecture,
    target:
      architecture === 'arm64'
        ? 'aarch64-pc-windows-msvc'
        : 'x86_64-pc-windows-msvc',
    platform: architecture === 'arm64' ? 'windows-aarch64' : 'windows-x86_64',
    artifactName,
    artifactUrl: `https://127.0.0.1:17443/slate-e2e/${artifactName}`,
  };
}
const sha = (bytes) =>
  createHash('sha256').update(bytes).digest('hex').toUpperCase();
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function inside(parent, path) {
  path = localInputPath(path);
  const rel = relative(resolve(parent), path);
  assert.ok(
    rel &&
      !isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith(`..\\`) &&
      !rel.startsWith('../'),
    'Expected a path inside the TEST directory',
  );
  return path;
}

// Refuse symlinks/junctions, canonical aliases and hardlinks. This is a cooperative
// local preparation tool; source hashes are checked again after copying.
export function ordinaryPath(path) {
  path = localInputPath(path);
  const parent = dirname(path);
  if (parent !== path) ordinaryPath(parent);
  let info;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const canonical = realpathSync(path);
  assert.ok(
    !info.isSymbolicLink() &&
      (process.platform === 'win32'
        ? canonical.toLowerCase() === path.toLowerCase()
        : canonical === path),
    'Linked or redirected path rejected',
  );
  if (info.isFile())
    assert.equal(info.nlink, 1, 'Hardlinked file is not ordinary');
}

export function auditWindowsPaths(paths) {
  const ancestors = new Set();
  for (const input of paths) {
    let path = localInputPath(input);
    ordinaryPath(path);
    while (!ancestors.has(path)) {
      ancestors.add(path);
      const parent = dirname(path);
      if (parent === path) break;
      path = parent;
    }
  }
  if (process.platform !== 'win32') return;
  // Constant read-only script; exact paths are JSON stdin data, never shell code.
  // GetAttributes detects reparse types beyond symlinks/junctions exposed by Node.
  const script = `$ErrorActionPreference = 'Stop'
try {
  $testPaths = [Console]::In.ReadToEnd() | ConvertFrom-Json
  foreach ($testPath in $testPaths) {
    $testAttributes = [System.IO.File]::GetAttributes($testPath)
    if (($testAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 2 }
  }
  exit 0
} catch { exit 3 }`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/KEY|PASS|TOKEN|SECRET|CREDENTIAL|^NODE_OPTIONS$/i.test(name),
    ),
  );
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      input: JSON.stringify([...ancestors]),
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 30_000,
      maxBuffer: 16_384,
      env,
    },
  );
  assert.ok(
    !result.error && result.status === 0,
    'Windows reparse/ancestor metadata audit failed',
  );
}

export function readOrdinary(path, limit = 512 * 1024 * 1024) {
  ordinaryPath(path);
  const before = lstatSync(path);
  assert.ok(
    before.isFile() &&
      before.nlink === 1 &&
      before.size > 0 &&
      before.size <= limit,
    'Expected an ordinary bounded file',
  );
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  assert.ok(
    before.ino === after.ino &&
      before.size === bytes.length &&
      before.mtimeMs === after.mtimeMs &&
      after.nlink === 1,
    'File changed while reading',
  );
  return bytes;
}

export function writeNew(path, bytes) {
  ordinaryPath(path);
  ordinaryPath(dirname(path));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: 'wx' });
}

export function assertTestUrl(value) {
  const url = new URL(value);
  assert.ok(
    url.href === value &&
      url.protocol === 'https:' &&
      url.hostname === '127.0.0.1' &&
      url.port === '17443' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith('/slate-e2e/') &&
      !url.pathname.includes('%') &&
      !url.pathname.includes('\\'),
    'Not a fixed loopback TEST URL',
  );
}

function version(value) {
  assert.ok(
    ['0.2.0', '0.2.1'].includes(value),
    'Only the two TEST versions are allowed',
  );
}
function replaceOne(source, anchor, replacement) {
  assert.equal(
    source.split(anchor).length - 1,
    1,
    `Expected exactly one source anchor: ${anchor.slice(0, 80)}`,
  );
  return source.replace(anchor, replacement);
}

export function testConfiguration(
  source,
  testVersion,
  frontendDist,
  publicKey,
) {
  version(testVersion);
  assert.equal(source.version, '0.3.0');
  assert.equal(source.productName, 'AI Clip Memory');
  assert.equal(source.identifier, 'com.aiclipmemory.desktop');
  assert.ok(
    !source.plugins?.updater && !source.bundle?.createUpdaterArtifacts,
    'Production updater must be unconfigured',
  );
  assert.ok(
    typeof frontendDist === 'string' &&
      frontendDist.length > 0 &&
      !isAbsolute(frontendDist) &&
      !URL.canParse(frontendDist) &&
      !frontendDist.includes('\\'),
    'Expected a relative frontend directory, not a Windows drive URL',
  );
  const config = JSON.parse(JSON.stringify(source));
  config.version = testVersion;
  config.build.beforeBuildCommand = '';
  config.build.beforeDevCommand = '';
  config.build.frontendDist = frontendDist;
  config.app.windows.find((window) => window.label === 'main').title =
    'Slate UPDATER TEST';
  config.bundle.createUpdaterArtifacts = false; // Signing is a separate, manual gate.
  config.bundle.windows.webviewInstallMode = { type: 'skip' };
  delete config.bundle.windows.minimumWebview2Version;
  delete config.bundle.windows.minimumWebView2Version;
  delete config.bundle.windows.signCommand;
  delete config.bundle.windows.certificateThumbprint;
  config.plugins = {
    ...config.plugins,
    updater: {
      pubkey: publicKey,
      endpoints: [MANIFEST_URL],
      requireSignedVersion: true,
      allowDowngrades: false,
      dangerousInsecureTransportProtocol: false,
      dangerousAcceptInvalidCerts: false,
      dangerousAcceptInvalidHostnames: false,
    },
  };
  return config;
}

export function testRustSources(input, testVersion) {
  version(testVersion);
  assert.match(
    input.cargo,
    /tauri-plugin-updater = \{ version = "=2\.13\.3",/,
    'Expected pinned SDK 2.13.3',
  );
  assert.match(
    input.cargo,
    /tauri = \{ version = "=2\.12\.3",/,
    'Expected pinned SDK Tauri 2.12.3',
  );
  const controller = replaceOne(
    input.controller,
    '                    installation_enabled: false,',
    '                    installation_enabled: true,',
  );
  let driver = input.driver.replace(/\r\n/g, '\n');
  driver = replaceOne(
    driver,
    'use url::Url;',
    'use url::Url;\nuse reqwest::{redirect::Policy, Certificate};',
  );
  driver = replaceOne(
    driver,
    '        && url.host_str().is_some()',
    `        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(17443)
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path().starts_with("/slate-e2e/")
        && !url.path().contains('%')
        && !url.path().contains('\\\\')`,
  );
  driver = replaceOne(
    driver,
    '            config.ok_or(SafeError::CHECK_FAILED)?;',
    `            config.ok_or(SafeError::CHECK_FAILED)?;
            let certificate = Certificate::from_pem(include_bytes!("../../e2e-ca.pem"))
                .map_err(|_| SafeError::CHECK_FAILED)?;`,
  );
  driver = replaceOne(
    driver,
    '                .timeout(REQUEST_TIMEOUT)',
    '                .timeout(REQUEST_TIMEOUT)\n                .no_proxy()',
  );
  driver = replaceOne(
    driver,
    '.configure_client(|client| client.https_only(true))',
    `.configure_client(move |client| {
                    client
                        .tls_backend_native()
                        .tls_certs_only([certificate.clone()])
                        .https_only(true)
                        .redirect(Policy::custom(|attempt| {
                            if attempt.previous().len() <= 3 && secure_url(attempt.url()) {
                                attempt.follow()
                            } else {
                                attempt.error("TEST redirect policy")
                            }
                        }))
                })`,
  );
  let cargo = replaceOne(
    input.cargo,
    'version = "0.3.0"',
    `version = "${testVersion}"`,
  );
  assert.ok(
    !/^reqwest\s*=/m.test(cargo),
    'Direct reqwest already exists; review source',
  );
  cargo = replaceOne(
    cargo,
    '[dependencies]',
    '[dependencies]\nreqwest = { version = "=0.13.4", default-features = false, features = ["native-tls"] }',
  );
  assert.match(input.lock, /name = "reqwest"\r?\nversion = "0.13.4"/);
  let lock = replaceOne(
    input.lock,
    'name = "ai-clip-memory-desktop"\nversion = "0.3.0"'.replaceAll(
      '\n',
      input.lock.includes('\r\n') ? '\r\n' : '\n',
    ),
    `name = "ai-clip-memory-desktop"\nversion = "${testVersion}"`.replaceAll(
      '\n',
      input.lock.includes('\r\n') ? '\r\n' : '\n',
    ),
  );
  const rootPackage = /name = "ai-clip-memory-desktop"[\s\S]*?\n\]/.exec(
    lock,
  )?.[0];
  assert.ok(rootPackage && !rootPackage.includes(' "reqwest",'));
  lock = replaceOne(
    lock,
    rootPackage,
    rootPackage.replace(' "rusqlite",', ' "reqwest",\n "rusqlite",'),
  );
  return { controller, driver, cargo, lock };
}

export function nativeManifest(template, extension, identity) {
  assert.equal(template.name, 'com.aiclipmemory.bridge');
  assert.equal(template.path, 'ai-clip-memory-native-host.exe');
  assert.equal(template.type, 'stdio');
  assert.ok(
    extension.key &&
      Buffer.from(extension.key, 'base64').toString('base64') === extension.key,
    'Expected extension public key',
  );
  const digest = createHash('sha256')
    .update(Buffer.from(extension.key, 'base64'))
    .digest();
  const devId = [...digest.subarray(0, 16)]
    .map((x) => 'abcdefghijklmnop'[x >> 4] + 'abcdefghijklmnop'[x & 15])
    .join('');
  const ids = [
    devId,
    identity.chromeWebStoreExtensionId,
    identity.edgeExtensionId,
  ];
  assert.ok(
    ids.every((id) => /^[a-p]{32}$/.test(id)) && new Set(ids).size === 3,
    'Expected three distinct extension IDs',
  );
  return {
    ...template,
    allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
  };
}

export function sourceInventory(worktree = ROOT) {
  const files = [];
  function visit(path) {
    ordinaryPath(path);
    const info = lstatSync(path);
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (name === 'generated') continue;
        visit(join(path, name));
      }
      return;
    }
    assert.ok(
      /\.(?:rs|sql|ico|png|json|toml|lock|nsh|nsi|template)$/.test(path),
      'Unexpected source file; no binaries or private material may be copied',
    );
    const bytes = readOrdinary(path, 16 * 1024 * 1024);
    files.push({
      path: relative(worktree, path).replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: sha(bytes),
    });
  }
  for (const name of [
    'Cargo.toml',
    'Cargo.lock',
    'build.rs',
    'tauri.conf.json',
    'src',
    'migrations',
    'icons',
    'capabilities',
    'permissions',
    'windows',
  ])
    visit(join(worktree, CRATE, name));
  for (const name of [
    PUBLIC_KEY,
    'apps/extension/public/manifest.json',
    'apps/extension/release-identity.json',
  ]) {
    const bytes = readOrdinary(join(worktree, name), 16_384);
    files.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
  }
  auditWindowsPaths(files.map((file) => join(worktree, file.path)));
  return files;
}

export function validateTestCa(ca, now = Date.now()) {
  assert.match(
    ca.toString(),
    /^-----BEGIN CERTIFICATE-----\r?\n/,
    'CA input must be a public certificate',
  );
  assert.ok(
    !ca.toString().includes('PRIVATE KEY'),
    'CA input must be public only',
  );
  const certificate = new X509Certificate(ca);
  assert.ok(certificate.ca, 'Expected a TEST root CA certificate');
  assert.ok(
    Date.parse(certificate.validFrom) <= now &&
      now < Date.parse(certificate.validTo),
    'TEST CA validity window must include the current time',
  );
  return certificate;
}

export function prepareStages({
  worktree = ROOT,
  caPemPath,
  frontendDist,
  architecture = 'arm64',
}) {
  assertCleanEnvironment(process.env);
  const contract = architectureContract(architecture);
  worktree = localInputPath(worktree);
  caPemPath = inside(join(worktree, 'dist/test'), caPemPath);
  frontendDist = inside(worktree, frontendDist);
  auditWindowsPaths([caPemPath, frontendDist, join(worktree, PUBLIC_KEY)]);
  ordinaryPath(frontendDist);
  readOrdinary(join(frontendDist, 'index.html'), 8 * 1024 * 1024);
  const ca = readOrdinary(caPemPath, 16_384);
  validateTestCa(ca);
  const publicKey = readOrdinary(join(worktree, PUBLIC_KEY), 16_384)
    .toString()
    .trim();
  assert.ok(
    publicKey &&
      Buffer.from(publicKey, 'base64').toString('base64') === publicKey,
    'Expected public signing key',
  );
  const sources = sourceInventory(worktree);
  const load = (name) => readOrdinary(join(worktree, CRATE, name)).toString();
  const input = {
    controller: load('src/updater/mod.rs'),
    driver: load('src/updater/tauri_driver.rs'),
    cargo: load('Cargo.toml'),
    lock: load('Cargo.lock'),
  };
  const originalConfig = JSON.parse(load('tauri.conf.json'));
  const generated = nativeManifest(
    JSON.parse(load('windows/native-messaging-host.json.template')),
    JSON.parse(
      readOrdinary(join(worktree, 'apps/extension/public/manifest.json')),
    ),
    JSON.parse(
      readOrdinary(join(worktree, 'apps/extension/release-identity.json')),
    ),
  );
  const transformations = ['0.2.0', '0.2.1'].map((v) => ({
    v,
    rust: testRustSources(input, v),
  }));
  const parent = join(worktree, `dist/test/updater-e2e-${architecture}`);
  ordinaryPath(parent);
  mkdirSync(parent, { recursive: true });
  auditWindowsPaths([parent]);
  const directory = mkdtempSync(join(parent, 'run-'));
  writeNew(
    join(directory, 'source-inventory.json'),
    json({
      testOnly: true,
      sources,
      ca: { path: relative(worktree, caPemPath), sha256: sha(ca) },
      frontendDist,
      frontendIndexSha256: sha(readOrdinary(join(frontendDist, 'index.html'))),
    }),
  );
  const stages = [];
  for (const { v, rust } of transformations) {
    const stage = join(directory, v, 'src-tauri');
    // Tauri tries URL deserialization first: C:\\... is a c: URL, not an
    // embedded-assets directory. Resolve from this copied config's directory.
    const config = testConfiguration(
      originalConfig,
      v,
      relative(stage, frontendDist).replaceAll('\\', '/'),
      publicKey,
    );
    const changed = new Map([
      ['src/updater/mod.rs', rust.controller],
      ['src/updater/tauri_driver.rs', rust.driver],
      ['Cargo.toml', rust.cargo],
      ['Cargo.lock', rust.lock],
      ['tauri.conf.json', json(config)],
    ]);
    for (const item of sources.filter((item) =>
      item.path.startsWith(`${CRATE}/`),
    )) {
      const name = item.path.slice(CRATE.length + 1);
      const bytes = readOrdinary(join(worktree, item.path));
      assert.equal(
        sha(bytes),
        item.sha256,
        'Source changed during preparation',
      );
      writeNew(join(stage, name), changed.get(name) ?? bytes);
    }
    writeNew(join(stage, 'e2e-ca.pem'), ca);
    writeNew(
      join(stage, 'windows/generated/com.aiclipmemory.bridge.json'),
      json(generated),
    );
    stages.push({ version: v, path: stage });
  }
  assert.deepEqual(
    sourceInventory(worktree),
    sources,
    'Original sources changed during preparation',
  );
  const policy = {
    ...contract,
    testOnly: true,
    inPlaceIdentity: originalConfig.identifier,
    runtimeInstallationEnabledOnlyInCopies: true,
    versions: stages,
    endpoint: MANIFEST_URL,
    productionPublishingAllowed: false,
    installationRequiresSeparateApproval: true,
    sharedTarget: join(worktree, CRATE, 'target'),
  };
  writeNew(join(directory, 'TEST-POLICY.json'), json(policy));
  return { directory, ...policy };
}

function manifestDirectory(worktree, directory) {
  directory = inside(join(worktree, 'dist/test'), directory);
  ordinaryPath(directory);
  return directory;
}

async function authenticatedArtifact({
  worktree = ROOT,
  directory,
  architecture = 'arm64',
}) {
  assertCleanEnvironment(process.env);
  const contract = architectureContract(architecture);
  directory = manifestDirectory(worktree, directory);
  const artifact = join(directory, contract.artifactName);
  const signaturePath = `${artifact}.sig`;
  const signatureBytes = readOrdinary(signaturePath, 16_384); // Refuse unsigned before any executable or TLS access.
  const bytes = readOrdinary(artifact);
  const publicKeyPath = join(worktree, PUBLIC_KEY);
  auditWindowsPaths([directory, artifact, signaturePath, publicKeyPath]);
  const key = readOrdinary(publicKeyPath, 16_384);
  assert.ok(
    ['arm64', 'x64'].includes(process.arch),
    'Expected Windows ARM64 or x64 Node',
  );
  const verifier = join(
    worktree,
    `scripts/windows/update-signature-verifier/target/${architectureContract(process.arch).target}/debug/slate-update-signature-verifier.exe`,
  );
  // Cargo intentionally hardlinks this executable to its deps artifact. That one
  // known compiler-output path is not a copy source or updater payload input.
  ordinaryPath(dirname(verifier));
  const verifierInfo = lstatSync(verifier);
  assert.ok(
    verifierInfo.isFile() &&
      !verifierInfo.isSymbolicLink() &&
      realpathSync(verifier).toLowerCase() === resolve(verifier).toLowerCase(),
    'Expected canonical Cargo verifier',
  );
  const verifierBytes = readFileSync(verifier);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/KEY|PASS|TOKEN|SECRET|CREDENTIAL|^NODE_OPTIONS$/i.test(name),
    ),
  );
  let report;
  try {
    const result = await execute(
      verifier,
      [
        '--public-key',
        publicKeyPath,
        '--artifact',
        artifact,
        '--signature',
        signaturePath,
        '--expected-version',
        '0.2.1',
      ],
      {
        windowsHide: true,
        shell: false,
        env,
        timeout: 30_000,
        maxBuffer: 65_536,
      },
    );
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      'STOP: A1 public-key artifact/version signature verification failed',
    );
  }
  assert.equal(report.verified, true, 'A1 required');
  assert.equal(report.version, '0.2.1');
  assert.equal(report.bytes, bytes.length);
  assert.equal(report.artifactSha256, sha(bytes));
  assert.equal(report.signatureSha256, sha(signatureBytes));
  assert.equal(
    report.publicKeySha256,
    sha(Buffer.from(key.toString().trim(), 'base64')),
  );
  assert.equal(
    sha(readOrdinary(artifact)),
    sha(bytes),
    'Artifact changed during A1',
  );
  assert.equal(
    sha(readFileSync(verifier)),
    sha(verifierBytes),
    'Verifier changed during A1',
  );
  const signature = signatureBytes.toString().trim();
  assert.ok(
    signature &&
      Buffer.from(signature, 'base64').toString('base64') === signature,
    'Expected genuine base64 signature',
  );
  const manifest = {
    version: '0.2.1',
    notes: 'Slate local UPDATER TEST only. Do not publish.',
    platforms: {
      [contract.platform]: { url: contract.artifactUrl, signature },
    },
  };
  assertTestUrl(contract.artifactUrl);
  return {
    contract,
    directory,
    bytes,
    manifest,
    a1: { testOnly: true, ...report, verifierSha256: sha(verifierBytes) },
  };
}

export async function writeVerifiedManifest(options) {
  const verified = await authenticatedArtifact(options);
  writeNew(join(verified.directory, 'a1-verification.json'), json(verified.a1));
  writeNew(join(verified.directory, 'manifest.json'), json(verified.manifest));
  return verified.a1;
}

export async function serveVerified(options) {
  const verified = await authenticatedArtifact(options);
  assert.deepEqual(
    JSON.parse(readOrdinary(join(verified.directory, 'manifest.json'))),
    verified.manifest,
    'Manifest must match freshly authenticated A1 inputs',
  );
  assert.deepEqual(
    JSON.parse(readOrdinary(join(verified.directory, 'a1-verification.json'))),
    verified.a1,
    'A1 evidence must match',
  );
  const certPath = inside(
    join(options.worktree ?? ROOT, 'dist/test'),
    options.tlsCert,
  );
  const keyPath = inside(
    join(options.worktree ?? ROOT, 'dist/test'),
    options.tlsKey,
  );
  assert.equal(
    certPath.slice(-10),
    'server.pem',
    'Only an explicit TEST TLS server certificate may be read',
  );
  assert.equal(
    keyPath.slice(-10),
    'server.key',
    'Only an explicit TEST TLS server key may be read',
  );
  const cert = readOrdinary(certPath, 16_384);
  auditWindowsPaths([certPath, keyPath]);
  const key = readOrdinary(keyPath, 16_384); // TLS transport key only; never updater signing material.
  const manifest = Buffer.from(json(verified.manifest));
  const counts = { manifest: 0, artifact: 0, chunks: 0 };
  const server = createServer(
    { cert, key, minVersion: 'TLSv1.2' },
    (req, res) => {
      if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:17443') {
        res.writeHead(404).end();
        return;
      }
      const path = req.url;
      if (path === '/slate-e2e/manifest.json') {
        counts.manifest++;
        res
          .writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Length': manifest.length,
            'Cache-Control': 'no-store',
          })
          .end(manifest);
      } else if (path === `/slate-e2e/${verified.contract.artifactName}`) {
        counts.artifact++;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': verified.bytes.length,
          'Cache-Control': 'no-store',
        });
        let offset = 0;
        const timer = setInterval(() => {
          if (res.destroyed) {
            clearInterval(timer);
            return;
          }
          const end = Math.min(offset + 256 * 1024, verified.bytes.length);
          res.write(verified.bytes.subarray(offset, end));
          counts.chunks++;
          offset = end;
          if (offset === verified.bytes.length) {
            clearInterval(timer);
            res.end();
          }
        }, 20);
        res.once('close', () => clearInterval(timer));
      } else res.writeHead(404).end();
    },
  );
  server.on('tlsClientError', () => {});
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(17443, '127.0.0.1', ready);
  });
  return { server, counts };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'prepare' && [2, 3].includes(args.length))
      process.stdout.write(
        json(
          prepareStages({
            caPemPath: args[0],
            frontendDist: args[1],
            architecture: args[2],
          }),
        ),
      );
    else if (action === 'manifest' && [1, 2].includes(args.length))
      process.stdout.write(
        json(
          await writeVerifiedManifest({
            directory: args[0],
            architecture: args[1],
          }),
        ),
      );
    else if (action === 'serve' && [3, 4].includes(args.length)) {
      await serveVerified({
        directory: args[0],
        tlsCert: args[1],
        tlsKey: args[2],
        architecture: args[3],
      });
      process.stdout.write(`TEST HTTPS listening only at ${MANIFEST_URL}\n`);
    } else
      throw new Error(
        'Usage: prepare.mjs prepare <public-test-ca.pem> <existing-frontend-dist> [arm64|x64] | manifest <TEST-output-dir> [arm64|x64] | serve <TEST-output-dir> <server.pem> <server.key> [arm64|x64]',
      );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
