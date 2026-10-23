// @ts-check
// Pure, offline preparation only. No filesystem writes, credentials or publication.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { validateManifestJson } from './validate-desktop-update-release.mjs';

export const TEST_PUBLIC_KEY_SHA256 =
  '9868697D6D22F6667160A764C94933FD9C754951E7840FEE51B0A7A93C7ED36D';

/** @param {string} version */
function approvedVersion(version) {
  assert.ok(
    ['0.2.2', '0.2.3'].includes(version),
    'Unapproved rehearsal version',
  );
  return version;
}

/** No asset origins are selected here. The stable release validator is unchanged.
 * @param {string} version
 */
export function rehearsalArtifacts(version) {
  approvedVersion(version);
  return [
    ['windows-x86_64', 'x86_64-pc-windows-msvc', 'x64'],
    ['windows-aarch64', 'aarch64-pc-windows-msvc', 'ARM64'],
  ].map(([platform, target, architecture]) => ({
    platform,
    target,
    installer: `Slate-${version}-Windows-${architecture}.exe`,
    signature: `Slate-${version}-Windows-${architecture}.exe.sig`,
  }));
}

/** Returns a candidate config only after the host and TEST public identity have
 * been explicitly supplied. Does not enable the Rust controller's installation
 * boundary, alter the normal HTTPS driver, or persist an endpoint/public key.
 * Temporary bearer URLs, if approved later, must be treated as sensitive files.
 * @param {Record<string, any>} source
 * @param {{version: string, endpoint: string, testPublicKey: string, expectedTestPublicKeySha256: string}} options
 */
export function rehearsalConfiguration(source, options) {
  assert.deepEqual(Object.keys(options).sort(), [
    'endpoint',
    'expectedTestPublicKeySha256',
    'testPublicKey',
    'version',
  ]);
  const { version, endpoint, testPublicKey, expectedTestPublicKeySha256 } =
    options;
  approvedVersion(version);
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('Invalid rehearsal endpoint');
  }
  assert.ok(
    url.href === endpoint &&
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.hostname.endsWith('.localhost') &&
      /^\/(?:[A-Za-z0-9_-]+\/)*updates\/windows\/rehearsal\.json$/.test(
        url.pathname,
      ),
    'Expected an explicit, isolated HTTPS rehearsal endpoint',
  );
  assert.ok(
    typeof testPublicKey === 'string' &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(testPublicKey),
    'Expected TEST public key',
  );
  const decoded = Buffer.from(testPublicKey, 'base64');
  const lines = decoded.toString('utf8').trimEnd().split(/\r?\n/);
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  assert.ok(
    decoded.toString('base64') === testPublicKey &&
      lines.length === 2 &&
      lines[0].startsWith('untrusted comment: ') &&
      packet.length === 42 &&
      packet.subarray(0, 2).toString('ascii') === 'Ed' &&
      packet.toString('base64') === lines[1],
    'Expected Tauri/minisign public-key envelope only',
  );
  assert.ok(
    typeof expectedTestPublicKeySha256 === 'string' &&
      expectedTestPublicKeySha256.toUpperCase() === TEST_PUBLIC_KEY_SHA256 &&
      createHash('sha256').update(decoded).digest('hex').toUpperCase() ===
        TEST_PUBLIC_KEY_SHA256,
    'TEST public-key fingerprint mismatch',
  );
  assert.equal(source.identifier, 'com.aiclipmemory.desktop');
  assert.equal(source.productName, 'AI Clip Memory');
  assert.deepEqual(source.bundle?.targets, ['nsis']);
  assert.equal(source.bundle?.windows?.allowDowngrades, false);
  assert.equal(source.bundle?.windows?.nsis?.installMode, 'currentUser');
  assert.ok(
    source.plugins?.updater === undefined,
    'Source updater must be unconfigured',
  );
  const config = JSON.parse(JSON.stringify(source));
  config.version = version;
  // Manual interactive signing is a later approval gate, after final byte audit.
  config.bundle.createUpdaterArtifacts = false;
  config.bundle.windows.webviewInstallMode = { type: 'skip' };
  config.plugins = {
    ...config.plugins,
    updater: {
      endpoints: [endpoint],
      pubkey: testPublicKey,
      requireSignedVersion: true,
      allowDowngrades: false,
      dangerousInsecureTransportProtocol: false,
      dangerousAcceptInvalidCerts: false,
      dangerousAcceptInvalidHostnames: false,
    },
  };
  return config;
}

/** @typedef {{accountId: string, bucket: string, prefix: string}} R2Policy */
/** Structural access-URL checks, NOT authentication of an R2 request signature.
 * Only explicit path-style S3 GET URLs are supported; no custom domains/redirects.
 * @param {string} input @param {R2Policy} policy @param {string} object
 * @param {number} [now]
 */
