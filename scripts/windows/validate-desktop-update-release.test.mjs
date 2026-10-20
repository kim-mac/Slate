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
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const moduleUrl = new URL(
  './validate-desktop-update-release.mjs',
  import.meta.url,
);

test('the offline desktop release contract validator is available', () => {
  assert.ok(
    existsSync(moduleUrl),
    'Step 1 release contract is not implemented',
  );
});

// These are deliberately NOT cryptographic signatures. No keys are generated.
function signature(version = '0.2.0', byte = 1) {
  const packet = Buffer.alloc(74, byte);
  packet.write('ED');
  return Buffer.from(
    [
      'untrusted comment: synthetic contract-test signature only',
      packet.toString('base64'),
      `trusted comment: timestamp:1\tfile:original-setup.exe\tversion:${version}`,
      Buffer.alloc(64, byte).toString('base64'),
      '',
    ].join('\n'),
  ).toString('base64');
}

function manifest(version = '0.2.0') {
  const entry = (architecture, byte) => ({
    url: `https://github.com/kim-mac/Slate/releases/download/v${version}/Slate-${version}-Windows-${architecture}.exe`,
    signature: signature(version, byte),
  });
  return {
    version,
    notes: 'Desktop release notes.',
    pub_date: '2026-10-14T12:00:00Z',
    platforms: {
      'windows-x86_64': entry('x64', 1),
      'windows-aarch64': entry('ARM64', 2),
    },
  };
}

async function validator() {
  assert.ok(
    existsSync(moduleUrl),
    'Step 1 release contract is not implemented',
  );
  return import(moduleUrl.href);
}

test('accepts the static Tauri shape and returns deterministic architecture contracts', async () => {
  const { validateManifestJson } = await validator();
  const input = manifest();
  const result = validateManifestJson(JSON.stringify(input), '0.2.0');
  assert.equal(
    result.endpoint,
    'https://tryslate.tech/updates/windows/latest.json',
  );
  assert.equal(result.version, '0.2.0');
  assert.deepEqual(
    result.artifacts.map(({ platform, filename, signatureFilename }) => ({
      platform,
      filename,
      signatureFilename,
    })),
    [
      {
        platform: 'windows-x86_64',
        filename: 'Slate-0.2.0-Windows-x64.exe',
        signatureFilename: 'Slate-0.2.0-Windows-x64.exe.sig',
      },
      {
        platform: 'windows-aarch64',
        filename: 'Slate-0.2.0-Windows-ARM64.exe',
        signatureFilename: 'Slate-0.2.0-Windows-ARM64.exe.sig',
      },
    ],
  );
  input.platforms = Object.fromEntries(
    Object.entries(input.platforms).reverse(),
  );
  assert.deepEqual(
    validateManifestJson(JSON.stringify(input), '0.2.0'),
    result,
  );
});

test('accepts future stable versions and optional metadata without coupling to current desktop version', async () => {
  const { validateManifestJson } = await validator();
  const input = manifest('1.10.2');
  delete input.notes;
  delete input.pub_date;
  assert.equal(
    validateManifestJson(JSON.stringify(input), '1.10.2').version,
    '1.10.2',
  );
});

