import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { validateManifestJson } from '../validate-desktop-update-release.mjs';

const api = await import('./prepare.mjs').catch(() => ({}));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const original = join(root, 'apps/desktop/src-tauri');
const read = (name) => readFileSync(join(original, name), 'utf8');
function historicalConfiguration() {
  const config = JSON.parse(read('tauri.conf.json'));
  delete config.plugins.updater;
  return config;
}
function historicalController() {
  return read('src/updater/mod.rs').replace(
    'installation_enabled: cfg!(windows) && driver.configured(),',
    'installation_enabled: false,',
  );
}

test('architecture contract keeps x64 and ARM64 artifact names and platform keys separate', () => {
  assert.equal(typeof api.architectureContract, 'function');
  for (const [architecture, target, platform] of [
    ['arm64', 'aarch64-pc-windows-msvc', 'windows-aarch64'],
    ['x64', 'x86_64-pc-windows-msvc', 'windows-x86_64'],
  ]) {
    const contract = api.architectureContract(architecture);
    assert.equal(contract.target, target);
    assert.equal(contract.platform, platform);
    assert.equal(
      contract.artifactName,
      `Slate-UPDATER-TEST-0.2.1-${architecture}-setup.exe`,
    );
    assert.equal(
      contract.artifactUrl,
      `https://127.0.0.1:17443/slate-e2e/${contract.artifactName}`,
    );
  }
  for (const architecture of ['x86', 'aarch64', '../x64', '']) {
    assert.throws(() => api.architectureContract(architecture));
  }
});

test('staged configuration preserves in-place identity and disables provisioning/build hooks', () => {
  assert.equal(
    typeof api.testConfiguration,
    'function',
    'TEST preparation is missing',
  );
  const source = historicalConfiguration();
  const before = JSON.stringify(source);
  const config = api.testConfiguration(
    source,
    '0.2.0',
    '../frontend',
    'PUBLIC',
  );
  assert.equal(JSON.stringify(source), before);
  assert.equal(config.productName, 'AI Clip Memory');
  assert.equal(config.identifier, 'com.aiclipmemory.desktop');
  assert.equal(config.version, '0.2.0');
  assert.equal(config.app.windows[0].title, 'Slate UPDATER TEST');
  assert.equal(config.build.beforeBuildCommand, '');
  assert.equal(config.build.frontendDist, '../frontend');
  assert.deepEqual(config.bundle.windows.webviewInstallMode, { type: 'skip' });
  assert.equal(config.bundle.windows.minimumWebview2Version, undefined);
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  assert.deepEqual(config.plugins.updater.endpoints, [
    'https://127.0.0.1:17443/slate-e2e/manifest.json',
  ]);
  assert.deepEqual(config.bundle.windows.nsis, source.bundle.windows.nsis);
  assert.throws(() =>
    api.testConfiguration(source, '0.3.0', 'C:/frontend', 'PUBLIC'),
  );
});

test('standalone frontend configuration rejects Windows drive URLs and other non-relative paths', () => {
  const source = historicalConfiguration();
  for (const path of [
    'C:/frontend',
    'C:\\frontend',
    '\\\\server\\frontend',
    '/frontend',
    'https://example.invalid/frontend',
    'file:///C:/frontend',
  ]) {
    assert.throws(
      () => api.testConfiguration(source, '0.2.0', path, 'PUBLIC'),
      /relative frontend directory/,
    );
  }
});

test('staged Rust changes enable exactly the anchored constructor, pin TLS and keep SDK version authentication', () => {
  assert.equal(typeof api.testRustSources, 'function');
  const input = {
    controller: historicalController(),
    driver: read('src/updater/tauri_driver.rs'),
    cargo: read('Cargo.toml'),
    lock: read('Cargo.lock'),
  };
  const result = api.testRustSources(input, '0.2.1');
  assert.match(result.controller, /installation_enabled: true,/);
  assert.match(input.controller, /installation_enabled: false,/);
  assert.match(result.driver, /\.no_proxy\(\)/);
  assert.match(result.driver, /tls_backend_native\(\)/);
  assert.match(result.driver, /tls_certs_only/);
  assert.match(result.driver, /include_bytes!\("\.\.\/\.\.\/e2e-ca\.pem"\)/);
  assert.match(result.driver, /secure_url\(attempt.url\(\)\)/);
  assert.match(result.driver, /require_signed_version: true/);
  assert.match(result.driver, /url.port\(\) == Some\(17443\)/);
  assert.match(
    result.cargo,
    /reqwest = \{ version = "=0.13.4", default-features = false, features = \["native-tls"\] \}/,
  );
  assert.match(
    result.lock,
    /name = "ai-clip-memory-desktop"\r?\nversion = "0.2.1"/,
  );
  assert.match(result.lock, /"reqwest",/);
  assert.throws(
    () =>
      api.testRustSources(
        {
          ...input,
          controller: input.controller.replace(
            'installation_enabled: false,',
            'installation_enabled: true,',
          ),
        },
        '0.2.0',
      ),
    /anchor/,
  );
  assert.throws(
    () =>
      api.testRustSources(
        {
          ...input,
          driver:
            input.driver +
            '\n.configure_client(|client| client.https_only(true))',
        },
        '0.2.0',
      ),
    /anchor/,
  );
});

