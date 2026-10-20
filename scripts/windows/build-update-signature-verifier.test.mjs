import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const helper = new URL(
  './build-update-signature-verifier.mjs',
  import.meta.url,
);
const worktree = fileURLToPath(new URL('../../', import.meta.url));

// Inspect the executable bytes, not build-script strings or an external sidecar.
function assertCurrentUserManifest(executable) {
  const pe = readFileSync(executable);
  assert.equal(pe.toString('ascii', 0, 2), 'MZ');
  const header = pe.readUInt32LE(0x3c);
  assert.equal(pe.readUInt32LE(header), 0x4550);
  const machine = pe.readUInt16LE(header + 4);
  assert.ok([0xaa64, 0x8664].includes(machine), 'ARM64 or x64 executable');
  const optional = header + 24;
  assert.equal(pe.readUInt16LE(optional), 0x20b, 'PE32+');
  const sections = optional + pe.readUInt16LE(header + 20);
  function offset(rva, size = 1) {
    for (let i = 0; i < pe.readUInt16LE(header + 6); i++) {
      const section = sections + i * 40;
      const start = pe.readUInt32LE(section + 12);
      const length = pe.readUInt32LE(section + 16);
      if (rva >= start && rva + size <= start + length) {
        const result = pe.readUInt32LE(section + 20) + rva - start;
        assert.ok(result + size <= pe.length, 'Resource within file');
        return result;
      }
    }
    assert.fail('Resource RVA does not map to file bytes');
  }
  // The transfer PC must not need a separately installed Visual C++ runtime.
  // Inspect the real PE import table, rather than searching arbitrary strings.
  const importRva = pe.readUInt32LE(optional + 112 + 8);
  assert.notEqual(importRva, 0, 'Expected Windows system imports');
  const imports = [];
  for (
    let entry = offset(importRva, 20);
    pe.readUInt32LE(entry + 12);
    entry += 20
  ) {
    const start = offset(pe.readUInt32LE(entry + 12));
    const end = pe.indexOf(0, start);
    assert.ok(end >= start, 'Terminated DLL name');
    imports.push(pe.toString('ascii', start, end));
  }
  assert.ok(
    imports.every(
      (name) => !/^(?:vcruntime|msvcp|msvcr|concrt)\d.*\.dll$/i.test(name),
    ),
    `Portable verifier must not import Visual C++ runtime DLLs: ${imports.join(', ')}`,
  );
  const resourceRva = pe.readUInt32LE(optional + 112 + 2 * 8);
  assert.notEqual(resourceRva, 0, 'Missing embedded RT_MANIFEST resource');
  const root = offset(resourceRva, 16);
  function entries(directory) {
    const count =
      pe.readUInt16LE(directory + 12) + pe.readUInt16LE(directory + 14);
    return Array.from({ length: count }, (_, i) => {
      const entry = directory + 16 + i * 8;
      return { id: pe.readUInt32LE(entry), target: pe.readUInt32LE(entry + 4) };
    });
  }
  function child(directory, id) {
    const entry = entries(directory).find((item) => item.id === id);
    assert.ok(entry, `Missing resource ID ${id}`);
    assert.ok(entry.target & 0x80000000, 'Resource directory expected');
    return root + (entry.target & 0x7fffffff);
  }
  const languages = entries(child(child(root, 24), 1));
  assert.ok(languages.length > 0, 'RT_MANIFEST ID 1 has language data');
  for (const language of languages) {
    assert.equal(language.target & 0x80000000, 0, 'Resource data expected');
    const data = root + language.target;
    const size = pe.readUInt32LE(data + 4);
    const start = offset(pe.readUInt32LE(data), size);
    const xml = pe.subarray(start, start + size).toString('utf8');
    assert.match(
      xml,
      /<assembly\b[^>]*xmlns=(['"])urn:schemas-microsoft-com:asm.v1\1/,
    );
    assert.match(
      xml,
      /<trustInfo\b[^>]*xmlns=(['"])urn:schemas-microsoft-com:asm.v3\1/,
    );
    const levels = [
      ...xml.matchAll(/<requestedExecutionLevel\b([^>]*)\/?\s*>/g),
    ];
    assert.equal(levels.length, 1, 'Exactly one execution level');
    assert.match(levels[0][1], /\blevel=(['"])asInvoker\1/);
    assert.match(levels[0][1], /\buiAccess=(['"])false\1/);
    assert.doesNotMatch(xml, /requireAdministrator|highestAvailable/);
  }
  return machine;
}

test(
  'Windows verifier embeds RT_MANIFEST ID 1 with current-user privileges',
  { skip: process.platform !== 'win32' },
  async () => {
    const { buildVerifier } = await import(helper.href);
    assertCurrentUserManifest(buildVerifier().executable);
  },
);

test(
  'alternate installed Windows architecture embeds the same current-user manifest',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { buildPlan, buildVerifier } = await import(helper.href);
    const native = buildVerifier();
    const target =
      native.host === 'aarch64-pc-windows-msvc'
        ? 'x86_64-pc-windows-msvc'
        : 'aarch64-pc-windows-msvc';
    const installed = spawnSync('rustup', ['target', 'list', '--installed'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(installed.error, undefined);
    assert.equal(installed.status, 0);
    if (!installed.stdout.split(/\r?\n/).includes(target)) {
      t.skip(
        'Alternate Rust target is not installed; no installation attempted',
      );
      return;
    }
    const plan = buildPlan(
      target,
      join(worktree, 'scripts/windows/update-signature-verifier/target'),
    );
    const result = spawnSync('cargo', plan.args, {
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !/KEY|PASS|TOKEN|SECRET|CREDENTIAL/i.test(name),
        ),
      ),
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, 'Offline cross-target verifier build');
    const artifact = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .find(
        (item) =>
          item.reason === 'compiler-artifact' &&
          item.target?.name === 'slate-update-signature-verifier' &&
          item.executable,
      );
    assert.ok(artifact?.executable, 'Cargo-reported executable');
    assert.equal(
      assertCurrentUserManifest(artifact.executable),
      target.startsWith('aarch64') ? 0xaa64 : 0x8664,
    );
  },
);

test('verifier has an explicit offline source-build prerequisite, not a cache-only path', () => {
  assert.ok(
    existsSync(helper),
    'Missing reproducible verifier build prerequisite',
  );
});

test('build plan explicitly targets the Rust host and a locked offline standalone binary', async () => {
  const { buildPlan } = await import(helper.href);
  const plan = buildPlan(
    'aarch64-pc-windows-msvc',
    join(worktree, 'dist/test/verifier-clean-build-plan/target'),
  );
  assert.ok(plan.args.includes('--offline'));
  assert.ok(plan.args.includes('--locked'));
  assert.equal(
    plan.args[plan.args.indexOf('--target') + 1],
    'aarch64-pc-windows-msvc',
  );
  assert.equal(
    plan.args[plan.args.indexOf('--bin') + 1],
    'slate-update-signature-verifier',
  );
  assert.equal(plan.args[plan.args.indexOf('--message-format') + 1], 'json');
  assert.ok(
    plan.args[plan.args.indexOf('--manifest-path') + 1].endsWith(
      'update-signature-verifier\\Cargo.toml',
    ) ||
      plan.args[plan.args.indexOf('--manifest-path') + 1].endsWith(
        'update-signature-verifier/Cargo.toml',
      ),
  );
  assert.throws(() => buildPlan('invalid target / path', worktree));
});

test('both Windows verifier targets request a statically linked C runtime', async () => {
  const { buildPlan } = await import(helper.href);
  for (const target of ['aarch64-pc-windows-msvc', 'x86_64-pc-windows-msvc']) {
    const plan = buildPlan(
      target,
      join(worktree, 'dist/test/verifier-clean-build-plan/target'),
    );
    assert.ok(
      plan.args.includes(
        `target.${target}.rustflags=["-C","target-feature=+crt-static"]`,
      ),
      'Standalone verifier must not depend on a machine-installed Visual C++ runtime',
    );
  }
});

test('builds and launches the verifier from an initially empty target directory', async (t) => {
  const { buildVerifier } = await import(helper.href);
  const parent = join(worktree, 'dist/test');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'verifier-clean-build-'));
  t.after(() => {
    assert.ok(!relative(parent, directory).startsWith('..'));
    rmSync(directory, { recursive: true, force: true });
  });
  const target = join(directory, 'empty-target');
  assert.equal(existsSync(target), false);
  const report = buildVerifier(target);
  assert.ok(existsSync(report.executable));
  assert.ok(!relative(target, report.executable).startsWith('..'));
  assert.ok(report.executable.includes(report.host));
  if (process.platform === 'win32')
    assertCurrentUserManifest(report.executable);
  const result = spawnSync(report.executable, [], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr.trim(),
    'signature verification failed: invalid_arguments',
  );
});
