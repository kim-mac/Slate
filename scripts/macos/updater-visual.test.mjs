import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const example = 'apps/desktop/src-tauri/examples/updater_visual.rs';
const config = 'apps/desktop/src-tauri/examples/updater-visual/tauri.conf.json';
const frozen = '0389c91dfc00a5caa1ab1f488900384d12859149';
const source = readFileSync(path.join(root, example), 'utf8').replaceAll(
  '\r\n',
  '\n',
);

function original(relative) {
  const result = spawnSync('git', ['show', `${frozen}:${relative}`], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.replaceAll('\r\n', '\n');
}

function windowsBody() {
  const [doc, ...lines] = source.split('\n');
  assert.equal(doc, original(example).split('\n')[0]);
  const match = lines
    .join('\n')
    .match(
      /^#\[cfg\(windows\)\]\nmod windows_preview \{\n([\s\S]*)\n\}\n\n#\[cfg\(windows\)\]\nfn main\(\) \{\n {4}windows_preview::run\(\);\n\}\n\n#\[cfg\(not\(windows\)\)\]\nfn main\(\) -> std::process::ExitCode \{\n {4}std::process::ExitCode::from\(78\)\n\}\n$/,
    );
  assert.ok(
    match,
    'entire Windows preview must be gated with an inert alternative',
  );
  return match[1].replace(/^ {4}/gm, '');
}

test('Windows preview body and configuration preserve the frozen implementation after formatting', () => {
  const expected = original(example)
    .split('\n')
    .slice(1)
    .join('\n')
    .trimEnd()
    .replace(/^fn main\(\)/m, 'pub(super) fn run()');
  // Nesting adds indentation and may reflow long calls. Canonicalize the frozen
  // body with the same formatter rather than ignoring Rust tokens or strings.
  const formatted = spawnSync(
    'rustfmt',
    ['--emit', 'stdout', '--edition', '2021'],
    {
      cwd: path.join(root, 'apps/desktop/src-tauri'),
      encoding: 'utf8',
      windowsHide: true,
      input: `mod windows_preview {\n${expected
        .split('\n')
        .map((line) => (line ? '    ' + line : ''))
        .join('\n')}\n}\n`,
    },
  );
  assert.equal(formatted.status, 0, formatted.stderr);
  const canonical = formatted.stdout
    .replaceAll('\r\n', '\n')
    .slice('mod windows_preview {\n'.length, -'\n}\n'.length)
    .replace(/^ {4}/gm, '');
  assert.equal(windowsBody(), canonical);
  assert.equal(
    readFileSync(path.join(root, config), 'utf8').replaceAll('\r\n', '\n'),
    original(config),
  );
});

test('native target cfg selects the entire preview only on Windows and retains the Cargo example', () => {
  windowsBody();
  for (const target of [
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'aarch64-pc-windows-msvc',
    'x86_64-pc-windows-msvc',
  ]) {
    const result = spawnSync('rustc', ['--print', 'cfg', '--target', target], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.split(/\r?\n/).includes('windows'),
      target.includes('windows'),
    );
  }
  const metadata = spawnSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--offline',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      path.join(root, 'apps/desktop/src-tauri/Cargo.toml'),
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  assert.equal(metadata.status, 0, metadata.stderr);
  const pkg = JSON.parse(metadata.stdout).packages.find(
    (value) => value.name === 'ai-clip-memory-desktop',
  );
  const target = pkg.targets.find((value) => value.name === 'updater_visual');
  assert.ok(target?.kind.includes('example'));
  assert.equal(target['required-features'], undefined);
});

test('non-Windows selection compiles without external crates and exits 78 without I/O', () => {
  windowsBody();
  const parent = path.join(root, 'dist/test/macos-m1');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'updater-visual-gate-'));
  const fixture = path.join(directory, 'non-windows.rs');
  // Windows simulates non-Windows item selection without forging a built-in
  // target cfg. On macOS/Linux compile the unmodified source directly.
  writeFileSync(
    fixture,
    process.platform === 'win32'
      ? source
          .replaceAll('#[cfg(windows)]', '#[cfg(any())]')
          .replaceAll('#[cfg(not(windows))]', '#[cfg(all())]')
      : source,
  );
  const executable = path.join(
    directory,
    process.platform === 'win32' ? 'inert.exe' : 'inert',
  );
  const built = spawnSync(
    'rustc',
    ['--edition=2021', fixture, '-o', executable],
    {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    },
  );
  assert.equal(built.status, 0, built.stderr);
  const before = readdirSync(directory).sort();
  for (const args of [[], ['--data-dir', 'MUST-NOT-CREATE'], ['--update']]) {
    const result = spawnSync(executable, args, {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      input: 'synthetic input must never reach Tauri or SQLite',
    });
    assert.equal(result.status, 78);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(readdirSync(directory).sort(), before);
});