export function validateRehearsalUrl(input, policy, object, now = Date.now()) {
  try {
    assert.deepEqual(Object.keys(policy).sort(), [
      'accountId',
      'bucket',
      'prefix',
    ]);
    assert.match(policy.accountId, /^[a-f0-9]{32}$/);
    assert.match(policy.bucket, /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);
    assert.match(policy.prefix, /^slate-rehearsal\/[a-z0-9][a-z0-9-]{0,63}$/);
    assert.ok(Number.isFinite(now));
    assert.ok(
      object === 'updates/windows/rehearsal.json' ||
        rehearsalArtifacts(object.split('/')[0]).some(
          (a) => object === `${object.split('/')[0]}/${a.installer}`,
        ),
    );
    const url = new URL(input);
    assert.ok(
      url.href === input &&
        url.protocol === 'https:' &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        url.hostname === `${policy.accountId}.r2.cloudflarestorage.com` &&
        url.pathname === `/${policy.bucket}/${policy.prefix}/${object}`,
    );
    const required = [
      'X-Amz-Algorithm',
      'X-Amz-Credential',
      'X-Amz-Date',
      'X-Amz-Expires',
      'X-Amz-SignedHeaders',
      'X-Amz-Signature',
    ];
    const optional = ['X-Amz-Content-Sha256', 'x-amz-checksum-mode', 'x-id'];
    const entries = [...url.searchParams];
    assert.equal(
      new Set(entries.map(([key]) => key.toLowerCase())).size,
      entries.length,
    );
    assert.ok(
      entries.every(([key]) => [...required, ...optional].includes(key)) &&
        required.every((key) => url.searchParams.has(key)),
    );
    const get = (/** @type {string} */ key) => url.searchParams.get(key);
    assert.equal(get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
    assert.equal(get('X-Amz-SignedHeaders'), 'host');
    assert.match(get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/);
    const date = get('X-Amz-Date') ?? '';
    assert.match(date, /^\d{8}T\d{6}Z$/);
    const timestamp = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`;
    const signedAt = Date.parse(timestamp);
    assert.equal(
      new Date(signedAt).toISOString(),
      timestamp.replace('Z', '.000Z'),
    );
    assert.match(
      get('X-Amz-Credential') ?? '',
      new RegExp(
        `^[A-Za-z0-9]{16,128}/${date.slice(0, 8)}/auto/s3/aws4_request$`,
      ),
    );
    const expires = get('X-Amz-Expires') ?? '';
    assert.match(expires, /^[1-9][0-9]{0,5}$/);
    assert.ok(Number(expires) <= 604800);
    const expiresAt = signedAt + Number(expires) * 1000;
    assert.ok(now >= signedAt && now < expiresAt);
    for (const [key, value] of [
      ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
      ['x-amz-checksum-mode', 'ENABLED'],
      ['x-id', 'GetObject'],
    ])
      if (url.searchParams.has(key)) assert.equal(get(key), value);
    return { expiresAt: new Date(expiresAt).toISOString() };
  } catch {
    // Never attach the input, URL, query, assertion values or parsing exception.
    throw new Error('Rehearsal R2 URL/policy rejected');
  }
}

/** Keep the production validator unchanged: validate the actual R2 URL policy,
 * then substitute ONLY canonical URL string tokens in the raw JSON. Preserve all
 * other raw bytes so its duplicate-key/schema/signature/version checks still run.
 * Escaped or repeated URL literals fail closed rather than being normalized.
 * @param {string} text @param {string} version @param {R2Policy} policy
 * @param {number} [now]
 */
export function validateRehearsalManifestJson(
  text,
  version,
  policy,
  now = Date.now(),
) {
  try {
    const mappings = rehearsalArtifacts(version);
    const parsed = JSON.parse(text);
    const urls = new Map();
    let adapted = text;
    for (const artifact of mappings) {
      const actual = parsed.platforms?.[artifact.platform]?.url;
      validateRehearsalUrl(
        actual,
        policy,
        `${version}/${artifact.installer}`,
        now,
      );
      const literal = JSON.stringify(actual);
      assert.equal(adapted.split(literal).length, 2);
      adapted = adapted.replace(
        literal,
        JSON.stringify(
          `https://github.com/kim-mac/Slate/releases/download/v${version}/${artifact.installer}`,
        ),
      );
      urls.set(artifact.platform, actual);
    }
    const contract = validateManifestJson(adapted, version);
    return Object.freeze({
      ...contract,
      endpoint: 'private-r2-rehearsal',
      artifacts: Object.freeze(
        contract.artifacts.map((a) =>
          Object.freeze({ ...a, url: urls.get(a.platform) }),
        ),
      ),
    });
  } catch {
    throw new Error(
      'Rehearsal manifest rejected; check schema, versions, signatures and R2 policy',
    );
  }
}
