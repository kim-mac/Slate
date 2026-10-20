// @ts-check
// Offline release tooling only. This module is not imported by Slate or its preview.
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify, TextDecoder } from 'node:util';

const executeVerifier = promisify(execFile);

export const STABLE_ENDPOINT =
  'https://tryslate.tech/updates/windows/latest.json';
const targets = Object.freeze([
  { platform: 'windows-x86_64', architecture: 'x64' },
  { platform: 'windows-aarch64', architecture: 'ARM64' },
]);

/** Reject explicit remote/device/stream inputs before any filesystem access.
 * Mapped drives and filesystem providers remain an operator storage-policy gate.
 * @param {string} value
 */
export function localInputPath(value) {
  if (
    !value ||
    value.trim() !== value ||
    value.includes('\0') ||
    /^[\\/]{2}/.test(value) ||
    value.replace(/^[a-z]:[\\/]/i, '').includes(':')
  ) {
    throw new Error('inputs must be ordinary local file paths');
  }
  return resolve(value);
}

/** @typedef {{platform: string, architecture: string, filename: string, signatureFilename: string, url: string, signature: string}} Artifact */
/** @typedef {{endpoint: string, version: string, artifacts: ReadonlyArray<Readonly<Artifact>>}} Contract */

/** @param {unknown} value @param {string} label */
function object(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} value @param {string[]} required @param {string[]} optional @param {string} label */
function fields(value, required, optional, label) {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  ) {
    throw new Error(
      `${label} fields: require ${required.join(', ')}; allow only ${[...required, ...optional].join(', ')}`,
    );
  }
}

/** Canonical stable versions only; independent of today's root/extension versions.
 * @param {unknown} value @returns {string}
 */
function version(value) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ) {
    throw new Error('version must be canonical stable MAJOR.MINOR.PATCH');
  }
  const parts = value.split('.').map(Number);
  if (
    parts.some((part) => !Number.isSafeInteger(part)) ||
    (parts[0] === 0 && parts[1] < 2)
  ) {
    throw new Error(
      'version must be at least 0.2.0 with safe integer components',
    );
  }
  return value;
}

/** JSON.parse normally silently accepts duplicate keys. Reject decoded duplicates,
 * including escaped spellings, before any value can be used as a release contract.
 * @param {string} text @returns {unknown}
 */
function strictJson(text) {
  const parsed = /** @type {unknown} */ (JSON.parse(text));
  /** @type {Array<{keys: Set<string>, isObject: boolean, expectsKey: boolean}>} */
  const stack = [];
  for (const [token] of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]/g)) {
    const frame = stack.at(-1);
    if (token === '{' || token === '[') {
      stack.push({
        keys: new Set(),
        isObject: token === '{',
        expectsKey: token === '{',
      });
    } else if (token === '}' || token === ']') {
      stack.pop();
    } else if (token === ',' && frame?.isObject) {
      frame.expectsKey = true;
    } else if (token.startsWith('"') && frame?.isObject && frame.expectsKey) {
      const key = /** @type {string} */ (JSON.parse(token));
      if (frame.keys.has(key))
        throw new Error(`duplicate JSON property: ${key}`);
      frame.keys.add(key);
      frame.expectsKey = false;
    }
  }
  return parsed;
}

/** @param {string} value @param {string} label */
function base64(value, label) {
  if (!value || Buffer.from(value, 'base64').toString('base64') !== value) {
    throw new Error(`${label} must be canonical base64`);
  }
  return Buffer.from(value, 'base64');
}

/** Structural checks ONLY: authenticated verification still requires the trusted
 * public key and installer bytes. Never trust a comment as proof of its version.
 * @param {unknown} value @param {string} expectedVersion @param {string} label
 */
function signature(value, expectedVersion, label) {
  if (typeof value !== 'string')
    throw new Error(`${label} must contain the .sig contents`);
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      base64(value, label),
    );
  } catch {
    throw new Error(`${label} must contain base64-encoded UTF-8 minisign text`);
  }
  const lines = decoded.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (
    lines.length !== 4 ||
    !lines[0].startsWith('untrusted comment: ') ||
    !lines[2].startsWith('trusted comment: ')
  ) {
    throw new Error(
      `${label} must contain a Tauri/minisign signature envelope`,
    );
  }
  const packet = base64(lines[1], label);
  if (
    packet.length !== 74 ||
    !['4564', '4544'].includes(packet.subarray(0, 2).toString('hex')) ||
    base64(lines[3], label).length !== 64
  ) {
    throw new Error(`${label} has invalid minisign packets`);
  }
  const versions = lines[2]
    .slice('trusted comment: '.length)
    .split('\t')
    .filter((field) => field.startsWith('version:'));
  if (versions.length !== 1 || versions[0] !== `version:${expectedVersion}`) {
    throw new Error(
      `${label} must declare exactly the expected version ${expectedVersion}`,
    );
  }
  return value;
}

