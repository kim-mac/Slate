import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { sourceInventory } from '../updater-e2e/prepare.mjs';
import { validateManifestJson } from '../validate-desktop-update-release.mjs';

const api = await import('./production-rehearsal.mjs').catch(() => ({}));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const crate = 'apps/desktop/src-tauri';
const read = (path) => readFileSync(join(root, path), 'utf8');
const currentSource = JSON.parse(read(`${crate}/tauri.conf.json`));
// Preserve the fixed historical rehearsal, not the current release version.
const source = { ...currentSource, version: '0.3.0' };
const acknowledgement = 'private-production-0.2.9-to-0.3.0-no-public-release';
const now = Date.UTC(2026, 9, 19, 12);
const policy = {
  accountId: 'a'.repeat(32),
  bucket: 'slate-updater-rehearsal',
  prefix: 'slate-rehearsal/production-v029-v030-unit',
};
function endpoint() {
  const url = new URL(
    `https://${policy.accountId}.r2.cloudflarestorage.com/${policy.bucket}/${policy.prefix}/updates/windows/rehearsal.json`,
  );
  for (const [key, value] of Object.entries({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': 'SYNTHETICACCESSID/20261019/auto/s3/aws4_request',
    'X-Amz-Date': '20261019T110000Z',
    'X-Amz-Expires': '518400',
    'X-Amz-SignedHeaders': 'host',
    'X-Amz-Signature': 'b'.repeat(64),
  }))
    url.searchParams.set(key, value);
  return url.href;
}

test('only production trust and the fixed 0.2.9 to 0.3.0 roles are accepted', () => {
  assert.equal(typeof api.configuration, 'function');
  const before = JSON.stringify(source);
  const baseline = api.configuration(
    source,
    'baseline',
    endpoint(),
    policy,
    now,
  );
  const candidate = api.configuration(
    source,
    'candidate',
    undefined,
    undefined,
    now,
  );
  assert.equal(baseline.version, '0.2.9');
  assert.equal(candidate.version, '0.3.0');
  assert.equal(baseline.plugins.updater.pubkey, source.plugins.updater.pubkey);
  assert.deepEqual(baseline.plugins.updater.endpoints, [endpoint()]);
  assert.deepEqual(candidate.plugins.updater.endpoints, [
    'https://tryslate.tech/updates/windows/latest.json',
  ]);
  assert.deepEqual(candidate.bundle, source.bundle);
  assert.deepEqual(candidate.app, source.app);
  assert.equal(JSON.stringify(source), before);
  assert.throws(() =>
    api.configuration(source, 'release', endpoint(), policy, now),
  );
  for (const key of [
    read('scripts/windows/updater-rehearsal/test-public-key.pub').trim(),
    JSON.parse(
      read(
        'scripts/windows/update-signature-verifier/fixtures/signatures.json',
      ),
    ).publicKey,
    '',
  ]) {
    const changed = JSON.parse(before);
    changed.plugins.updater.pubkey = key;
    assert.throws(
      () => api.configuration(changed, 'baseline', endpoint(), policy, now),
      /trust/,
    );
  }
  for (const flag of [
    'allowDowngrades',
    'dangerousAcceptInvalidCerts',
    'dangerousAcceptInvalidHostnames',
    'dangerousInsecureTransportProtocol',
  ]) {
    const changed = JSON.parse(before);
    changed.plugins.updater[flag] = true;
    assert.throws(() => api.configuration(changed, 'candidate'), /trust/);
  }
});

test('historical production rehearsal rejects current v0.3.1 source', () => {
  assert.equal(currentSource.version, '0.3.1');
  assert.throws(() => api.configuration(currentSource, 'candidate'));
});

test('private baseline URL policy refuses public, expired, wrong namespace and unknown inputs', () => {
  assert.equal(typeof api.configuration, 'function');
  for (const [url, p, time] of [
    ['https://tryslate.tech/updates/windows/latest.json', policy, now],
    [endpoint().replace('https:', 'http:'), policy, now],
    [endpoint(), { ...policy, prefix: 'slate-rehearsal/v022-v023-r1' }, now],
    [endpoint(), policy, now + 7 * 86400000],
    [endpoint() + '&unknown=secret-sentinel', policy, now],
  ])
    assert.throws(
      () => api.configuration(source, 'baseline', url, p, time),
      (e) => !String(e).includes('secret-sentinel'),
    );
  assert.throws(() =>
    api.configuration(source, 'candidate', endpoint(), policy, now),
  );
});