const invalid = [
  [
    'missing version',
    (m) => {
      delete m.version;
    },
    /version/,
  ],
  [
    'missing platforms',
    (m) => {
      delete m.platforms;
    },
    /platforms/,
  ],
  [
    'missing ARM64',
    (m) => {
      delete m.platforms['windows-aarch64'];
    },
    /platforms/,
  ],
  [
    'missing x64',
    (m) => {
      delete m.platforms['windows-x86_64'];
    },
    /platforms/,
  ],
  [
    'wrong target alias',
    (m) => {
      m.platforms['windows-arm64'] = m.platforms['windows-aarch64'];
      delete m.platforms['windows-aarch64'];
    },
    /platforms/,
  ],
  [
    'installer target override',
    (m) => {
      m.platforms['windows-x86_64-nsis'] = m.platforms['windows-x86_64'];
    },
    /platforms/,
  ],
  [
    'extra OS',
    (m) => {
      m.platforms['linux-x86_64'] = m.platforms['windows-x86_64'];
    },
    /platforms/,
  ],
  [
    'mixed release version',
    (m) => {
      m.version = '0.2.1';
    },
    /expected release version/,
  ],
  [
    'number version',
    (m) => {
      m.version = 2;
    },
    /version/,
  ],
  [
    'version alias',
    (m) => {
      m.name = m.version;
      delete m.version;
    },
    /fields/,
  ],
  [
    'unexpected root field',
    (m) => {
      m.channel = 'stable';
    },
    /fields/,
  ],
  [
    'unexpected platform field',
    (m) => {
      m.platforms['windows-x86_64'].sha256 = 'abc';
    },
    /fields/,
  ],
  [
    'null platform',
    (m) => {
      m.platforms['windows-x86_64'] = null;
    },
    /object/,
  ],
  [
    'array platforms',
    (m) => {
      m.platforms = [];
    },
    /object/,
  ],
  [
    'null notes',
    (m) => {
      m.notes = null;
    },
    /notes/,
  ],
  [
    'numeric notes',
    (m) => {
      m.notes = 1;
    },
    /notes/,
  ],
  [
    'invalid date',
    (m) => {
      m.pub_date = '2026-02-30T12:00:00Z';
    },
    /pub_date/,
  ],
  [
    'noncanonical date',
    (m) => {
      m.pub_date = 'yesterday';
    },
    /pub_date/,
  ],
  [
    'null date',
    (m) => {
      m.pub_date = null;
    },
    /pub_date/,
  ],
  [
    'missing signature',
    (m) => {
      delete m.platforms['windows-x86_64'].signature;
    },
    /signature/,
  ],
  [
    'empty signature',
    (m) => {
      m.platforms['windows-x86_64'].signature = ' ';
    },
    /signature/,
  ],
  [
    'signature URL instead of contents',
    (m) => {
      m.platforms['windows-x86_64'].signature =
        `${m.platforms['windows-x86_64'].url}.sig`;
    },
    /signature/,
  ],
  [
    'signature placeholder',
    (m) => {
      m.platforms['windows-x86_64'].signature = 'TODO';
    },
    /signature/,
  ],
  [
    'legacy signature without version',
    (m) => {
      m.platforms['windows-x86_64'].signature = Buffer.from(
        Buffer.from(signature(), 'base64')
          .toString()
          .replace('\tversion:0.2.0', ''),
      ).toString('base64');
    },
    /signature.*version/,
  ],
  [
    'signature for another version',
    (m) => {
      m.platforms['windows-x86_64'].signature = signature('0.1.0');
    },
    /signature.*version/,
  ],
  [
    'duplicate signature version',
    (m) => {
      m.platforms['windows-x86_64'].signature = Buffer.from(
        Buffer.from(signature(), 'base64')
          .toString()
          .replace('version:0.2.0', 'version:0.2.0\tversion:0.2.0'),
      ).toString('base64');
    },
    /signature.*version/,
  ],
  [
    'invalid signature packet',
    (m) => {
      m.platforms['windows-x86_64'].signature = Buffer.from(
        'untrusted comment: invalid\nYQ==\ntrusted comment: version:0.2.0\nYQ==',
      ).toString('base64');
    },
    /signature/,
  ],
  [
    'unsupported signature algorithm',
    (m) => {
      const lines = Buffer.from(signature(), 'base64').toString().split('\n');
      const packet = Buffer.from(lines[1], 'base64');
      packet[0] = 0xc5;
      packet[1] = 0xc4;
      lines[1] = packet.toString('base64');
      m.platforms['windows-x86_64'].signature = Buffer.from(
        lines.join('\n'),
      ).toString('base64');
    },
    /signature/,
  ],
];