/** Validate Slate's strict subset of the pinned Tauri 2.13.3 static manifest.
 * Does not fetch, sign, install, mutate files, or cryptographically verify anything.
 * @param {string} text @param {string} expectedVersion @returns {Readonly<Contract>}
 */
export function validateManifestJson(text, expectedVersion) {
  const expected = version(expectedVersion);
  const manifest = object(strictJson(text), 'manifest');
  fields(manifest, ['version', 'platforms'], ['notes', 'pub_date'], 'manifest');
  const releaseVersion = version(manifest.version);
  if (releaseVersion !== expected)
    throw new Error(
      `manifest does not match expected release version ${expected}`,
    );
  if (
    Object.hasOwn(manifest, 'notes') &&
    (typeof manifest.notes !== 'string' ||
      Buffer.from(manifest.notes).toString('utf8') !== manifest.notes)
  ) {
    throw new Error('notes must be a well-formed Unicode string when supplied');
  }
  if (Object.hasOwn(manifest, 'pub_date')) {
    const date = manifest.pub_date;
    // RFC3339 UTC, whole seconds: a deliberately canonical subset accepted by Tauri.
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString() !== date.replace('Z', '.000Z')
    ) {
      throw new Error(
        'pub_date must be a real UTC RFC3339 date with whole seconds',
      );
    }
  }
  const platforms = object(manifest.platforms, 'platforms');
  fields(
    platforms,
    targets.map(({ platform }) => platform),
    [],
    'platforms',
  );
  const artifacts = targets.map(({ platform, architecture }) => {
    const entry = object(platforms[platform], platform);
    fields(entry, ['url', 'signature'], [], platform);
    const filename = `Slate-${releaseVersion}-Windows-${architecture}.exe`;
    const url = `https://github.com/kim-mac/Slate/releases/download/v${releaseVersion}/${filename}`;
    // Literal equality also rejects credentials, explicit ports, encoding, dot
    // segments, backslashes, whitespace, query/fragment and mutable latest URLs.
    if (
      typeof entry.url !== 'string' ||
      !URL.canParse(entry.url) ||
      entry.url !== url
    ) {
      throw new Error(`${platform} url must be exactly ${url}`);
    }
    return Object.freeze({
      platform,
      architecture,
      filename,
      signatureFilename: `${filename}.sig`,
      url,
      signature: signature(
        entry.signature,
        releaseVersion,
        `${platform} signature`,
      ),
    });
  });
  return Object.freeze({
    endpoint: STABLE_ENDPOINT,
    version: releaseVersion,
    artifacts: Object.freeze(artifacts),
  });
}

/** Read-only local staging check. A matching sidecar is not cryptographic proof
 * that it signs these bytes. Payload architecture and authenticity are later gates.
 * @param {Readonly<Contract>} contract @param {string} directory
 */
export async function validateArtifacts(contract, directory) {
  directory = localInputPath(directory);
  const results = [];
  for (const artifact of contract.artifacts) {
    for (const filename of [artifact.filename, artifact.signatureFilename]) {
      const path = join(directory, filename);
      const handle = await open(path, 'r');
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size === 0)
          throw new Error(`artifact must be a nonempty file: ${filename}`);
        const hash = createHash('sha256');
        let bytes = 0;
        if (filename === artifact.signatureFilename) {
          if (metadata.size > 16_384)
            throw new Error(`signature sidecar is too large: ${filename}`);
          const snapshot = await handle.readFile();
          if (snapshot.length > 16_384)
            throw new Error('signature sidecar is too large');
          const contents = new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
          }).decode(snapshot);
          if (contents.replace(/(?:\r?\n)$/, '') !== artifact.signature) {
            throw new Error(
              `signature sidecar does not match manifest: ${filename}`,
            );
          }
          // Bind equality and hashing to the SAME snapshot, never reread the
          // sidecar after comparing it with the manifest.
          hash.update(snapshot);
          bytes = snapshot.length;
        } else {
          for await (const chunk of handle.createReadStream({
            start: 0,
            autoClose: false,
          })) {
            hash.update(chunk);
            bytes += chunk.length;
          }
        }
        if (bytes === 0) throw new Error('artifact became empty while reading');
        results.push({
          filename,
          bytes,
          sha256: hash.digest('hex').toUpperCase(),
        });
      } finally {
        await handle.close();
      }
    }
  }
  return results;
}

