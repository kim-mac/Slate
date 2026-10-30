// @ts-check
// Offline TEST tooling only. No key generation, signing, network, builds or installs.
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { buildVerifier } from './build-update-signature-verifier.mjs';

export const TEST_VERSION = '0.2.0';
const worktree = fileURLToPath(new URL('../../', import.meta.url));
const relativeDirectory = 'dist/test/updater-disposable-signing';
const known = JSON.parse(
  readFileSync(
    new URL(
      './update-signature-verifier/fixtures/signatures.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const names = ['x64', 'arm64'];
const policy = JSON.stringify({
  testOnly: true,
  syntheticNonInstallers: true,
  version: TEST_VERSION,
  productionTrust: false,
});
const hash = (/** @type {string | Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex').toUpperCase();

/** @param {NodeJS.ProcessEnv} environment */
export function assertCleanEnvironment(environment) {
  if (
    Object.keys(environment).some((name) =>
      /^(CI|GIT_DIR|GIT_WORK_TREE|NODE_OPTIONS|TAURI_(SIGNING_)?PRIVATE_KEY(?:_PATH|_PASSWORD)?)$/i.test(
        name,
      ),
    )
  ) {
    throw new Error(
      'Use a clean interactive shell without signing/CI/environment overrides',
    );
  }
}

/** Check existing ancestors before creating or reading anything beneath them.
 * @param {string} path
 */
function ordinaryPath(path) {
  path = resolve(path);
  const parent = dirname(path);
  if (parent !== path) ordinaryPath(parent);
  // lstat catches dangling links too; existsSync alone does not.
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
    throw new Error('Cannot inspect local path', { cause: error });
  }
  const canonical = realpathSync(path);
  const same =
    process.platform === 'win32'
      ? canonical.toLowerCase() === path.toLowerCase()
      : canonical === path;
  if (stat.isSymbolicLink() || !same)
    throw new Error('Linked or redirected path rejected');
}

/** @param {string} path */
function regular(path) {
  ordinaryPath(path);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || !stat.size || stat.size > 16_384) {
    throw new Error('Expected a small, unlinked regular synthetic/public file');
  }
  return readFileSync(path);
}

/** No secrets are created here; this writes only synthetic test data.
 * @param {string} root
 */
export function prepare(root) {
  const directory = join(resolve(root), relativeDirectory);
  ordinaryPath(directory);
  if (existsSync(directory))
    throw new Error('Test environment already exists; never overwrite it');
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory);
  const write = (/** @type {string} */ name, /** @type {string} */ value) =>
    writeFileSync(join(directory, name), value, { flag: 'wx' });
  write('.gitignore', '*\n');
  write('TEST-ONLY.json', policy);
  write(
    'encryption-probe.txt',
    'Disposable Slate encryption probe. NOT AN INSTALLER.\n',
  );
  for (const name of names)
    write(`synthetic-${name}.txt`, known.cases[name].artifact);
  return directory;
}

/** Public packet mutation, not key generation; no private component exists.
 * @param {string} publicKey
 */
export function wrongPublicKey(publicKey) {
  const lines = Buffer.from(publicKey.trim(), 'base64')
    .toString('utf8')
    .split('\n');
  const packet = Buffer.from(lines[1], 'base64');
  packet[20] ^= 1;
  lines[1] = packet.toString('base64');
  return Buffer.from(lines.join('\n')).toString('base64');
}

/** Preserve useful OS failure codes, never child messages, arguments or output.
 * @param {{error?: unknown, signal?: string | null, status: number | null}} result
 */
export function assertVerifierStarted(result) {
  if (result.error || result.signal || result.status === null) {
    const code =
      result.error && typeof result.error === 'object' && 'code' in result.error
        ? result.error.code
        : undefined;
    const safeCode =
      typeof code === 'string' &&
      [
        'ENOENT',
        'EACCES',
        'EPERM',
        'EINVAL',
        'ENOEXEC',
        'ETIMEDOUT',
        'ENOBUFS',
      ].includes(code)
        ? code
        : result.signal
          ? 'SIGNAL'
          : 'UNKNOWN';
    throw new Error(`Gate A1 could not execute (${safeCode})`);
  }
  if (result.status >>> 0 >= 0x80000000) {
    throw new Error(
      `Gate A1 could not execute (0x${(result.status >>> 0).toString(16).toUpperCase().padStart(8, '0')})`,
    );
  }
}

/** @param {string} directory @param {string} verifier */
export function verify(directory, verifier) {
  ordinaryPath(directory);
  ordinaryPath(verifier);
  if (!lstatSync(verifier).isFile())
    throw new Error('Missing Gate A1 verifier');
  if (regular(join(directory, 'TEST-ONLY.json')).toString() !== policy) {
    throw new Error('Test-only policy mismatch');
  }
  const allowed = new Set([
    '.gitignore',
    'TEST-ONLY.json',
    'disposable-test.key',
    'disposable-test.key.pub',
    'encryption-probe.txt',
    'encryption-probe.txt.sig',
    ...names.flatMap((name) => [
      `synthetic-${name}.txt`,
      `synthetic-${name}.txt.sig`,
    ]),
  ]);
  for (const name of readdirSync(directory)) {
    if (name === 'negative-cases')
      throw new Error('Verification output already exists; never overwrite it');
    if (!allowed.has(name))
      throw new Error('Unexpected file in test environment');
    // Inspect metadata only for the private key; NEVER open or read it.
    ordinaryPath(join(directory, name));
    const stat = lstatSync(join(directory, name));
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error('Linked or non-regular test input rejected');
  }
  const publicPath = join(directory, 'disposable-test.key.pub');
  const publicBytes = regular(publicPath);
  const fingerprint = hash(
    Buffer.from(publicBytes.toString().trim(), 'base64'),
  );
  const negative = join(directory, 'negative-cases');
  const checks = [];

  /** @param {string} key @param {string} artifact @param {string} signature @param {string} version @param {string | null} errorCode */
  const check = (key, artifact, signature, version, errorCode) => {
    const result = spawnSync(
      verifier,
      [
        '--public-key',
        key,
        '--artifact',
        artifact,
        '--signature',
        signature,
        '--expected-version',
        version,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 16_384,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => !/KEY|PASS|TOKEN|SECRET|CREDENTIAL/i.test(name),
          ),
        ),
      },
    );
    assertVerifierStarted(result);
    if (errorCode) {
      if (
        result.status === 0 ||
        result.stdout !== '' ||
        result.stderr.trim() !== `signature verification failed: ${errorCode}`
      ) {
        throw new Error('Gate A1 did not reject the negative case as required');
      }
    } else {
      if (result.status !== 0)
        throw new Error('Gate A1 rejected the baseline signature');
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        throw new Error('Invalid Gate A1 report');
      }
      const bytes = regular(artifact);
      if (
        report.verified !== true ||
        report.version !== version ||
        report.bytes !== bytes.length ||
        report.artifactSha256 !== hash(bytes) ||
        report.signatureSha256 !== hash(regular(signature)) ||
        report.publicKeySha256 !== fingerprint
      )
        throw new Error('Gate A1 verified input snapshot mismatch');
    }
  };
  // Authenticate both untouched baselines BEFORE writing negative-case files.
  for (const name of names) {
    const artifact = join(directory, `synthetic-${name}.txt`);
    if (regular(artifact).toString() !== known.cases[name].artifact)
      throw new Error('Synthetic fixture mismatch');
    regular(`${artifact}.sig`);
    check(publicPath, artifact, `${artifact}.sig`, TEST_VERSION, null);
    checks.push({
      architectureLabel: name,
      scenario: 'correct signature',
      passed: true,
    });
  }
  mkdirSync(negative);
  const wrongKey = join(negative, 'incorrect-public-key.pub');
  writeFileSync(wrongKey, wrongPublicKey(publicBytes.toString()), {
    flag: 'wx',
  });
  for (const name of names) {
    const artifact = join(directory, `synthetic-${name}.txt`);
    const tampered = join(negative, `tampered-${name}.txt`);
    const corrupted = join(negative, `corrupted-${name}.sig`);
    writeFileSync(tampered, `${known.cases[name].artifact}tampered\n`, {
      flag: 'wx',
    });
    writeFileSync(corrupted, 'corrupted synthetic signature\n', { flag: 'wx' });
    for (const [scenario, key, file, signature, version, code] of [
      [
        'tampered artifact',
        publicPath,
        tampered,
        `${artifact}.sig`,
        TEST_VERSION,
        'signature_invalid',
      ],
      [
        'incorrect public key',
        wrongKey,
        artifact,
        `${artifact}.sig`,
        TEST_VERSION,
        'signature_invalid',
      ],
      [
        'incorrect signed version',
        publicPath,
        artifact,
        `${artifact}.sig`,
        '0.2.1',
        'signed_version_mismatch',
      ],
      [
        'corrupted signature',
        publicPath,
        artifact,
        corrupted,
        TEST_VERSION,
        'signature_invalid',
      ],
    ]) {
      check(key, file, signature, version, code);
      checks.push({ architectureLabel: name, scenario, passed: true });
    }
  }
  return {
    testOnly: true,
    installationEnabled: false,
    version: TEST_VERSION,
    publicKeySha256: fingerprint,
    checks,
  };
}