test('TEST URL policy accepts only canonical fixed origin and prefix', () => {
  assert.equal(typeof api.assertTestUrl, 'function');
  for (const value of [api.MANIFEST_URL, api.ARTIFACT_URL])
    assert.doesNotThrow(() => api.assertTestUrl(value));
  for (const value of [
    'http://127.0.0.1:17443/slate-e2e/manifest.json',
    'https://localhost:17443/slate-e2e/manifest.json',
    'https://127.0.0.1:17444/slate-e2e/manifest.json',
    'https://127.0.0.1:17443/slate-e2e/a?x',
    'https://127.0.0.1:17443/slate-e2e/a#x',
    'https://127.0.0.1:17443/slate-e2e/%2e%2e/evil',
    'https://tryslate.tech/updates/windows/latest.json',
  ])
    assert.throws(() => api.assertTestUrl(value));
});

test('production release contract rejects loopback endpoints and TEST asset names', () => {
  const signature = readFileSync(
    join(root, 'dist/test/updater-disposable-signing/synthetic-arm64.txt.sig'),
    'utf8',
  ).trim();
  const entry = (architecture) => ({
    url: `https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-${architecture}.exe`,
    signature,
  });
  const manifest = {
    version: '0.2.0',
    notes: 'Public-only structural validation fixture',
    pub_date: '2026-10-15T00:00:00Z',
    platforms: {
      'windows-x86_64': entry('x64'),
      'windows-aarch64': entry('ARM64'),
    },
  };
  assert.doesNotThrow(() =>
    validateManifestJson(JSON.stringify(manifest), '0.2.0'),
  );
  for (const url of [
    api.ARTIFACT_URL,
    'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-UPDATER-TEST-0.2.0-arm64-setup.exe',
  ]) {
    const candidate = JSON.parse(JSON.stringify(manifest));
    candidate.platforms['windows-aarch64'].url = url;
    assert.throws(() =>
      validateManifestJson(JSON.stringify(candidate), '0.2.0'),
    );
  }
});

test('public native messaging manifest is derived freshly and rejects reused IDs', () => {
  assert.equal(typeof api.nativeManifest, 'function');
  const template = JSON.parse(
    read('windows/native-messaging-host.json.template'),
  );
  const extension = JSON.parse(
    readFileSync(join(root, 'apps/extension/public/manifest.json')),
  );
  const identity = JSON.parse(
    readFileSync(join(root, 'apps/extension/release-identity.json')),
  );
  const manifest = api.nativeManifest(template, extension, identity);
  const expectedId = [
    ...createHash('sha256')
      .update(Buffer.from(extension.key, 'base64'))
      .digest()
      .subarray(0, 16),
  ]
    .map((x) => 'abcdefghijklmnop'[x >> 4] + 'abcdefghijklmnop'[x & 15])
    .join('');
  assert.deepEqual(
    manifest.allowed_origins,
    [
      expectedId,
      identity.chromeWebStoreExtensionId,
      identity.edgeExtensionId,
    ].map((x) => `chrome-extension://${x}/`),
  );
  assert.equal(manifest.path, 'ai-clip-memory-native-host.exe');
  assert.throws(() =>
    api.nativeManifest(template, extension, {
      ...identity,
      edgeExtensionId: expectedId,
    }),
  );
});

