// @ts-check
// TEST only. Reads public signed text fixtures; never reads an updater private key.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import {
  assertCleanEnvironment,
  wrongPublicKey,
} from './disposable-test-signing.mjs';
import { buildVerifier } from './build-update-signature-verifier.mjs';

const worktree = fileURLToPath(new URL('../../', import.meta.url));
const crate = join(worktree, 'scripts/windows/updater-sdk-transport');
const fixtures = join(worktree, 'dist/test/updater-disposable-signing');
const binaryName = 'slate-sdk-transport-test';
const hash = (/** @type {string | Uint8Array} */ value) =>
  createHash('sha256').update(value).digest('hex').toUpperCase();
const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/KEY|PASS|TOKEN|SECRET|CREDENTIAL|^NODE_OPTIONS$/i.test(name),
    ),
  );

/** Source-level tripwire, not a claim of adversarial sandboxing.
 * @param {string} source */
export function assertSafeRustSource(source) {
  if (
    /(?:\.|::)\s*(?:install|download_and_install)\s*(?:\(|::)|\b(?:Command|OpenOptions)\s*::|\b(?:fs\s*::\s*write|File\s*::\s*create)\s*\(|\binclude\s*!|\b(?:mod\s+\w+\s*;|extern\s+"|unsafe\b)/.test(
      source,
    )
  ) {
    throw new Error(
      'Forbidden execution, output-file, or hidden-code API in transport harness',
    );
  }
}

/** @param {string} value @param {string} origin */
export function assertTestUrl(value, origin) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith('/slate-sdk-test/')
  )
    throw new Error('Not an isolated TEST URL');
}

/** Inspect existing ancestors; reject symlinks, junctions and path aliases.
 * @param {string} path */
function ordinary(path) {
  const parent = dirname(path);
  if (parent !== path) ordinary(parent);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
    throw new Error('Cannot inspect TEST path', { cause: error });
  }
  assert.ok(!stat.isSymbolicLink());
  assert.equal(realpathSync(path).toLowerCase(), resolve(path).toLowerCase());
}

/** @param {string} path */
function publicInput(path) {
  ordinary(path);
  const stat = lstatSync(path);
  assert.ok(
    stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= 16_384,
  );
  return readFileSync(path);
}

/** @param {string} file @param {string | Uint8Array} contents */
function exclusive(file, contents) {
  writeFileSync(file, contents, { flag: 'wx' });
}

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [extraEnv] */
function command(command, args, extraEnv = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...cleanEnv(), ...extraEnv },
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** @param {string} directory */
function build(directory) {
  const hostReport = command('rustc', ['-vV']);
  assert.equal(hostReport.error, undefined, 'Rust host query launch');
  assert.equal(hostReport.status, 0, 'Rust host query');
  const host = /^host: ([a-z0-9_-]+)$/m.exec(hostReport.stdout)?.[1];
  assert.ok(
    host === 'aarch64-pc-windows-msvc' || host === 'x86_64-pc-windows-msvc',
  );
  const result = command('cargo', [
    'build',
    '--offline',
    '--locked',
    '--manifest-path',
    join(crate, 'Cargo.toml'),
    '--bin',
    binaryName,
    '--target',
    host,
    '--target-dir',
    join(worktree, 'apps/desktop/src-tauri/target'),
    '--message-format',
    'json',
  ]);
  if (result.error || result.status !== 0) {
    exclusive(join(directory, 'build-diagnostics.txt'), result.stderr);
    throw new Error(
      'STOP: offline SDK harness build failed; inspect build-diagnostics.txt',
    );
  }
  const artifact = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .find(
      (item) =>
        item.reason === 'compiler-artifact' &&
        item.target?.name === binaryName &&
        item.executable,
    );
  assert.ok(artifact?.executable, 'Cargo-reported harness executable');
  const expected = join(
    worktree,
    `apps/desktop/src-tauri/target/${host}/debug/${binaryName}.exe`,
  );
  assert.equal(
    resolve(artifact.executable).toLowerCase(),
    resolve(expected).toLowerCase(),
  );
  ordinary(expected);
  return { executable: expected, host, sha256: hash(readFileSync(expected)) };
}

