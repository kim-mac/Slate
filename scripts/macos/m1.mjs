import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const frozen = 'abd997637dedf0955afa15fe68114eba8154ea56';
const product = 'Slate macOS Development';
const identifier = 'com.aiclipmemory.desktop.macos-dev';
const version = '0.3.1';
const store = [
  83, 108, 97, 116, 101, 77, 49, 68, 101, 118, 83, 116, 111, 114, 101, 49,
];
const architectures = {
  'aarch64-apple-darwin': 'arm64',
  'x86_64-apple-darwin': 'x86_64',
};
const basePath = 'apps/desktop/src-tauri/tauri.conf.json';
const overlayPath = 'apps/desktop/src-tauri/tauri.macos.conf.json';

// Tauri uses JSON Merge Patch: objects merge recursively, arrays replace.
export function mergeConfig(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay))
    return globalThis.structuredClone(overlay);
  const result =
    base && typeof base === 'object' && !Array.isArray(base)
      ? globalThis.structuredClone(base)
      : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (value === null) delete result[key];
    else result[key] = mergeConfig(result[key], value);
  }
  return result;
}

export function validateConfig(config) {
  assert.equal(
    config.productName,
    product,
    'Development product name required',
  );
  assert.equal(
    config.identifier,
    identifier,
    'Isolated development identifier required',
  );
  assert.equal(config.version, version, 'Development version drift');
  const windows = config.app?.windows;
  assert.equal(
    windows?.length,
    1,
    'Exactly one guarded development window required',
  );
  const main = windows[0];
  assert.equal(main.label, 'main');
  assert.ok(
    main.url === undefined || main.url === 'index.html',
    'Only the local frontend is allowed',
  );
  assert.match(main.title, /development/i, 'Development window title required');
  assert.equal(main.create, false, 'Window must wait for runtime guard');
  assert.equal(main.visible, false, 'Window must start hidden');
  assert.equal(
    main.dataStoreIdentifier,
    undefined,
    'WKWebView store must be assigned by typed policy before validation',
  );
  assert.equal(main['data-store-identifier'], undefined);
  assert.equal(
    config.plugins?.updater?.pubkey,
    '',
    'Production updater key forbidden',
  );
  assert.deepEqual(
    config.plugins?.updater?.endpoints,
    [],
    'Production updater endpoints forbidden',
  );
  assert.ok(
    !Object.hasOwn(config.plugins, 'autostart'),
    'Autostart initialization forbidden',
  );
  assert.equal(config.bundle?.active, true);
  assert.deepEqual(
    config.bundle.targets,
    ['app'],
    'Only development app bundles allowed',
  );
  assert.deepEqual(config.bundle.icon, ['icons/macos-dev.png']);
  assert.equal(config.bundle.macOS?.minimumSystemVersion, '14.0');
  assert.equal(
    config.bundle.macOS?.signingIdentity,
    '-',
    'Ad-hoc signing required',
  );
  assert.ok(
    !config.bundle.macOS?.entitlements,
    'Custom entitlements forbidden',
  );
  assert.ok(
    !config.bundle.macOS?.files ||
      Object.keys(config.bundle.macOS.files).length === 0,
    'Extra macOS bundle files forbidden',
  );
  for (const key of ['externalBin', 'resources']) {
    const value = config.bundle[key];
    assert.ok(
      value === undefined ||
        value === null ||
        (typeof value === 'object' && Object.keys(value).length === 0),
      `Bundled ${key} forbidden`,
    );
  }
  assert.ok(
    !config.bundle.createUpdaterArtifacts,
    'Updater artifacts forbidden',
  );
  return config;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed: ${result.error?.message ?? result.stderr ?? ''}`,
  );
  return result;
}

export function validateRepository(directory = root) {
  const read = (relative) =>
    readFileSync(path.join(directory, relative), 'utf8');
  const config = validateConfig(
    mergeConfig(JSON.parse(read(basePath)), JSON.parse(read(overlayPath))),
  );
  const icon = readFileSync(
    path.join(directory, 'apps/desktop/src-tauri/icons/macos-dev.png'),
  );
  assert.equal(
    icon.toString('hex', 0, 8),
    '89504e470d0a1a0a',
    'Development PNG required',
  );
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
  assert.match(
    read('apps/desktop/src-tauri/Cargo.toml'),
    /^macos-dev\s*=\s*\[\]/m,
    'Explicit development feature required',
  );
  const cargo = read('apps/desktop/src-tauri/Cargo.toml');
  assert.doesNotMatch(
    cargo,
    /^default\s*=|^native-host\s*=/m,
    'No new Cargo default-feature contract',
  );
  const host = cargo.match(/\[\[bin\]\][\s\S]*?(?=\n\[|$)/)?.[0];
  assert.match(
    host ?? '',
    /name = "ai-clip-memory-native-host"\s*\npath = "src\/bin\/ai-clip-memory-native-host.rs"/,
  );
  assert.doesNotMatch(
    host,
    /required-features/,
    'Original unconditional Windows target required',
  );
  const entry = read(
    'apps/desktop/src-tauri/src/bin/ai-clip-memory-native-host.rs',
  );
  assert.ok(
    entry.includes(
      '#[cfg(feature = "macos-dev")]\ninclude!("../macos_dev/inert_host.rs");',
    ),
  );
  const inert = read('apps/desktop/src-tauri/src/macos_dev/inert_host.rs')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  assert.match(
    inert,
    /^fn main\(\) -> std::process::ExitCode\s*\{\s*std::process::ExitCode::from\(78\)\s*\}$/,
  );
  assert.ok(
    existsSync(
      path.join(directory, 'apps/desktop/src-tauri/src/macos_dev/policy.rs'),
    ),
    'Standalone profile policy required',
  );
  const policy = read('apps/desktop/src-tauri/src/macos_dev/policy.rs');
  const storeLiteral = policy.match(
    /pub const STORE_ID: \[u8; 16\] = \[([\d,\s]+)\];/,
  );
  assert.deepEqual(
    storeLiteral?.[1].match(/\d+/g)?.map(Number),
    store,
    'The fixed persistent WKWebView store must not change',
  );
  const history = spawnSync(
    'git',
    ['-C', directory, 'cat-file', '-e', `${frozen}^{commit}`],
    { windowsHide: true, stdio: 'ignore' },
  );
  if (history.status === 0) {
    const protectedPaths = [
      basePath,
      'scripts/windows',
      'apps/desktop/src-tauri/windows',
      'apps/desktop/src-tauri/migrations',
      'apps/desktop/src-tauri/src/updater',
      'apps/desktop/src-tauri/src/ux_dev',
    ];
    const result = run('git', [
      '-C',
      directory,
      'diff',
      '--name-only',
      frozen,
      '--',
      ...protectedPaths,
    ]);
    assert.equal(
      result.stdout.trim(),
      '',
      'Frozen Windows configuration, updater, scripts and migrations must remain unchanged',
    );
  } else {
    assert.ok(
      !process.env.CI,
      'CI requires frozen source history (checkout fetch-depth: 0)',
    );
  }
  return config;
}

export function validateInspection(value) {
  assert.ok(Object.hasOwn(architectures, value.target), 'Unsupported target');
  assert.equal(
    value.architecture.trim(),
    architectures[value.target],
    'Executable architecture mismatch',
  );
  assert.match(
    value.fileType,
    /Mach-O .*executable/,
    'Mach-O executable required',
  );
  const plist = value.plist;
  assert.equal(plist.CFBundleIdentifier, identifier);
  assert.equal(plist.CFBundleName, product);
  assert.equal(plist.CFBundleShortVersionString, version);
  assert.equal(plist.CFBundleVersion, version);
  assert.equal(plist.LSMinimumSystemVersion, '14.0');
  assert.equal(plist.CFBundleExecutable, 'ai-clip-memory-desktop');
  assert.match(
    value.signature,
    /^Signature=adhoc$/m,
    'Ad-hoc signature required',
  );
  assert.match(
    value.signature,
    /flags=0x[0-9a-f]+\(adhoc(?:,runtime)?\)/i,
    'Ad-hoc signature flags required',
  );
  assert.doesNotMatch(
    value.signature,
    /^Authority=/m,
    'Production signing identity forbidden',
  );
  assert.match(
    value.buildVersion,
    /^\s*minos 14\.0(?:\.0)?\s*$/m,
    'Mach-O deployment target must be 14.0',
  );
  validateHostExecutable(value.host, value.target);
  assert.equal(
    value.host.probes?.length,
    2,
    'Both standalone host probes required',
  );
  for (const probe of value.host.probes) {
    assert.equal(probe.exitCode, 78, 'Host must explicitly reject all modes');
    assert.equal(
      probe.stdout,
      '',
      'Disabled host must not emit protocol/handle output',
    );
    assert.equal(probe.stderr, '', 'Disabled host must not initialize logging');
  }
  const allowed =
    /^(?:Contents\/(?:Info\.plist|PkgInfo)|Contents\/MacOS\/ai-clip-memory-(?:desktop|native-host)|Contents\/Resources\/[^/]+\.icns|Contents\/_CodeSignature\/CodeResources)$/;
  assert.ok(value.files.includes('Contents/Info.plist'));
  assert.ok(value.files.includes('Contents/MacOS/ai-clip-memory-desktop'));
  assert.ok(value.files.includes('Contents/MacOS/ai-clip-memory-native-host'));
  for (const file of value.files)
    assert.match(file, allowed, `Unexpected or private bundle entry: ${file}`);
  assert.equal(
    value.forbiddenContentFound,
    false,
    'Production updater content found in bundle',
  );
  return value;
}

function validateHostExecutable(host, target) {
  assert.ok(host, 'Inert host inspection required');
  assert.equal(
    host.architecture,
    architectures[target],
    'Host architecture mismatch',
  );
  assert.match(host.fileType, /Mach-O .*executable/);
  assert.match(host.signature, /^Signature=adhoc$/m);
  assert.match(host.signature, /flags=0x[0-9a-f]+\(adhoc(?:,runtime)?\)/i);
  assert.doesNotMatch(host.signature, /^Authority=/m);
  assert.match(host.buildVersion, /^\s*minos 14\.0(?:\.0)?\s*$/m);
}

function inspect(bundle, target) {
  assert.equal(
    process.platform,
    'darwin',
    'Bundle inspection requires macOS command-line tools',
  );
  assert.ok(Object.hasOwn(architectures, target), 'Unsupported target');
  validateRepository();
  const expected = path.join(
    root,
    'dist/test/macos-m1',
    `cargo-${target}`,
    target,
    'debug/bundle/macos',
    `${product}.app`,
  );
  assert.equal(
    path.resolve(bundle),
    expected,
    'Only the isolated debug development bundle can be inspected',
  );
  assert.equal(realpathSync(bundle), expected, 'Redirected bundle refused');
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const stat = lstatSync(absolute);
      assert.ok(!stat.isSymbolicLink(), 'Linked bundle entries forbidden');
      if (stat.isDirectory()) {
        assert.match(
          path.relative(bundle, absolute).split(path.sep).join('/'),
          /^(?:Contents|Contents\/(?:MacOS|Resources|_CodeSignature))$/,
          'Unexpected bundle directory forbidden',
        );
        walk(absolute);
      } else {
        assert.ok(
          stat.isFile() && stat.nlink === 1,
          'Special or hardlinked bundle entries forbidden',
        );
        files.push(path.relative(bundle, absolute).split(path.sep).join('/'));
      }
    }
  }
  walk(bundle);
  const plist = JSON.parse(
    run('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      path.join(bundle, 'Contents/Info.plist'),
    ]).stdout,
  );
  assert.equal(plist.CFBundleExecutable, 'ai-clip-memory-desktop');
  const executable = path.join(
    bundle,
    'Contents/MacOS',
    plist.CFBundleExecutable,
  );
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  const signature = run('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    bundle,
  ]);
  const hostPath = path.join(
    bundle,
    'Contents/MacOS/ai-clip-memory-native-host',
  );
  run('/usr/bin/codesign', ['--verify', '--strict', hostPath]);
  const hostSignature = run('/usr/bin/codesign', [
    '--display',
    '--verbose=4',
    hostPath,
  ]);
  const host = {
    architecture: run('/usr/bin/lipo', ['-archs', hostPath]).stdout.trim(),
    fileType: run('/usr/bin/file', ['-b', hostPath]).stdout.trim(),
    signature: hostSignature.stdout + hostSignature.stderr,
    buildVersion: run('/usr/bin/vtool', ['-show-build', hostPath]).stdout,
  };
  validateHostExecutable(host, target);
  // Never probe a possibly misbuilt binary on a user's real Mac account.
  assert.ok(
    process.env.GITHUB_ACTIONS === 'true' &&
      process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
      process.env.GITHUB_REPOSITORY === 'kim-mac/Slate',
    'Direct host probes require the disposable GitHub-hosted runner',
  );
  const probeDirectory = mkdtempSync(
    path.join(root, 'dist/test/macos-m1/host-probe-'),
  );
  const body = Buffer.from(
    JSON.stringify({
      type: 'capture',
      content: 'synthetic, never persisted',
      version: 1,
    }),
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  host.probes = [[], ['--export-maintenance-handle', '1234']].map((args) => {
    const result = spawnSync(hostPath, args, {
      cwd: probeDirectory,
      input: Buffer.concat([header, body]),
      encoding: 'utf8',
      timeout: 3000,
      shell: false,
    });
    return {
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  });
  assert.deepEqual(readdirSync(probeDirectory), [], 'Host probe wrote files');
  const base = JSON.parse(readFileSync(path.join(root, basePath), 'utf8'));
  const forbidden = [
    base.plugins.updater.pubkey,
    ...base.plugins.updater.endpoints,
    'tryslate.tech/updates/',
  ].filter(Boolean);
  const result = validateInspection({
    target,
    plist,
    files: files.sort(),
    architecture: run('/usr/bin/lipo', ['-archs', executable]).stdout.trim(),
    fileType: run('/usr/bin/file', ['-b', executable]).stdout.trim(),
    signature: signature.stdout + signature.stderr,
    buildVersion: run('/usr/bin/vtool', ['-show-build', executable]).stdout,
    forbiddenContentFound: files.some((file) => {
      const contents = readFileSync(path.join(bundle, file));
      return forbidden.some((needle) => contents.includes(Buffer.from(needle)));
    }),
    host,
  });
  // Public metadata only: never serialize config, environment, paths, keys or runtime data.
  const receipt = {
    schemaVersion: 1,
    profile: 'macos-dev',
    productName: product,
    identifier,
    version,
    target,
    architecture: result.architecture,
    minimumSystemVersion: '14.0',
    signing: 'adhoc',
    executableSha256: createHash('sha256')
      .update(readFileSync(executable))
      .digest('hex'),
    files: result.files,
    productionUpdaterContentFound: false,
    nativeHost: {
      bundled: true,
      registration: false,
      architecture: host.architecture,
      executableSha256: createHash('sha256')
        .update(readFileSync(hostPath))
        .digest('hex'),
      directInvocationExitCodes: host.probes.map((probe) => probe.exitCode),
    },
    hardwareValidation:
      'UNVERIFIED: WKWebView launch, focus, clipboard, persistence and Dock behavior',
  };
  const receiptPath = path.join(
    root,
    'dist/test/macos-m1',
    `inspection-${target}.json`,
  );
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    flag: 'wx',
  });
  console.log(JSON.stringify(receipt));
}

function rustPolicyTests() {
  const output = path.join(root, 'dist/test/macos-m1/policy');
  mkdirSync(output, { recursive: true });
  const executable = path.join(
    output,
    process.platform === 'win32' ? 'policy-tests.exe' : 'policy-tests',
  );
  run(
    'rustc',
    [
      '--edition=2021',
      '--test',
      path.join(root, 'apps/desktop/src-tauri/src/macos_dev/policy.rs'),
      '-o',
      executable,
    ],
    { stdio: 'inherit' },
  );
  run(executable, [], { stdio: 'inherit' });
}

function main(args) {
  for (const name of Object.keys(process.env))
    assert.ok(
      !/^(TAURI_CONFIG|TAURI_SIGNING_PRIVATE_KEY(?:_PASSWORD)?|APPLE_CERTIFICATE(?:_PASSWORD)?|APPLE_SIGNING_IDENTITY|APPLE_ID|APPLE_PASSWORD|APPLE_API_KEY(?:_PATH)?|APPLE_API_ISSUER)$/.test(
        name,
      ),
      'Configuration/signing environment overrides forbidden',
    );
  if (args.length === 1 && args[0] === 'validate') {
    validateRepository();
    console.log('macOS development configuration and source isolation: PASS');
  } else if (args.length === 1 && args[0] === 'rust-policy-tests')
    rustPolicyTests();
  else if (
    args.length === 5 &&
    args[0] === 'inspect' &&
    args[1] === '--bundle' &&
    args[3] === '--target'
  )
    inspect(args[2], args[4]);
  else
    throw new Error(
      'Usage: node scripts/macos/m1.mjs validate | rust-policy-tests | inspect --bundle <app> --target <apple-triple>',
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