test('safe file handling reads ordinary files and rejects overwrites', () => {
  assert.equal(typeof api.readOrdinary, 'function');
  const directory = mkdtempSync(join(root, 'dist/test/updater-e2e-safety-'));
  const file = join(directory, 'test.txt');
  api.writeNew(file, 'one');
  assert.equal(api.readOrdinary(file).toString(), 'one');
  assert.throws(() => api.writeNew(file, 'two'), /exist|EEXIST/);
});

test('hardlinked inputs are rejected when the host permits creating the negative fixture', (t) => {
  const directory = mkdtempSync(join(root, 'dist/test/updater-e2e-hardlink-'));
  const file = join(directory, 'test.txt');
  writeFileSync(file, 'TEST');
  try {
    linkSync(file, join(directory, 'hardlink.txt'));
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip(
        'Managed filesystem denies creation of hardlink negative fixtures',
      );
      return;
    }
    throw error;
  }
  assert.throws(() => api.readOrdinary(file), /linked|ordinary/);
});

test('source inventory excludes generated outputs and rejects private or executable files', () => {
  assert.equal(typeof api.sourceInventory, 'function');
  const files = api.sourceInventory(root);
  assert.ok(
    files.some(
      (x) => x.path === 'apps/desktop/src-tauri/src/updater/tauri_driver.rs',
    ),
  );
  assert.ok(
    files.every(
      (x) =>
        !/(?:node_modules|target|\/gen\/|\/generated\/|\.exe$|\.key$)/i.test(
          x.path,
        ),
    ),
  );
  assert.ok(files.every((x) => /^[A-F0-9]{64}$/.test(x.sha256)));
});

test('preparation rejects an unexpected SDK pin before creating any staged tree', () => {
  const input = {
    controller: historicalController(),
    driver: read('src/updater/tauri_driver.rs'),
    cargo: read('Cargo.toml').replace('=2.13.3', '=2.13.4'),
    lock: read('Cargo.lock'),
  };
  assert.throws(() => api.testRustSources(input, '0.2.0'), /pinned SDK/);
});

test('A1 rejects an actual signed artifact authenticated for a different version', async () => {
  const directory = mkdtempSync(
    join(root, 'dist/test/updater-e2e-a1-negative-'),
  );
  const fixture = join(
    root,
    'dist/test/updater-disposable-signing/synthetic-arm64.txt',
  );
  writeFileSync(join(directory, api.ARTIFACT_NAME), readFileSync(fixture));
  writeFileSync(
    join(directory, `${api.ARTIFACT_NAME}.sig`),
    readFileSync(`${fixture}.sig`),
  );
  await assert.rejects(
    api.writeVerifiedManifest({ worktree: root, directory }),
    /A1.*verification failed/,
  );
  assert.equal(existsSync(join(directory, 'manifest.json')), false);
  assert.equal(existsSync(join(directory, 'a1-verification.json')), false);
});

test('CA validation rejects expired certificates and private transport material', () => {
  assert.equal(typeof api.validateTestCa, 'function');
  const parent = join(root, 'dist/test/updater-sdk-transport');
  const caPath = readdirSync(parent)
    .map((name) => join(parent, name, 'ca.pem'))
    .find((path) => existsSync(path));
  const ca = readFileSync(caPath);
  assert.throws(
    () => api.validateTestCa(ca, Date.parse('2099-01-01')),
    /validity/,
  );
  assert.throws(
    () => api.validateTestCa(Buffer.from('-----BEGIN PRIVATE KEY-----\nTEST')),
    /public/,
  );
});

test('Windows metadata audit checks exact input ancestors without following linked package directories', () => {
  assert.equal(typeof api.auditWindowsPaths, 'function');
  assert.doesNotThrow(() => api.auditWindowsPaths([root]));
  assert.throws(
    () => api.auditWindowsPaths(['https://example.invalid/file']),
    /ordinary local/,
  );
  assert.throws(
    () =>
      api.auditWindowsPaths([
        join(root, 'apps/desktop/node_modules/@tauri-apps/cli'),
      ]),
    /reparse|Linked/,
  );
});

test('unsigned manifest preparation refuses before output creation', async () => {
  assert.equal(typeof api.writeVerifiedManifest, 'function');
  const directory = mkdtempSync(join(root, 'dist/test/updater-e2e-unsigned-'));
  const artifact = join(directory, api.ARTIFACT_NAME);
  writeFileSync(artifact, 'unsigned TEST fixture');
  await assert.rejects(
    api.writeVerifiedManifest({ worktree: root, directory }),
    /signature|ENOENT/,
  );
  assert.equal(existsSync(join(directory, 'manifest.json')), false);
  assert.equal(existsSync(join(directory, 'a1-verification.json')), false);
});