test('rehearsal opt-ins replace configured Windows enablement only in the ignored copy', () => {
  assert.equal(typeof api.rehearsalController, 'function');
  const original = read(`${crate}/src/updater/mod.rs`);
  const staged = api.rehearsalController(original);
  assert.match(
    original,
    /installation_enabled: cfg!\(windows\) && driver\.configured\(\),/,
  );
  assert.doesNotMatch(original, /SLATE_PRIVATE_REHEARSAL/);
  assert.match(staged, /option_env!\("SLATE_PRIVATE_REHEARSAL_BUILD"\)/);
  assert.match(staged, /std::env::var\("SLATE_PRIVATE_REHEARSAL_RUN"\)/);
  assert.match(
    staged,
    /\["0.2.9", "0.3.0"\]\.contains\(&env!\("CARGO_PKG_VERSION"\)\)/,
  );
  assert.match(
    staged,
    /Some\("private-production-0.2.9-to-0.3.0-no-public-release"\)/,
  );
  assert.match(
    staged,
    /Ok\("private-production-0.2.9-to-0.3.0-no-public-release"\)/,
  );
  assert.throws(() => api.rehearsalController(staged));
  assert.throws(() =>
    api.rehearsalController(
      original.replace(
        'installation_enabled: cfg!(windows) && driver.configured(),',
        'installation_enabled: true,',
      ),
    ),
  );
  assert.equal(
    api.rehearsalController(
      original.replace(
        'installation_enabled: cfg!(windows) && driver.configured(),',
        'installation_enabled: false,',
      ),
    ),
    staged,
  );
  assert.match(
    staged,
    /installation_enabled: option_env!\("SLATE_PRIVATE_REHEARSAL_BUILD"\)\s*== Some\("[^"\n]+"\)\s*&& std::env::var\("SLATE_PRIVATE_REHEARSAL_RUN"\)\.as_deref\(\)\s*== Ok\("[^"\n]+"\)\s*&&/,
  );
});

