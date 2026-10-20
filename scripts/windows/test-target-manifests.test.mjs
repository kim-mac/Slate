import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const worktree = fileURLToPath(new URL('../../', import.meta.url));
const crate = join(worktree, 'apps/desktop/src-tauri');

test('Windows execution-level linker options apply only to test targets', () => {
  const source = readFileSync(join(crate, 'build.rs'), 'utf8');
  assert.match(source, /CARGO_CFG_TARGET_OS/);
  assert.match(source, /CARGO_CFG_TARGET_ENV/);
  assert.ok(source.includes('cargo:rustc-link-arg-tests=/MANIFEST:EMBED,ID=1'));
  assert.ok(
    source.includes(
      "cargo:rustc-link-arg-tests=/MANIFESTUAC:level='asInvoker' uiAccess='false'",
    ),
  );
  assert.doesNotMatch(source, /cargo:rustc-link-arg(?:=|-bin=|-bins=)/);
});

test('copied installer packages without integration tests omit test-only directives', () => {
  const source = readFileSync(join(crate, 'build.rs'), 'utf8');
  assert.ok(
    source.includes(
      'Path::new("tests/installation_safety_contract.rs").is_file()',
    ),
  );
  assert.ok(
    source.includes('Path::new("tests/updater_security.rs").is_file()'),
  );
});

function assertManifest(executable, machine) {
  const pe = readFileSync(executable);
  assert.equal(pe.toString('ascii', 0, 2), 'MZ');
  const header = pe.readUInt32LE(0x3c);
  assert.equal(pe.readUInt32LE(header), 0x4550);
  assert.equal(pe.readUInt16LE(header + 4), machine);
  const optional = header + 24;
  assert.equal(pe.readUInt16LE(optional), 0x20b);
  const sections = optional + pe.readUInt16LE(header + 20);
  function offset(rva, size = 1) {
    for (let i = 0; i < pe.readUInt16LE(header + 6); i++) {
      const section = sections + i * 40;
      const start = pe.readUInt32LE(section + 12);
      const length = pe.readUInt32LE(section + 16);
      if (rva >= start && rva + size <= start + length) {
        const result = pe.readUInt32LE(section + 20) + rva - start;
        assert.ok(result + size <= pe.length);
        return result;
      }
    }
    assert.fail('Resource must be backed by executable bytes');
  }
  const rva = pe.readUInt32LE(optional + 112 + 2 * 8);
  assert.notEqual(rva, 0, 'Missing embedded RT_MANIFEST');
  const root = offset(rva, 16);
  function entries(directory) {
    const count =
      pe.readUInt16LE(directory + 12) + pe.readUInt16LE(directory + 14);
    return Array.from({ length: count }, (_, i) => ({
      id: pe.readUInt32LE(directory + 16 + i * 8),
      target: pe.readUInt32LE(directory + 20 + i * 8),
    }));
  }
  function child(directory, id) {
    const entry = entries(directory).find((item) => item.id === id);
    assert.ok(entry && entry.target & 0x80000000, `Missing resource ${id}`);
    return root + (entry.target & 0x7fffffff);
  }
  const languages = entries(child(child(root, 24), 1));
  assert.ok(languages.length > 0);
  for (const language of languages) {
    assert.equal(language.target & 0x80000000, 0);
    const data = root + language.target;
    const size = pe.readUInt32LE(data + 4);
    const start = offset(pe.readUInt32LE(data), size);
    const xml = pe.subarray(start, start + size).toString('utf8');
    const levels = [
      ...xml.matchAll(/<requestedExecutionLevel\b([^>]*)\/?\s*>/g),
    ];
    assert.equal(levels.length, 1);
    assert.match(levels[0][1], /\blevel=(['"])asInvoker\1/);
    assert.match(levels[0][1], /\buiAccess=(['"])false\1/);
    assert.doesNotMatch(xml, /requireAdministrator|highestAvailable/);
  }
}

test(
  'freshly linked safety and updater test PEs embed current-user manifests',
  {
    skip: process.platform !== 'win32',
    timeout: 240_000,
  },
  () => {
    const target =
      process.env.SLATE_TEST_MANIFEST_TARGET ??
      (process.arch === 'arm64'
        ? 'aarch64-pc-windows-msvc'
        : 'x86_64-pc-windows-msvc');
    assert.ok(
      ['aarch64-pc-windows-msvc', 'x86_64-pc-windows-msvc'].includes(target),
    );
    const built = spawnSync(
      'cargo',
      [
        'test',
        '--offline',
        '--locked',
        '--no-run',
        '--message-format=json',
        '--manifest-path',
        join(crate, 'Cargo.toml'),
        '--target',
        target,
        '--test',
        'installation_safety_contract',
        '--test',
        'updater_security',
      ],
      {
        cwd: worktree,
        encoding: 'utf8',
        timeout: 210_000,
        maxBuffer: 8 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
    );
    assert.equal(built.error, undefined);
    assert.equal(built.status, 0, 'Locked offline test build must succeed');
    const artifacts = built.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    for (const name of ['installation_safety_contract', 'updater_security']) {
      const artifact = artifacts.find(
        (item) =>
          item.reason === 'compiler-artifact' &&
          item.target?.name === name &&
          item.executable,
      );
      assert.ok(artifact?.executable, `Cargo must report ${name}`);
      assertManifest(
        artifact.executable,
        target.startsWith('aarch64') ? 0xaa64 : 0x8664,
      );
    }
  },
);