function preflight() {
  assertCleanEnvironment(process.env);
  ordinaryPath(worktree);
  const branch = spawnSync(
    'git',
    ['-C', worktree, 'branch', '--show-current'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (branch.status !== 0 || branch.stdout.trim() !== 'codex/desktop-updater')
    throw new Error('Wrong worktree branch');
  const cli = JSON.parse(
    readFileSync(
      join(worktree, 'apps/desktop/node_modules/@tauri-apps/cli/package.json'),
      'utf8',
    ),
  );
  if (cli.version !== '2.12.2')
    throw new Error('Pinned Tauri CLI 2.12.2 required');
  const config = JSON.parse(
    readFileSync(
      join(worktree, 'apps/desktop/src-tauri/tauri.conf.json'),
      'utf8',
    ),
  );
  if (config.plugins?.updater || config.bundle?.createUpdaterArtifacts)
    throw new Error(
      'Production updater configuration changed; stop for review',
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const command = process.argv[2];
    if (
      process.argv.length !== 3 ||
      !['preflight', 'prepare', 'verify'].includes(command)
    )
      throw new Error('Use exactly one command: preflight, prepare or verify');
    preflight();
    const directory = join(worktree, relativeDirectory);
    const report =
      command === 'prepare'
        ? {
            prepared: true,
            testOnly: true,
            directory: prepare(worktree),
            keysGenerated: false,
          }
        : command === 'verify'
          ? verify(directory, buildVerifier().executable)
          : { preflightPassed: true, keysGenerated: false };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    // Never forward child output, inputs, environment values or filesystem errors.
    process.stderr.write(
      error instanceof Error &&
        /^Gate A1 could not execute \((?:ENOENT|EACCES|EPERM|EINVAL|ENOEXEC|ETIMEDOUT|ENOBUFS|SIGNAL|UNKNOWN|0x[0-9A-F]{8})\)$/.test(
          error.message,
        )
        ? `${error.message}\n`
        : 'Disposable TEST ceremony rejected. Check branch, clean environment, pinned CLI, local paths and documented inputs.\n',
    );
    process.exitCode = 1;
  }
}