for (const [name, mutate, error] of invalid) {
  test(`rejects ${name}`, async () => {
    const { validateManifestJson } = await validator();
    const input = manifest();
    mutate(input);
    assert.throws(
      () => validateManifestJson(JSON.stringify(input), '0.2.0'),
      error,
    );
  });
}

for (const version of [
  '0.1.0',
  'v0.2.0',
  '00.2.0',
  '0.2',
  '0.2.0-beta.1',
  '0.2.0+build',
  '0.2.0\n',
  '9007199254740992.0.0',
]) {
  test(`rejects non-contract version ${JSON.stringify(version)}`, async () => {
    const { validateManifestJson } = await validator();
    assert.throws(
      () => validateManifestJson(JSON.stringify(manifest(version)), version),
      /version/,
    );
  });
}

const badUrls = [
  'not a URL',
  'http://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe',
  'https://github.com.evil.test/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe',
  'https://github.com/other/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe',
  'https://github.com/kim-mac/Slate/releases/latest/download/Slate-0.2.0-Windows-x64.exe',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.1/Slate-0.2.0-Windows-x64.exe',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.1-Windows-x64.exe',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-ARM64.exe',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-Extension-0.1.1.zip',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe.zip',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe?download=1',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe#fragment',
  'https://user:pass@github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe',
  'https://github.com:443/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/%53late-0.2.0-Windows-x64.exe',
  'https://github.com/kim-mac/Slate/releases/download/v0.2.0/../v0.2.0/Slate-0.2.0-Windows-x64.exe',
  ' https://github.com/kim-mac/Slate/releases/download/v0.2.0/Slate-0.2.0-Windows-x64.exe',
];
for (const url of badUrls) {
  test(`rejects noncanonical asset URL ${url}`, async () => {
    const { validateManifestJson } = await validator();
    const input = manifest();
    input.platforms['windows-x86_64'].url = url;
    assert.throws(
      () => validateManifestJson(JSON.stringify(input), '0.2.0'),
      /url/,
    );
  });
}

for (const text of [
  '{',
  'null',
  '[]',
  '{"version":"0.2.0","version":"0.2.0"}',
  '{"version":"0.2.0","\\u0076ersion":"0.2.0"}',
]) {
  test(`rejects malformed, non-object or duplicate-key JSON ${text}`, async () => {
    const { validateManifestJson } = await validator();
    assert.throws(() => validateManifestJson(text, '0.2.0'));
  });
}

test('rejects duplicate nested keys even when their final values would pass', async () => {
  const { validateManifestJson } = await validator();
  const input = JSON.stringify(manifest());
  const url = manifest().platforms['windows-x86_64'].url;
  assert.throws(
    () =>
      validateManifestJson(
        input.replace(`"url":"${url}"`, `"url":"${url}","url":"${url}"`),
        '0.2.0',
      ),
    /duplicate/,
  );
});

test('does not confuse strings in notes with duplicate JSON properties', async () => {
  const { validateManifestJson } = await validator();
  const input = manifest();
  input.notes = 'Example: {"version":"x","version":"y"}, [":"]';
  assert.equal(
    validateManifestJson(JSON.stringify(input), '0.2.0').version,
    '0.2.0',
  );
});

for (const notes of ['\ud800', '\udc00']) {
  test(`rejects unpaired Unicode surrogate ${JSON.stringify(notes)} in notes`, async () => {
    const { validateManifestJson } = await validator();
    const input = manifest();
    input.notes = notes;
    assert.throws(
      () => validateManifestJson(JSON.stringify(input), '0.2.0'),
      /notes/,
    );
  });
}

test('accepts well-formed Unicode and emoji release notes', async () => {
  const { validateManifestJson } = await validator();
  const input = manifest();
  input.notes = 'Slate 🚀 — 更新';
  assert.equal(
    validateManifestJson(JSON.stringify(input), '0.2.0').version,
    '0.2.0',
  );
});

