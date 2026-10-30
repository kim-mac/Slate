import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { before, test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { buildVerifier } from './build-update-signature-verifier.mjs';

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      './update-signature-verifier/fixtures/signatures.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
let verifier;
before(() => {
  verifier = buildVerifier().executable;
});
const validator = fileURLToPath(
  new URL('./validate-desktop-update-release.mjs', import.meta.url),
);
const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex').toUpperCase();

test('rejects nonlocal inputs with a pure preflight before I/O', async () => {
  const module = await import('./validate-desktop-update-release.mjs');
  assert.equal(
    typeof module.localInputPath,
    'function',
    'local path preflight is required',
  );
  for (const path of [
    String.fromCharCode(92, 47) + 'example.invalid/share/key.pub',
    String.fromCharCode(47, 92) + 'example.invalid/share/key.pub',
    'https://example.invalid/key.pub',
    'file:///C:/key.pub',
    '\\\\example.invalid\\share\\key.pub',
    '//example.invalid/share/tool.exe',
    '\\\\?\\C:\\key.pub',
    'C:ambiguous.pub',
    'key.pub:stream',
  ]) {
    assert.throws(() => module.localInputPath(path), /local/);
  }
});

test('sidecar hash binds the same bytes checked against the manifest despite a concurrent write', async (t) => {
  const { validateManifestJson, validateArtifacts, verifyReleaseArtifacts } =
    await import('./validate-desktop-update-release.mjs');
  const paths = release(t);
  const input = JSON.parse(readFileSync(paths.manifest, 'utf8'));
  const sidecar = join(paths.directory, 'Slate-0.2.0-Windows-x64.exe.sig');
  const originalBytes = readFileSync(sidecar);
  // A substituted valid ARM64 signature would authenticate these bytes, but it
  // is NOT the x64 signature declared by the manifest.
  writeFileSync(
    join(paths.directory, 'Slate-0.2.0-Windows-x64.exe'),
    fixtures.cases.arm64.artifact,
  );
  const handle = await open(sidecar, 'r');
  const prototype = Object.getPrototypeOf(handle);
  const originalRead = prototype.readFile;
  await handle.close();
  let changed = false;
  // Real files and real reads; this single boundary hook deterministically models
  // an external in-place write immediately after the equality-check read.
  t.mock.method(prototype, 'readFile', async function (...args) {
    const result = await Reflect.apply(originalRead, this, args);
    if (!changed && Buffer.from(result).equals(originalBytes)) {
      changed = true;
      writeFileSync(sidecar, fixtures.cases.arm64.signature);
    }
    return result;
  });
  const snapshot = await validateArtifacts(
    validateManifestJson(JSON.stringify(input), '0.2.0'),
    paths.directory,
  );
  assert.equal(changed, true);
  assert.equal(
    snapshot.find((item) => item.filename === 'Slate-0.2.0-Windows-x64.exe.sig')
      .sha256,
    sha256(originalBytes),
  );
  writeFileSync(sidecar, originalBytes);
  changed = false;
  await assert.rejects(
    verifyReleaseArtifacts(
      validateManifestJson(JSON.stringify(input), '0.2.0'),
      paths.directory,
      paths.publicKey,
      verifier,
    ),
    /verified inputs do not match/,
  );
});

for (const input of ['public key', 'verifier']) {
  test(`combined gate preflights nonlocal ${input} before reading any candidate files`, async (t) => {
    const { validateManifestJson, verifyReleaseArtifacts } =
      await import('./validate-desktop-update-release.mjs');
    const paths = release(t);
    const contract = validateManifestJson(
      readFileSync(paths.manifest, 'utf8'),
      '0.2.0',
    );
    // An old implementation fails first on this missing LOCAL directory; it
    // cannot reach the UNC path. Thus the regression itself stays offline.
    const missingDirectory = join(paths.directory, 'never-created');
    await assert.rejects(
      verifyReleaseArtifacts(
        contract,
        missingDirectory,
        input === 'public key'
          ? '\\\\example.invalid\\share\\key.pub'
          : paths.publicKey,
        input === 'verifier'
          ? '\\\\example.invalid\\share\\verifier.exe'
          : verifier,
      ),
      /local/,
    );
  });
}

function staging(t, name = 'x64') {
  const directory = mkdtempSync(join(tmpdir(), 'slate-offline-verification-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifact = join(directory, 'fixture.bin');
  const publicKey = join(directory, 'fixture.pub');
  const signature = `${artifact}.sig`;
  writeFileSync(artifact, fixtures.cases[name].artifact);
  writeFileSync(publicKey, fixtures.publicKey);
  writeFileSync(signature, fixtures.cases[name].signature);
  return { directory, artifact, publicKey, signature };
}

function run(paths, expectedVersion = '0.2.0', extra = []) {
  assert.ok(
    existsSync(verifier),
    'Build the public-key-only verifier before running these tests',
  );
  return spawnSync(
    verifier,
    [
      '--public-key',
      paths.publicKey,
      '--artifact',
      paths.artifact,
      '--signature',
      paths.signature,
      '--expected-version',
      expectedVersion,
      ...extra,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
}

for (const [name, expected] of [
  ['x64', '0.2.0'],
  ['arm64', '0.2.0'],
  ['legacy', '0.2.0'],
  ['prefixed', '0.2.0'],
  ['otherVersion', '0.2.1'],
  ['prerelease', '0.2.0-test.1'],
]) {
  test(`authenticates ${name} fixture and hashes exactly the verified bytes`, (t) => {
    const paths = staging(t, name);
    const before = [paths.artifact, paths.publicKey, paths.signature].map(
      (path) => readFileSync(path),
    );
    const result = run(paths, expected);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.verified, true);
    assert.equal(report.version, expected);
    assert.equal(report.bytes, before[0].length);
    assert.equal(report.artifactSha256, sha256(before[0]));
    assert.equal(report.signatureSha256, sha256(before[2]));
    assert.equal(
      report.publicKeySha256,
      sha256(Buffer.from(fixtures.publicKey, 'base64')),
    );
    assert.deepEqual(
      [paths.artifact, paths.publicKey, paths.signature].map((path) =>
        readFileSync(path),
      ),
      before,
    );
  });
}

const failures = [
  [
    'wrong public key',
    (p) => {
      const lines = Buffer.from(fixtures.publicKey, 'base64')
        .toString()
        .split('\n');
      const packet = Buffer.from(lines[1], 'base64');
      packet[20] ^= 1;
      lines[1] = packet.toString('base64');
      writeFileSync(
        p.publicKey,
        Buffer.from(lines.join('\n')).toString('base64'),
      );
    },
    '0.2.0',
    /signature_invalid/,
  ],
  [
    'tampered bytes',
    (p) => writeFileSync(p.artifact, `${fixtures.cases.x64.artifact}tampered`),
    '0.2.0',
    /signature_invalid/,
  ],
  [
    'empty artifact',
    (p) => writeFileSync(p.artifact, ''),
    '0.2.0',
    /artifact_invalid/,
  ],
  [
    'corrupt signature',
    (p) => writeFileSync(p.signature, 'invalid signature'),
    '0.2.0',
    /signature_invalid/,
  ],
  [
    'missing signed version',
    (p) => {
      writeFileSync(p.artifact, fixtures.cases.missingVersion.artifact);
      writeFileSync(p.signature, fixtures.cases.missingVersion.signature);
    },
    '0.2.0',
    /missing_signed_version/,
  ],
  ['version mismatch', () => {}, '0.2.1', /signed_version_mismatch/],
  [
    'malformed expected version',
    () => {},
    'not-semver',
    /invalid_expected_version/,
  ],
  [
    'expected version whitespace',
    () => {},
    '0.2.0\n',
    /invalid_expected_version/,
  ],
  [
    'invalid public input',
    (p) => writeFileSync(p.publicKey, 'never-echo-this-fixture-input'),
    '0.2.0',
    /public_key_invalid/,
  ],
  [
    'missing public key file',
    (p) => rmSync(p.publicKey),
    '0.2.0',
    /public_key_invalid/,
  ],
  [
    'missing signature file',
    (p) => rmSync(p.signature),
    '0.2.0',
    /signature_invalid/,
  ],
  ['missing artifact', (p) => rmSync(p.artifact), '0.2.0', /artifact_invalid/],
  [
    'directory artifact',
    (p) => {
      p.artifact = p.directory;
    },
    '0.2.0',
    /artifact_invalid/,
  ],
  [
    'remote artifact argument',
    (p) => {
      p.artifact = 'https://example.invalid/fixture.exe';
    },
    '0.2.0',
    /invalid_local_path/,
  ],
  [
    'remote signature argument',
    (p) => {
      p.signature = 'https://example.invalid/fixture.sig';
    },
    '0.2.0',
    /invalid_local_path/,
  ],
  [
    'remote public key argument',
    (p) => {
      p.publicKey = 'https://example.invalid/key.pub';
    },
    '0.2.0',
    /invalid_local_path/,
  ],
  [
    'oversized signature',
    (p) => writeFileSync(p.signature, 'x'.repeat(20_000)),
    '0.2.0',
    /signature_invalid/,
  ],
];
for (const [name, change, expected, error] of failures) {
  test(`fails closed on ${name}`, (t) => {
    const paths = staging(t);
    change(paths);
    const result = run(paths, expected);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, error);
    assert.ok(
      !`${result.stdout}${result.stderr}`.includes(
        'never-echo-this-fixture-input',
      ),
    );
  });
}

for (const change of [
  'trusted comment',
  'primary signature',
  'global signature',
]) {
  test(`authenticates ${change} before trusting its version`, (t) => {
    const paths = staging(t);
    const lines = Buffer.from(fixtures.cases.x64.signature, 'base64')
      .toString()
      .split('\n');
    if (change === 'trusted comment')
      lines[2] = lines[2].replace('0.2.0', '0.2.1');
    else {
      const index = change === 'primary signature' ? 1 : 3;
      const packet = Buffer.from(lines[index], 'base64');
      packet[packet.length - 1] ^= 1;
      lines[index] = packet.toString('base64');
    }
    writeFileSync(
      paths.signature,
      Buffer.from(lines.join('\n')).toString('base64'),
    );
    const result = run(paths, change === 'trusted comment' ? '0.2.1' : '0.2.0');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /signature_invalid/);
  });
}

test('requires all explicit inputs and rejects duplicate, private-key, or unknown options', (t) => {
  const paths = staging(t);
  for (const extra of [
    ['--private-key', 'never-echo-this-fixture-input'],
    ['--expected-version', '0.2.0'],
    ['--unknown', 'x'],
  ]) {
    const result = run(paths, '0.2.0', extra);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid_arguments/);
    assert.ok(!result.stderr.includes('never-echo-this-fixture-input'));
  }
  assert.notEqual(spawnSync(verifier, [], { encoding: 'utf8' }).status, 0);
});

function release(t) {
  const paths = staging(t);
  const platforms = {};
  for (const [platform, name, architecture] of [
    ['windows-x86_64', 'x64', 'x64'],
    ['windows-aarch64', 'arm64', 'ARM64'],
  ]) {
    const filename = `Slate-0.2.0-Windows-${architecture}.exe`;
    writeFileSync(
      join(paths.directory, filename),
      fixtures.cases[name].artifact,
    );
    writeFileSync(
      join(paths.directory, `${filename}.sig`),
      fixtures.cases[name].signature,
    );
    platforms[platform] = {
      url: `https://github.com/kim-mac/Slate/releases/download/v0.2.0/${filename}`,
      signature: fixtures.cases[name].signature,
    };
  }
  const manifest = join(paths.directory, 'stable.json');
  writeFileSync(manifest, JSON.stringify({ version: '0.2.0', platforms }));
  const args = [
    validator,
    '--version',
    '0.2.0',
    '--manifest',
    manifest,
    '--artifacts',
    paths.directory,
    '--public-key',
    paths.publicKey,
    '--verifier',
    verifier,
  ];
  return { ...paths, manifest, args };
}

test('Step 1 contract plus cryptographic gate verifies both architecture pairs', (t) => {
  const paths = release(t);
  const result = spawnSync(process.execPath, paths.args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.contractValid, true);
  assert.equal(report.cryptographicallyVerified, true);
  assert.equal(report.payloadArchitectureVerified, false);
  assert.equal(report.remoteImmutabilityVerified, false);
  assert.equal(report.artifacts.length, 4);
  assert.equal(report.verifications.length, 2);
  assert.equal(
    report.verifications[0].publicKeySha256,
    report.verifications[1].publicKeySha256,
  );
});

for (const failure of [
  'tampered ARM64',
  'signature disagreement',
  'wrong architecture URL',
  'unsigned version',
  'missing verifier',
  'missing public key',
]) {
  test(`combined gate rejects ${failure}`, (t) => {
    const paths = release(t);
    if (failure === 'tampered ARM64')
      writeFileSync(
        join(paths.directory, 'Slate-0.2.0-Windows-ARM64.exe'),
        'tampered',
      );
    if (failure === 'signature disagreement')
      writeFileSync(
        join(paths.directory, 'Slate-0.2.0-Windows-x64.exe.sig'),
        fixtures.cases.arm64.signature,
      );
    if (
      failure === 'wrong architecture URL' ||
      failure === 'unsigned version'
    ) {
      const input = JSON.parse(readFileSync(paths.manifest, 'utf8'));
      if (failure === 'wrong architecture URL')
        input.platforms['windows-x86_64'].url =
          input.platforms['windows-aarch64'].url;
      else
        input.platforms['windows-x86_64'].signature =
          fixtures.cases.missingVersion.signature;
      writeFileSync(paths.manifest, JSON.stringify(input));
    }
    if (failure === 'missing verifier') paths.args.splice(-2);
    if (failure === 'missing public key') paths.args.splice(-4, 2);
    const result = spawnSync(process.execPath, paths.args, {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  });
}