/** Explicitly opt into the cryptographic gate using a locally built, trusted
 * verifier and a public key selected by the maintainer, never by the manifest.
 * @param {Readonly<Contract>} contract @param {string} directory
 * @param {string} publicKeyPath @param {string} verifierPath
 */
export async function verifyReleaseArtifacts(
  contract,
  directory,
  publicKeyPath,
  verifierPath,
) {
  directory = localInputPath(directory);
  publicKeyPath = localInputPath(publicKeyPath);
  verifierPath = localInputPath(verifierPath);
  const artifacts = await validateArtifacts(contract, directory);
  const keyHandle = await open(publicKeyPath, 'r');
  let publicKeyFingerprint;
  try {
    const metadata = await keyHandle.stat();
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > 16_384)
      throw new Error('invalid public key file');
    const keyText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(await keyHandle.readFile())
      .replace(/(?:\r?\n)$/, '');
    publicKeyFingerprint = createHash('sha256')
      .update(base64(keyText, 'public key'))
      .digest('hex')
      .toUpperCase();
  } finally {
    await keyHandle.close();
  }
  const verifications = [];
  for (const artifact of contract.artifacts) {
    let stdout;
    try {
      ({ stdout } = await executeVerifier(
        resolve(verifierPath),
        [
          '--public-key',
          resolve(publicKeyPath),
          '--artifact',
          resolve(directory, artifact.filename),
          '--signature',
          resolve(directory, artifact.signatureFilename),
          '--expected-version',
          contract.version,
        ],
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 16_384,
          // Preserve Windows packaged-process launch context, while excluding
          // credential-named variables. The verifier itself reads only argv/files,
          // never environment credentials. No shell or installation is involved.
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) => !/KEY|PASS|TOKEN|SECRET|CREDENTIAL/i.test(name),
            ),
          ),
        },
      ));
    } catch {
      // Child error objects may contain stdout/stderr. Do not forward them.
      throw new Error(`${artifact.platform} cryptographic verification failed`);
    }
    const report = object(strictJson(stdout), 'verifier report');
    fields(
      report,
      [
        'verified',
        'version',
        'bytes',
        'artifactSha256',
        'signatureSha256',
        'publicKeySha256',
      ],
      [],
      'verifier report',
    );
    const installer = artifacts.find(
      (entry) => entry.filename === artifact.filename,
    );
    const sidecar = artifacts.find(
      (entry) => entry.filename === artifact.signatureFilename,
    );
    if (!installer || !sidecar) throw new Error('incomplete artifact snapshot');
    if (
      report.verified !== true ||
      report.version !== contract.version ||
      report.bytes !== installer?.bytes ||
      report.artifactSha256 !== installer.sha256 ||
      report.signatureSha256 !== sidecar?.sha256 ||
      report.publicKeySha256 !== publicKeyFingerprint
    ) {
      throw new Error(
        `${artifact.platform} verified inputs do not match the contract snapshot`,
      );
    }
    verifications.push({ platform: artifact.platform, ...report });
  }
  return { artifacts, verifications };
}

/** @param {string[]} args */
async function main(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      ![
        '--version',
        '--manifest',
        '--artifacts',
        '--public-key',
        '--verifier',
      ].includes(key) ||
      !value ||
      value.startsWith('--') ||
      options.has(key)
    ) {
      throw new Error(
        'usage: --version VERSION --manifest LOCAL_JSON --artifacts LOCAL_DIRECTORY (each exactly once)',
      );
    }
    options.set(key, value);
  }
  if (
    !['--version', '--manifest', '--artifacts'].every((key) => options.has(key))
  )
    throw new Error('require --version, --manifest and --artifacts');
  if (options.has('--public-key') !== options.has('--verifier'))
    throw new Error('--public-key and --verifier must be supplied together');
  for (const key of [
    '--manifest',
    '--artifacts',
    '--public-key',
    '--verifier',
  ]) {
    if (options.has(key)) options.set(key, localInputPath(options.get(key)));
  }
  const contract = validateManifestJson(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await readFile(options.get('--manifest')),
    ),
    options.get('--version'),
  );
  const cryptographicallyVerified = options.has('--public-key');
  const { artifacts, verifications } = cryptographicallyVerified
    ? await verifyReleaseArtifacts(
        contract,
        options.get('--artifacts'),
        options.get('--public-key'),
        options.get('--verifier'),
      )
    : {
        artifacts: await validateArtifacts(
          contract,
          options.get('--artifacts'),
        ),
        verifications: [],
      };
  process.stdout.write(
    `${JSON.stringify({ endpoint: contract.endpoint, version: contract.version, contractValid: true, cryptographicallyVerified, payloadArchitectureVerified: false, remoteImmutabilityVerified: false, artifacts, verifications }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `Desktop update release contract rejected: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