function staging(t, input = manifest()) {
  const directory = mkdtempSync(join(tmpdir(), 'slate-release-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'stable.json'), JSON.stringify(input));
  for (const [platform, architecture] of [
    ['windows-x86_64', 'x64'],
    ['windows-aarch64', 'ARM64'],
  ]) {
    const filename = `Slate-${input.version}-Windows-${architecture}.exe`;
    // Synthetic fixture bytes, NOT a real installer or an architecture assertion.
    writeFileSync(
      join(directory, filename),
      `synthetic ${architecture} fixture`,
    );
    writeFileSync(
      join(directory, `${filename}.sig`),
      `${input.platforms[platform].signature}\r\n`,
    );
  }
  return directory;
}

test('CLI rejects malformed UTF-8 manifest bytes rather than replacing them', (t) => {
  const directory = staging(t);
  const path = join(directory, 'stable.json');
  const bytes = readFileSync(path);
  bytes[bytes.indexOf('Desktop release notes.')] = 0xff;
  writeFileSync(path, bytes);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(moduleUrl),
      '--version',
      '0.2.0',
      '--manifest',
      path,
      '--artifacts',
      directory,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /utf-8/i);
});

test('validates all four local artifacts, reports deterministic sizes/hashes, and changes no bytes', async (t) => {
  const { validateManifestJson, validateArtifacts } = await validator();
  const input = manifest();
  const directory = staging(t, input);
  const before = readFileSync(join(directory, 'stable.json'));
  const contract = validateManifestJson(JSON.stringify(input), input.version);
  const first = await validateArtifacts(contract, directory);
  assert.equal(first.length, 4);
  assert.ok(
    first.every((item) => item.bytes > 0 && /^[A-F0-9]{64}$/.test(item.sha256)),
  );
  for (const item of first) {
    const bytes = readFileSync(join(directory, item.filename));
    assert.equal(item.bytes, bytes.length);
    assert.equal(
      item.sha256,
      createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    );
  }
  assert.deepEqual(await validateArtifacts(contract, directory), first);
  assert.deepEqual(readFileSync(join(directory, 'stable.json')), before);
});

for (const failure of [
  'missing installer',
  'empty installer',
  'missing signature',
  'mismatched signature',
]) {
  test(`fails local artifact check for ${failure}`, async (t) => {
    const { validateManifestJson, validateArtifacts } = await validator();
    const directory = staging(t);
    const installer = join(directory, 'Slate-0.2.0-Windows-ARM64.exe');
    const sig = `${installer}.sig`;
    if (failure === 'missing installer') rmSync(installer);
    if (failure === 'empty installer') writeFileSync(installer, '');
    if (failure === 'missing signature') rmSync(sig);
    if (failure === 'mismatched signature')
      writeFileSync(sig, signature('0.2.0', 7));
    await assert.rejects(
      validateArtifacts(
        validateManifestJson(JSON.stringify(manifest()), '0.2.0'),
        directory,
      ),
    );
  });
}

test('CLI succeeds only with an explicit version, manifest and complete local artifact pairs', async (t) => {
  const directory = staging(t);
  const args = [
    fileURLToPath(moduleUrl),
    '--version',
    '0.2.0',
    '--manifest',
    join(directory, 'stable.json'),
    '--artifacts',
    directory,
  ];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.version, '0.2.0');
  assert.equal(report.artifacts.length, 4);
  assert.equal(report.cryptographicallyVerified, false);
  for (const badArgs of [
    [],
    args.slice(3),
    [...args.slice(1), '--unknown', 'value'],
    [...args.slice(1), '--version', '0.2.0'],
  ]) {
    assert.notEqual(
      spawnSync(process.execPath, [fileURLToPath(moduleUrl), ...badArgs], {
        encoding: 'utf8',
      }).status,
      0,
    );
  }
  rmSync(join(directory, 'Slate-0.2.0-Windows-ARM64.exe.sig'));
  assert.notEqual(
    spawnSync(process.execPath, args, { encoding: 'utf8' }).status,
    0,
  );
});