test('fresh isolated copies preserve identity and source, stage consistent versions, and fail closed on missing opt-in or tampering', () => {
  assert.equal(typeof api.prepare, 'function');
  const parent = join(root, 'dist/test');
  mkdirSync(parent, { recursive: true });
  const fixture = mkdtempSync(join(parent, 'production-rehearsal-unit-'));
  const extra = [
    'package.json',
    'apps/desktop/package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ];
  for (const path of [...sourceInventory(root).map((i) => i.path), ...extra]) {
    const destination = join(fixture, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, path), destination);
  }
  // Only the synthetic test tree gets the historical metadata. The operational
  // helper's source-version guards and permitted candidate versions stay fixed.
  for (const path of [
    'package.json',
    'apps/desktop/package.json',
    `${crate}/tauri.conf.json`,
  ]) {
    const destination = join(fixture, path);
    const document = JSON.parse(readFileSync(destination, 'utf8'));
    assert.equal(document.version, '0.3.1');
    document.version = '0.3.0';
    writeFileSync(destination, JSON.stringify(document));
  }
  for (const [path, pattern] of [
    [`${crate}/Cargo.toml`, /(^\[package\][\s\S]*?\nversion = ")([^"]+)(")/m],
    [
      `${crate}/Cargo.lock`,
      /(name = "ai-clip-memory-desktop"\r?\nversion = ")([^"]+)(")/,
    ],
  ]) {
    const destination = join(fixture, path);
    const original = readFileSync(destination, 'utf8');
    writeFileSync(
      destination,
      original.replace(pattern, (_match, before, version, after) => {
        assert.equal(version, '0.3.1');
        return before + '0.3.0' + after;
      }),
    );
  }
  const frontend = join(fixture, 'dist/test/frontend');
  mkdirSync(frontend, { recursive: true });
  writeFileSync(
    join(frontend, 'index.html'),
    '<!doctype html><title>Synthetic frontend; not a build</title>',
  );
  const input = {
    acknowledgement,
    frontendDist: frontend,
    baselineEndpoint: endpoint(),
    policy,
  };
  const output = join(fixture, 'dist/test/updater-production-rehearsal');
  for (const change of [
    { acknowledgement: undefined },
    { acknowledgement: 'public' },
    { privateKey: 'DO-NOT-READ' },
  ]) {
    assert.throws(() => api.prepare({ ...input, ...change }, fixture, now));
    assert.equal(existsSync(output), false);
  }
  const before = sourceInventory(fixture);
  const result = api.prepare(input, fixture, now);
  assert.equal(result.privateOnly, true);
  assert.equal(result.buildExecuted, false);
  assert.equal(result.publicationAllowed, false);
  assert.deepEqual(sourceInventory(fixture), before);
  for (const role of ['baseline', 'candidate']) {
    const path = result[role];
    const version = role === 'baseline' ? '0.2.9' : '0.3.0';
    for (const file of [
      'package.json',
      'apps/desktop/package.json',
      `${crate}/tauri.conf.json`,
    ])
      assert.equal(
        JSON.parse(readFileSync(join(path, file), 'utf8')).version,
        version,
      );
    for (const file of ['Cargo.toml', 'Cargo.lock'])
      assert.match(
        readFileSync(join(path, crate, file), 'utf8'),
        new RegExp(`version = "${version.replaceAll('.', '\\.')}"`),
      );
    assert.match(
      readFileSync(join(path, crate, 'build.rs'), 'utf8'),
      /rerun-if-env-changed=SLATE_PRIVATE_REHEARSAL_BUILD/,
    );
    for (const file of [
      'windows/installer.nsi',
      'windows/installer-hooks.nsh',
      'windows/maintenance-gate.nsh',
      'src/updater/tauri_driver.rs',
      'src/updater/handoff.rs',
      'src/storage.rs',
    ])
      assert.equal(
        readFileSync(join(path, crate, file), 'utf8'),
        read(`${crate}/${file}`),
      );
    assert.equal(
      existsSync(join(path, 'dist/test/updater-disposable-signing')),
      false,
    );
    for (const architecture of ['x64', 'arm64']) {
      assert.throws(() =>
        api.buildPlan(path, architecture, undefined, fixture, now),
      );
      const plan = api.buildPlan(
        path,
        architecture,
        acknowledgement,
        fixture,
        now,
      );
      assert.equal(plan.profile, 'release');
      assert.equal(plan.publicationAllowed, false);
      assert.match(plan.artifact.filename, /^Slate-PRIVATE-REHEARSAL-/);
      assert.equal(
        plan.commands[1].env.SLATE_PRIVATE_REHEARSAL_BUILD,
        acknowledgement,
      );
      assert.equal(plan.commands[1].env.SLATE_PRIVATE_REHEARSAL_RUN, undefined);
      assert.ok(!JSON.stringify(plan).includes('X-Amz-'));
      assert.ok(!plan.commands.some((c) => c.args.includes('--debug')));
      assert.match(
        plan.artifact.target,
        architecture === 'x64' ? /^x86_64-/ : /^aarch64-/,
      );
    }
    assert.throws(() =>
      api.buildPlan(path, 'x86', acknowledgement, fixture, now),
    );
  }
  const candidate = result.candidate;
  const inventoryPath = join(candidate, 'private-rehearsal-inventory.json');
  const originalInventory = readFileSync(inventoryPath, 'utf8');
  const incomplete = JSON.parse(originalInventory);
  incomplete.staged = incomplete.staged.filter(
    (f) => f.path !== `${crate}/src/updater/handoff.rs`,
  );
  const handoffPath = join(candidate, crate, 'src/updater/handoff.rs');
  const originalHandoff = readFileSync(handoffPath);
  writeFileSync(inventoryPath, JSON.stringify(incomplete));
  writeFileSync(handoffPath, 'tampered and omitted from inventory');
  assert.throws(
    () => api.buildPlan(candidate, 'arm64', acknowledgement, fixture, now),
    /inventory/,
  );
  writeFileSync(inventoryPath, originalInventory);
  writeFileSync(handoffPath, originalHandoff);
  for (const file of JSON.parse(
    readFileSync(join(candidate, 'private-rehearsal-inventory.json'), 'utf8'),
  ).staged) {
    const bytes = readFileSync(join(candidate, file.path), 'utf8');
    assert.ok(!bytes.includes(endpoint()));
    assert.doesNotMatch(
      bytes,
      /X-Amz-Credential=|\.r2\.cloudflarestorage\.com/,
    );
  }
  writeFileSync(join(candidate, crate, 'src/updater/mod.rs'), 'tampered');
  assert.throws(() =>
    api.buildPlan(candidate, 'arm64', acknowledgement, fixture, now),
  );
  assert.deepEqual(sourceInventory(fixture), before);
  assert.equal(readdirSync(output).length, 1);
});

test('private artifacts cannot satisfy the production release URL and naming contract', () => {
  assert.equal(typeof api.artifacts, 'function');
  for (const version of ['0.2.9', '0.3.0']) {
    const mappings = api.artifacts(version);
    assert.deepEqual(
      mappings.map((a) => a.platform),
      ['windows-x86_64', 'windows-aarch64'],
    );
    assert.throws(
      () =>
        validateManifestJson(
          JSON.stringify({
            version,
            platforms: Object.fromEntries(
              mappings.map((a) => [
                a.platform,
                {
                  url: `https://github.com/kim-mac/Slate/releases/download/v${version}/${a.filename}`,
                  signature: 'not signed',
                },
              ]),
            ),
          }),
          version,
        ),
      /url/,
    );
  }
  assert.throws(() => api.artifacts('0.3.1'));
  const hash = createHash('sha256')
    .update(Buffer.from(source.plugins.updater.pubkey, 'base64'))
    .digest('hex')
    .toUpperCase();
  assert.equal(
    hash,
    '2641A4781B6B0004D449EE4DE626E8378A87AC89C3800A405972F0ACAA59AFC9',
  );
});

function privateManifest(version = '0.3.0') {
  // Structurally well-formed only, deliberately NOT a cryptographic signature.
  const packet = Buffer.alloc(74, 1);
  packet.write('ED');
  const signature = Buffer.from(
    [
      'untrusted comment: synthetic unsigned fixture',
      packet.toString('base64'),
      `trusted comment: timestamp:1\tfile:synthetic\tversion:${version}`,
      Buffer.alloc(64, 1).toString('base64'),
      '',
    ].join('\n'),
  ).toString('base64');
  return {
    version,
    platforms: Object.fromEntries(
      api.artifacts(version).map((a) => {
        const url = new URL(endpoint());
        url.pathname = `/${policy.bucket}/${policy.prefix}/${version}/${a.filename}`;
        return [a.platform, { url: url.href, signature }];
      }),
    ),
  };
}

test('private manifest adapter preserves strict schema, architecture, version and URL checks without claiming authentication', () => {
  assert.equal(typeof api.validatePrivateManifest, 'function');
  for (const version of ['0.2.9', '0.3.0']) {
    const contract = api.validatePrivateManifest(
      JSON.stringify(privateManifest(version)),
      version,
      policy,
      now,
    );
    assert.equal(contract.version, version);
    assert.equal(contract.artifacts.length, 2);
    assert.ok(
      contract.artifacts.every((a) =>
        a.filename.startsWith('Slate-PRIVATE-REHEARSAL-'),
      ),
    );
  }
  const text = JSON.stringify(privateManifest());
  for (const change of [
    (m) => {
      delete m.platforms['windows-aarch64'];
    },
    (m) => {
      m.platforms['windows-x86_64'].url = m.platforms['windows-aarch64'].url;
    },
    (m) => {
      m.platforms['windows-x86_64'].url += '&unknown=never-echo';
    },
    (m) => {
      m.platforms['windows-x86_64'].url = m.platforms[
        'windows-x86_64'
      ].url.replace('https:', 'http:');
    },
    (m) => {
      m.version = '0.2.9';
    },
    (m) => {
      m.installationEnabled = true;
    },
    (m) => {
      m.platforms['windows-x86_64'].signature = 'corrupt';
    },
  ]) {
    const altered = JSON.parse(text);
    change(altered);
    assert.throws(
      () =>
        api.validatePrivateManifest(
          JSON.stringify(altered),
          '0.3.0',
          policy,
          now,
        ),
      (e) => !String(e).includes('never-echo'),
    );
  }
  assert.throws(() =>
    api.validatePrivateManifest(
      text.replace('"version":', '"ver\\u0073ion":"0.3.0","version":'),
      '0.3.0',
      policy,
      now,
    ),
  );
  assert.throws(() =>
    api.validatePrivateManifest(text, '0.3.0', policy, now + 7 * 86400000),
  );
});

test('private manifest authentication rejects fixture and TEST trust before reading artifact or verifier inputs', async () => {
  assert.equal(typeof api.verifyPrivateRelease, 'function');
  const parent = mkdtempSync(
    join(root, 'dist/test/production-rehearsal-public-only-'),
  );
  for (const key of [
    read('scripts/windows/updater-rehearsal/test-public-key.pub'),
    JSON.parse(
      read(
        'scripts/windows/update-signature-verifier/fixtures/signatures.json',
      ),
    ).publicKey,
  ]) {
    const path = join(parent, 'wrong.pub');
    writeFileSync(path, key);
    await assert.rejects(
      api.verifyPrivateRelease(
        {
          text: JSON.stringify(privateManifest()),
          version: '0.3.0',
          policy,
          publicKeyPath: path,
          directory: 'MUST-NOT-READ',
          verifierPath: 'MUST-NOT-EXECUTE',
        },
        now,
      ),
      /Production trust mismatch/,
    );
  }
});