/** Generate TLS credentials only. Updater signing credentials are never inputs.
 * @param {string} directory */
function tls(directory) {
  const version = command('openssl', ['version']);
  assert.equal(version.error, undefined, 'Installed OpenSSL must launch');
  assert.equal(version.status, 0, 'Installed OpenSSL');
  assert.match(version.stdout, /^OpenSSL 3\./);
  const path = (/** @type {string} */ name) => join(directory, name);
  // Do not inherit machine OpenSSL configuration or its optional random-file path.
  exclusive(path('openssl.cnf'), '[req]\ndistinguished_name=dn\n[dn]\n');
  const openssl = (
    /** @type {string[]} */ args,
    /** @type {string[]} */ outputs,
  ) => {
    for (const name of outputs)
      assert.throws(() => lstatSync(path(name)), { code: 'ENOENT' });
    const result = command('openssl', args, {
      OPENSSL_CONF: path('openssl.cnf'),
    });
    // Never forward OpenSSL output, including on errors.
    assert.ok(
      !result.error && result.status === 0,
      'STOP: disposable TLS generation failed',
    );
  };
  for (const name of ['ca', 'untrusted-ca']) {
    openssl(
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-days',
        '1',
        '-keyout',
        path(`${name}.key`),
        '-out',
        path(`${name}.pem`),
        '-subj',
        `/CN=Slate SDK TLS TEST ${name}`,
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,keyCertSign,cRLSign',
      ],
      [`${name}.key`, `${name}.pem`],
    );
  }
  openssl(
    [
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-keyout',
      path('server.key'),
      '-out',
      path('server.csr'),
      '-subj',
      '/CN=Slate SDK LOCALHOST TEST',
    ],
    ['server.key', 'server.csr'],
  );
  for (const [name, ip, serial] of [
    ['server', '127.0.0.1', '101'],
    ['wrong-host', '127.0.0.2', '102'],
  ]) {
    exclusive(
      path(`${name}.ext`),
      `subjectAltName=IP:${ip}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,
    );
    openssl(
      [
        'x509',
        '-req',
        '-in',
        path('server.csr'),
        '-CA',
        path('ca.pem'),
        '-CAkey',
        path('ca.key'),
        '-set_serial',
        serial,
        '-days',
        '1',
        '-sha256',
        '-extfile',
        path(`${name}.ext`),
        '-out',
        path(`${name}.pem`),
      ],
      [`${name}.pem`],
    );
  }
  return {
    ca: readFileSync(path('ca.pem'), 'utf8'),
    untrustedCa: readFileSync(path('untrusted-ca.pem'), 'utf8'),
    cert: readFileSync(path('server.pem')),
    wrongHost: readFileSync(path('wrong-host.pem')),
    key: readFileSync(path('server.key')),
    openssl: version.stdout.trim(),
  };
}

/** @typedef {{sdk: boolean, outcome: string, category?: string, downloadAttempted: boolean, verified?: boolean, bytes?: number, sha256?: string, chunks?: number, received?: number, downloadFinished?: boolean, version?: string, retry?: SdkReport}} SdkReport */
/** @param {string} executable @param {object} input @returns {Promise<SdkReport>} */
function sdk(executable, input) {
  return new Promise((resolveReport, reject) => {
    const child = spawn(executable, [], {
      shell: false,
      windowsHide: true,
      env: cleanEnv(),
      timeout: 25_000,
    });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => {
      stdout += data;
    });
    child.stderr.on('data', (data) => {
      stderr += data;
    });
    child.once('error', () =>
      reject(new Error('STOP: native SDK harness could not launch')),
    );
    child.once('close', (code, signal) => {
      if (code !== 0 || signal) {
        const safe =
          /TEST harness rejected: ([a-z_]+)/.exec(stderr)?.[1] ??
          'native_failure';
        reject(new Error(`STOP: native SDK harness failed (${safe})`));
        return;
      }
      try {
        const report = JSON.parse(stdout);
        assert.equal(report.sdk, true);
        resolveReport(report);
      } catch {
        reject(new Error('STOP: invalid native SDK report'));
      }
    });
    child.stdin.on('error', () => {
      /* Close handler reports a failed native launch. */
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** @param {string} directory */
async function run(directory) {
  assertSafeRustSource(readFileSync(join(crate, 'src/main.rs'), 'utf8'));
  const compiled = build(directory);
  const verifier = buildVerifier().executable;
  const publicKey = publicInput(join(fixtures, 'disposable-test.key.pub'))
    .toString()
    .trim();
  const data = Object.fromEntries(
    ['x64', 'arm64'].map((name) => {
      const file = join(fixtures, `synthetic-${name}.txt`);
      const bytes = publicInput(file);
      const signature = publicInput(`${file}.sig`).toString().trim();
      const authenticated = command(verifier, [
        '--public-key',
        join(fixtures, 'disposable-test.key.pub'),
        '--artifact',
        file,
        '--signature',
        `${file}.sig`,
        '--expected-version',
        '0.2.0',
      ]);
      assert.ok(
        !authenticated.error && authenticated.status === 0,
        'STOP: fixture authentication failed',
      );
      const report = JSON.parse(authenticated.stdout);
      assert.equal(report.verified, true);
      assert.equal(report.version, '0.2.0');
      assert.equal(report.artifactSha256, hash(bytes));
      return [name, { bytes, signature }];
    }),
  );
  const credentials = tls(directory);
  /** @type {Record<string, {manifest: number, asset: number}>} */
  const requests = {};
  /** @type {Record<string, {mode: string, label: string}>} */
  const routes = {};
  let origin = '';
  const server = createServer(
    { key: credentials.key, cert: credentials.cert },
    (req, res) => {
      const match =
        /^\/slate-sdk-test\/([a-z0-9-]+)\/(manifest\.json|artifact\.txt)$/.exec(
          req.url ?? '',
        );
      const route = match && routes[match[1]];
      if (!match || !route || req.method !== 'GET') {
        res.writeHead(404).end();
        return;
      }
      const count = requests[match[1]];
      if (match[2] === 'manifest.json') {
        count.manifest++;
        if (route.mode === 'http-failure') {
          res.writeHead(503).end();
          return;
        }
        if (route.mode === 'disconnect') {
          req.socket.destroy();
          return;
        }
        if (route.mode === 'bad-json') {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end('{');
          return;
        }
        if (route.mode === 'redirect') {
          res
            .writeHead(302, {
              Location: `http://127.0.0.1:${new URL(origin).port}/forbidden`,
            })
            .end();
          return;
        }
        const platforms = Object.fromEntries(
          [
            ['windows-x86_64', 'x64'],
            ['windows-aarch64', 'arm64'],
          ].map(([platform, label]) => [
            platform,
            {
              url: `${origin}/slate-sdk-test/${match[1]}/artifact.txt`,
              signature:
                route.mode === 'corrupt'
                  ? 'corrupted synthetic signature'
                  : data[label].signature,
            },
          ]),
        );
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            version: route.mode === 'version' ? '0.2.1' : '0.2.0',
            platforms,
          }),
        );
      } else {
        count.asset++;
        const bytes =
          route.mode === 'tampered'
            ? Buffer.concat([data[route.label].bytes, Buffer.from('tampered')])
            : data[route.label].bytes;
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': bytes.length,
        });
        if (
          route.mode === 'cancel' ||
          (route.mode === 'cancel-retry' && count.asset === 1)
        )
          res.write(bytes.subarray(0, 1)); // Remains gated until client aborts.
        else res.end(bytes);
      }
    },
  );
  let wrongHostRequests = 0;
  const wrongHostServer = createServer(
    { key: credentials.key, cert: credentials.wrongHost },
    (_req, res) => {
      wrongHostRequests++;
      res.writeHead(500).end();
    },
  );
  // TLS failures are expected negative cases, not loggable certificate/error dumps.
  server.on('tlsClientError', () => {});
  wrongHostServer.on('tlsClientError', () => {});
  const listen = (/** @type {import('node:https').Server} */ server) =>
    new Promise((ready, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => ready(undefined));
    });
  const serverOrigin = (/** @type {import('node:https').Server} */ server) => {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `https://127.0.0.1:${address.port}`;
  };
  /** @type {Array<object>} */
  const results = [];
  try {
    await listen(server);
    await listen(wrongHostServer);
    origin = serverOrigin(server);
    const nativeLabel = compiled.host.startsWith('aarch64') ? 'arm64' : 'x64';
    /** @param {string} name @param {string} mode @param {string} label @param {string | null} target @param {string} expected @param {string} [current] */
    async function scenario(
      name,
      mode,
      label,
      target,
      expected,
      current = '0.1.0',
    ) {
      routes[name] = { mode, label };
      requests[name] = { manifest: 0, asset: 0 };
      const selectedOrigin =
        mode === 'tls-hostname' ? serverOrigin(wrongHostServer) : origin;
      const endpoint = `${selectedOrigin}/slate-sdk-test/${name}/manifest.json`;
      assertTestUrl(endpoint, selectedOrigin);
      const report = await sdk(compiled.executable, {
        endpoint,
        origin: selectedOrigin,
        publicKey: mode === 'wrong-key' ? wrongPublicKey(publicKey) : publicKey,
        caPem:
          mode === 'tls-untrusted' ? credentials.untrustedCa : credentials.ca,
        currentVersion: current,
        target,
        cancelAfterChunk: mode === 'cancel' || mode === 'cancel-retry',
        retryAfterCancel: mode === 'cancel-retry',
      });
      exclusive(
        join(directory, `${name}-observed.json`),
        `${JSON.stringify({ scenario: name, sdk: report, requests: { ...requests[name] } }, null, 2)}\n`,
      );
      assert.equal(
        report.outcome,
        expected === 'verified' ||
          expected === 'no_update' ||
          expected === 'cancelled'
          ? expected
          : 'error',
        name,
      );
      if (!['verified', 'no_update', 'cancelled'].includes(expected))
        assert.equal(report.category, expected, name);
      if (expected === 'verified') {
        assert.equal(report.verified, true);
        assert.equal(report.sha256, hash(data[label].bytes));
        assert.equal(report.bytes, data[label].bytes.length);
        assert.equal(report.version, '0.2.0');
        assert.ok(report.chunks && report.chunks > 0);
        assert.equal(report.downloadFinished, true);
      } else assert.notEqual(report.verified, true);
      if (expected === 'cancelled') {
        assert.equal(report.downloadAttempted, true);
        assert.equal(report.downloadFinished, false);
        assert.equal(report.received, 1);
        if (mode === 'cancel-retry') {
          assert.equal(report.retry?.outcome, 'verified');
          assert.equal(report.retry.verified, true);
          assert.equal(report.retry.sha256, hash(data[label].bytes));
          assert.equal(report.retry.bytes, data[label].bytes.length);
          assert.equal(report.retry.version, '0.2.0');
          assert.equal(requests[name].asset, 2);
        }
      }
      if (mode.startsWith('tls-')) {
        assert.equal(report.downloadAttempted, false);
        assert.equal(requests[name].manifest, 0);
        assert.equal(wrongHostRequests, 0);
      } else {
        assert.ok(requests[name].manifest > 0);
        assert.equal(requests[name].asset > 0, report.downloadAttempted);
      }
      const result = {
        scenario: name,
        label,
        sdk: report,
        requests: { ...requests[name] },
        passed: true,
      };
      results.push(result);
      exclusive(
        join(directory, `${name}.json`),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      process.stdout.write(`PASS ${name}\n`);
    }
    await scenario('valid-native', 'valid', nativeLabel, null, 'verified');
    for (const [label, target] of [
      ['x64', 'windows-x86_64'],
      ['arm64', 'windows-aarch64'],
    ]) {
      await scenario(`valid-${label}`, 'valid', label, target, 'verified');
      await scenario(
        `tampered-${label}`,
        'tampered',
        label,
        target,
        'signature_failure',
      );
      await scenario(
        `wrong-key-${label}`,
        'wrong-key',
        label,
        target,
        'signature_failure',
      );
      await scenario(
        `wrong-version-${label}`,
        'version',
        label,
        target,
        'signed_version_mismatch',
      );
      await scenario(
        `corrupt-${label}`,
        'corrupt',
        label,
        target,
        'signature_failure',
      );
    }
    await scenario(
      'equal-version',
      'valid',
      nativeLabel,
      null,
      'no_update',
      '0.2.0',
    );
    await scenario(
      'older-version',
      'valid',
      nativeLabel,
      null,
      'no_update',
      '0.2.1',
    );
    await scenario(
      'http-failure',
      'http-failure',
      nativeLabel,
      null,
      'release_not_found',
    );
    await scenario(
      'malformed-json',
      'bad-json',
      nativeLabel,
      null,
      'manifest_invalid',
    );
    await scenario(
      'network-disconnect',
      'disconnect',
      nativeLabel,
      null,
      'transport_failure',
    );
    await scenario(
      'untrusted-ca',
      'tls-untrusted',
      nativeLabel,
      null,
      'transport_failure',
    );
    await scenario(
      'wrong-hostname',
      'tls-hostname',
      nativeLabel,
      null,
      'transport_failure',
    );
    await scenario(
      'disallowed-redirect',
      'redirect',
      nativeLabel,
      null,
      'redirect_rejected',
    );
    await scenario(
      'cancel-after-chunk',
      'cancel',
      nativeLabel,
      null,
      'cancelled',
    );
    await scenario(
      'retry-after-cancel',
      'cancel-retry',
      nativeLabel,
      null,
      'cancelled',
    );
    const report = {
      testOnly: true,
      installationEnabled: false,
      sdkVersion: '2.13.3',
      tauriVersion: '2.12.3',
      host: compiled.host,
      executableSha256: compiled.sha256,
      openssl: credentials.openssl,
      publicKeySha256: hash(Buffer.from(publicKey, 'base64')),
      results,
    };
    exclusive(
      join(directory, 'results.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
  } finally {
    // Stop only our endpoint sockets. No filesystem cleanup or unrelated processes.
    for (const endpoint of [server, wrongHostServer]) {
      endpoint.closeAllConnections();
      if (endpoint.listening)
        await new Promise((resolveClose) => endpoint.close(resolveClose));
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let directory;
  try {
    assert.equal(process.argv.length, 2, 'No command-line overrides');
    assert.equal(process.platform, 'win32', 'Windows TEST harness only');
    assertCleanEnvironment(process.env);
    const branch = command('git', ['-C', worktree, 'branch', '--show-current']);
    assert.equal(branch.status, 0);
    assert.equal(branch.stdout.trim(), 'codex/desktop-updater');
    const production = JSON.parse(
      readFileSync(
        join(worktree, 'apps/desktop/src-tauri/tauri.conf.json'),
        'utf8',
      ),
    );
    assert.ok(
      !production.plugins?.updater &&
        !production.bundle?.createUpdaterArtifacts,
      'Production configuration must remain unconfigured',
    );
    const parent = join(worktree, 'dist/test/updater-sdk-transport');
    ordinary(parent);
    mkdirSync(parent, { recursive: true });
    directory = mkdtempSync(join(parent, 'run-'));
    process.stdout.write(`TEST output: ${directory}\n`);
    const report = await run(directory);
    process.stdout.write(
      `SDK transport: ${report.results.length}/${report.results.length} passed; installation disabled.\n`,
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith('STOP:')
        ? error.message
        : 'STOP: SDK transport verification failed; no fallback or security changes attempted';
    if (directory)
      exclusive(
        join(directory, 'failure.json'),
        `${JSON.stringify({ failed: true, message })}\n`,
      );
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
