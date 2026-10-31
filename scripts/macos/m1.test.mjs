import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

test('diagnostic bootstrap pins reviewed source and bounds CI cost without binary publication', () => {
  const source = readFileSync(workflow, 'utf8');
  for (const text of [
    'source_sha:',
    'type: string',
    'max-parallel: 1',
    'timeout-minutes: 45',
    'cancel-in-progress: false',
    'repository: kim-mac/Slate',
    'ref: ${{ inputs.source_sha }}',
    'SOURCE_SHA: ${{ inputs.source_sha }}',
    "github.ref == 'refs/heads/main'",
    'git merge-base --is-ancestor',
    'git rev-parse HEAD',
    'git hash-object .github/workflows/macos-m1.yml',
    'package-manager-cache: false',
    'retention-days: 3',
    'shell: bash',
    '--bundles app -- --no-default-features --locked',
  ])
    assert.ok(source.includes(text), text);
  assert.doesNotMatch(
    source,
    /tauri (?:build|dev) --[^\n]*--no-default-features[^\n]*--bundles/,
  );
  assert.doesNotMatch(source, /run:.*\$\{\{ inputs\./);
  const upload = source.slice(
    source.indexOf('name: Retain diagnostic evidence'),
  );
  assert.ok(upload.includes('always()'));
  assert.doesNotMatch(upload, /\.app(?:\.|\/)|\.tar\.gz|\/\*\*/);
  assert.match(upload, /rust-tests-.*matrix.target.*\.log/);
  assert.match(upload, /compiler-.*matrix.target.*\.log/);
});

test('source selection shell accepts only the exact dedicated-branch SHA without executing input', (t) => {
  const source = readFileSync(workflow, 'utf8');
  const block = source
    .split('name: Validate requested source commit\n')[1]
    ?.split('      # Official')[0];
  assert.ok(block, 'source-validation step required');
  const script = block
    .slice(block.indexOf('run: |\n') + 7)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  const directory = mkdtempSync(path.join(tmpdir(), 'slate-m1-source-policy-'));
  t.after(() => rmSync(directory, { recursive: true }));
  const bash =
    process.platform === 'win32'
      ? path.join(
          process.env.ProgramFiles ?? 'C:/Program Files',
          'Git/bin/bash.exe',
        )
      : '/bin/bash';
  assert.ok(
    existsSync(bash),
    'Bash required for workflow-shell regression tests',
  );
  const sha = 'a'.repeat(40);
  const remote = `${sha}\trefs/heads/codex/macos-m1-development`;
  const run = (input, mock = remote) =>
    spawnSync(
      bash,
      [
        '--noprofile',
        '--norc',
        '-e',
        '-o',
        'pipefail',
        '-c',
        'git() { printf "%s\\n" "$MOCK_REMOTE"; };\n' + script,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        env: {
          ...process.env,
          SOURCE_SHA: input,
          WORKFLOW_SHA: 'b'.repeat(40),
          MOCK_REMOTE: mock,
        },
      },
    );
  const valid = run(sha);
  assert.equal(valid.status, 0, valid.stderr);
  for (const input of [
    '',
    'main',
    'refs/heads/main',
    'a'.repeat(39),
    'A'.repeat(40),
    '$(printf INJECTED > injected)',
    `${sha}\nprintf INJECTED > injected`,
    `${sha}; printf INJECTED > injected`,
  ]) {
    const rejected = run(input);
    assert.notEqual(rejected.status, 0, input);
    assert.match(rejected.stdout, /Reviewed full commit SHA required/);
  }
  for (const mock of [
    'b'.repeat(40) + '\trefs/heads/codex/macos-m1-development',
    `${sha}\trefs/heads/main`,
    `${remote}\n${remote}`,
  ])
    assert.notEqual(run(sha, mock).status, 0);
  assert.equal(existsSync(path.join(directory, 'injected')), false);
});

test('pinned Tauri CLI accepts Cargo feature-disable arguments after its separator', () => {
  const cli = path.join(
    root,
    'apps/desktop/node_modules/@tauri-apps/cli/tauri.js',
  );
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'build',
      '--debug',
      '--features',
      'macos-dev',
      '--help',
      '--',
      '--no-default-features',
      '--locked',
    ],
    {
      cwd: path.join(root, 'apps/desktop'),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

const root = fileURLToPath(new URL('../../', import.meta.url));
const helper = new URL('./m1.mjs', import.meta.url);
const workflow = path.join(root, '.github/workflows/macos-m1.yml');
const store = [
  83, 108, 97, 116, 101, 77, 49, 68, 101, 118, 83, 116, 111, 114, 101, 49,
];
const fixture = () => ({
  productName: 'Slate macOS Development',
  version: '0.3.1',
  identifier: 'com.aiclipmemory.desktop.macos-dev',
  app: {
    windows: [
      {
        label: 'main',
        title: 'Slate macOS Development',
        create: false,
        visible: false,
      },
    ],
  },
  plugins: { updater: { endpoints: [], pubkey: '' } },
  bundle: {
    active: true,
    targets: ['app'],
    icon: ['icons/macos-dev.png'],
    macOS: { minimumSystemVersion: '14.0', signingIdentity: '-' },
  },
});
async function api() {
  assert.ok(existsSync(helper), 'macOS development helper must exist');
  return import(helper.href);
}

test('effective configuration merges the base and rejects production updater inheritance', async () => {
  const { mergeConfig, validateConfig } = await api();
  const base = fixture();
  base.plugins.updater = {
    endpoints: ['https://production.invalid/update'],
    pubkey: 'production-key',
  };
  assert.throws(
    () =>
      validateConfig(
        mergeConfig(base, { productName: 'Slate macOS Development' }),
      ),
    /updater/i,
  );
  assert.doesNotThrow(() => validateConfig(mergeConfig(base, fixture())));
  assert.equal(
    base.plugins.updater.pubkey,
    'production-key',
    'merge must not mutate the source',
  );
});

test('guard rejects identity, store, startup, signing, and packaging drift', async () => {
  const { validateConfig } = await api();
  const mutations = [
    (c) => {
      c.identifier = 'com.aiclipmemory.desktop';
    },
    (c) => {
      c.productName = 'Slate';
    },
    (c) => {
      c.version = '0.3.2';
    },
    (c) => {
      c.app.windows[0].create = true;
    },
    (c) => {
      c.app.windows[0].visible = true;
    },
    (c) => {
      c.app.windows[0].title = 'Slate';
    },
    (c) => {
      c.app.windows[0].url = 'https://example.invalid';
    },
    (c) => {
      c.app.windows[0].dataStoreIdentifier = [1];
    },
    (c) => {
      c.app.windows[0].dataStoreIdentifier = store;
    },
    (c) => {
      c.app.windows[0]['data-store-identifier'] = store;
    },
    (c) => {
      c.app.windows.push({ label: 'extra' });
    },
    (c) => {
      c.plugins.autostart = {};
    },
    (c) => {
      c.bundle.externalBin = ['native-host'];
    },
    (c) => {
      c.bundle.resources = { 'private.sqlite3': 'db.sqlite3' };
    },
    (c) => {
      c.bundle.targets = ['dmg'];
    },
    (c) => {
      c.bundle.macOS.signingIdentity = 'Developer ID';
    },
    (c) => {
      c.bundle.macOS.minimumSystemVersion = '13.0';
    },
    (c) => {
      c.bundle.icon = ['icons/icon.ico'];
    },
  ];
  for (const mutate of mutations) {
    const config = fixture();
    mutate(config);
    assert.throws(() => validateConfig(config), undefined, mutate.toString());
  }
});

test('public bundle receipt rejects wrong architecture, signing and private bundle files', async () => {
  const { validateInspection } = await api();
  const good = {
    target: 'aarch64-apple-darwin',
    architecture: 'arm64',
    fileType: 'Mach-O 64-bit executable arm64',
    plist: {
      CFBundleIdentifier: 'com.aiclipmemory.desktop.macos-dev',
      CFBundleName: 'Slate macOS Development',
      CFBundleShortVersionString: '0.3.1',
      CFBundleVersion: '0.3.1',
      LSMinimumSystemVersion: '14.0',
      CFBundleExecutable: 'ai-clip-memory-desktop',
    },
    signature:
      'Signature=adhoc\nCodeDirectory v=20400 flags=0x2(adhoc) hashes=1',
    buildVersion: 'platform MACOS\nminos 14.0\nsdk 15.0',
    files: [
      'Contents/Info.plist',
      'Contents/PkgInfo',
      'Contents/MacOS/ai-clip-memory-desktop',
      'Contents/MacOS/ai-clip-memory-native-host',
      'Contents/Resources/icon.icns',
      'Contents/_CodeSignature/CodeResources',
    ],
    forbiddenContentFound: false,
    host: {
      architecture: 'arm64',
      fileType: 'Mach-O 64-bit executable arm64',
      buildVersion: 'platform MACOS\nminos 14.0\nsdk 15.0',
      signature:
        'Signature=adhoc\nCodeDirectory v=20400 flags=0x2(adhoc) hashes=1',
      probes: [
        { exitCode: 78, stdout: '', stderr: '' },
        { exitCode: 78, stdout: '', stderr: '' },
      ],
    },
  };
  assert.doesNotThrow(() => validateInspection(good));
  assert.doesNotThrow(() =>
    validateInspection({
      ...good,
      signature:
        'Signature=adhoc\nCodeDirectory v=20500 flags=0x10002(adhoc,runtime) hashes=1',
    }),
  );
  for (const change of [
    { architecture: 'arm64 x86_64' },
    { target: 'x86_64-apple-darwin' },
    { fileType: 'ELF executable' },
    { signature: 'Authority=Developer ID' },
    { buildVersion: 'minos 13.0' },
    { forbiddenContentFound: true },
    { files: [...good.files, 'Contents/Resources/clips.sqlite3'] },
    { host: { ...good.host, architecture: 'x86_64' } },
    { host: { ...good.host, fileType: 'PE32+ executable' } },
    { host: { ...good.host, buildVersion: 'minos 13.0' } },
    {
      host: {
        ...good.host,
        signature: good.host.signature + '\nAuthority=Developer ID',
      },
    },
    {
      host: { ...good.host, probes: [{ exitCode: 0, stdout: '', stderr: '' }] },
    },
    {
      host: {
        ...good.host,
        probes: [
          { exitCode: 78, stdout: 'unexpected protocol', stderr: '' },
          good.host.probes[1],
        ],
      },
    },
    { host: undefined },
    { files: [...good.files, 'Contents/MacOS/slate-maintenance-host'] },
    {
      files: good.files.filter(
        (file) => !file.endsWith('/ai-clip-memory-native-host'),
      ),
    },
    { files: [...good.files, 'Contents/Resources/private/source.rs'] },
    {
      plist: { ...good.plist, CFBundleIdentifier: 'com.aiclipmemory.desktop' },
    },
  ])
    assert.throws(() => validateInspection({ ...good, ...change }));
});

test('manual workflow fixes native runners/toolchains and retains diagnostic evidence only', () => {
  assert.ok(existsSync(workflow), 'manual macOS workflow must exist');
  const source = readFileSync(workflow, 'utf8');
  assert.match(source, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(
    source,
    /^\s+(push|pull_request|schedule|workflow_call):/m,
  );
  for (const value of [
    'macos-15',
    'macos-15-intel',
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    '22.16.0',
    '11.19.0',
    '1.98.0',
    "CARGO_INCREMENTAL: '0'",
    "MACOSX_DEPLOYMENT_TARGET: '14.0'",
    'contents: read',
    '--frozen-lockfile',
    '--features macos-dev',
    '--no-default-features',
    '--bundles app',
    '--debug',
    'rust-policy-tests',
    'm1.mjs inspect',
    '--locked',
  ])
    assert.ok(source.includes(value), value);
  for (const action of source.matchAll(/uses:\s*(\S+)/g))
    assert.match(
      action[1],
      /^actions\/(checkout|setup-node|cache|upload-artifact)@[a-f0-9]{40}$/,
    );
  assert.doesNotMatch(
    source,
    /secrets\.|tauri-action|cargo.*--release|pnpm.*publish|target\/\*\*|dist\/test\/macos-m1\/\*\*/i,
  );
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /cargo test[^\n]*--features macos-dev/);
  assert.match(source, /CARGO_TARGET_DIR:.*matrix.target/);
  const cache = source.slice(
    source.indexOf('name: Cache downloaded dependencies'),
    source.indexOf('name: Install locked dependencies'),
  );
  assert.doesNotMatch(cache, /target|restore-keys/);
  const upload = source.slice(
    source.indexOf('name: Retain diagnostic evidence'),
  );
  assert.match(upload, /provenance-.*matrix.target.*\.log/);
  assert.match(upload, /inspection-.*matrix.target.*\.json/);
  assert.doesNotMatch(upload, /\.app\.tar\.gz|target\/\*\*|tar -czf/);
});

test('repository configuration and frozen Windows sources satisfy the development contract', async () => {
  const { validateRepository } = await api();
  assert.doesNotThrow(() => validateRepository(root));
});