test('server refuses unsigned inputs before reading TLS credentials or binding', async () => {
  assert.equal(typeof api.serveVerified, 'function');
  const directory = mkdtempSync(join(root, 'dist/test/updater-e2e-server-'));
  await assert.rejects(
    api.serveVerified({
      worktree: root,
      directory,
      tlsCert: 'forbidden',
      tlsKey: 'forbidden',
    }),
    /ENOENT|signature/,
  );
});

test('preparation creates two fresh staged Rust trees with a source hash inventory and no production changes', () => {
  assert.equal(typeof api.prepareStages, 'function');
  const baseline = api.sourceInventory(root);
  const directories = readdirSync(
    join(root, 'dist/test/updater-e2e-transport'),
  );
  const ca = directories
    .map((name) =>
      join(root, 'dist/test/updater-e2e-transport', name, 'ca.pem'),
    )
    .filter((path) => existsSync(path))
    .find((path) => {
      try {
        api.validateTestCa(readFileSync(path));
        return true;
      } catch {
        return false;
      }
    });
  assert.ok(
    ca,
    'Existing public TEST CA fixture is required; no keys or certificates are generated',
  );
  // Exercise historical preparation against an explicit unconfigured copy,
  // never replace the now-configured production trust in the real worktree.
  const historicalRoot = mkdtempSync(
    join(root, 'dist/test/updater-e2e-source-'),
  );
  for (const { path } of baseline) {
    const destination = join(historicalRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, path), destination);
  }
  writeFileSync(
    join(historicalRoot, 'apps/desktop/src-tauri/tauri.conf.json'),
    JSON.stringify(historicalConfiguration()),
  );
  writeFileSync(
    join(historicalRoot, 'apps/desktop/src-tauri/src/updater/mod.rs'),
    historicalController(),
  );
  const historicalCa = join(historicalRoot, 'dist/test/ca.pem');
  mkdirSync(dirname(historicalCa), { recursive: true });
  copyFileSync(ca, historicalCa);
  const historicalInventory = api.sourceInventory(historicalRoot);
  const frontend = mkdtempSync(
    join(historicalRoot, 'dist/test/updater-e2e-frontend-'),
  );
  writeFileSync(
    join(frontend, 'index.html'),
    '<!doctype html><title>TEST</title>',
  );
  for (const architecture of ['arm64', 'x64']) {
    const result = api.prepareStages({
      worktree: historicalRoot,
      caPemPath: historicalCa,
      frontendDist: frontend,
      architecture,
    });
    assert.ok(
      result.directory.startsWith(
        join(historicalRoot, `dist/test/updater-e2e-${architecture}/run-`),
      ),
    );
    assert.equal(
      result.artifactName,
      api.architectureContract(architecture).artifactName,
    );
    assert.equal(
      result.platform,
      api.architectureContract(architecture).platform,
    );
    assert.equal(result.installationRequiresSeparateApproval, true);
    for (const stage of result.versions) {
      const config = JSON.parse(
        readFileSync(join(stage.path, 'tauri.conf.json')),
      );
      assert.equal(config.version, stage.version);
      assert.equal(isAbsolute(config.build.frontendDist), false);
      assert.equal(URL.canParse(config.build.frontendDist), false);
      assert.equal(config.build.frontendDist.includes('\\'), false);
      assert.equal(resolve(stage.path, config.build.frontendDist), frontend);
      assert.match(
        readFileSync(join(stage.path, 'src/updater/mod.rs'), 'utf8'),
        /installation_enabled: true,/,
      );
      assert.ok(
        existsSync(
          join(stage.path, 'windows/generated/com.aiclipmemory.bridge.json'),
        ),
      );
      assert.ok(
        !existsSync(join(stage.path, 'target')) &&
          !existsSync(join(stage.path, 'node_modules')) &&
          !existsSync(join(stage.path, 'gen')),
      );
    }
    assert.deepEqual(api.sourceInventory(root), baseline);
    assert.deepEqual(api.sourceInventory(historicalRoot), historicalInventory);
    assert.ok(existsSync(join(result.directory, 'source-inventory.json')));
  }
});
