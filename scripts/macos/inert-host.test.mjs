import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('the exact macos-dev standalone entry point rejects protocol and maintenance invocations without I/O', () => {
  const source = path.join(
    root,
    'apps/desktop/src-tauri/src/macos_dev/inert_host.rs',
  );
  assert.ok(
    existsSync(source),
    'separate compile-time inert entry point required',
  );
  const code = readFileSync(source, 'utf8')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  assert.match(
    code,
    /^fn main\(\) -> std::process::ExitCode\s*\{\s*std::process::ExitCode::from\(78\)\s*\}$/,
  );
  const parent = path.join(root, 'dist/test/macos-m1');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, 'inert-host-'));
  const executable = path.join(
    directory,
    process.platform === 'win32' ? 'disabled-host.exe' : 'disabled-host',
  );
  const entry = path.join(
    root,
    'apps/desktop/src-tauri/src/bin/ai-clip-memory-native-host.rs',
  );
  // Compile the real root entry point without any application --extern library.
  // This also fails if a production import becomes reachable in macos-dev.
  const built = spawnSync(
    'rustc',
    [
      '--edition=2021',
      '--cfg',
      'feature="macos-dev"',
      '--crate-name',
      'slate_disabled_host',
      entry,
      '-o',
      executable,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  assert.equal(built.status, 0, built.stderr);
  const before = readdirSync(directory).sort();
  const body = Buffer.from(
    JSON.stringify({
      type: 'capture',
      content: 'synthetic, never persisted',
      version: 1,
    }),
  );
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  for (const args of [
    [],
    ['--export-maintenance-handle', '1234'],
    ['chrome-extension://synthetic/'],
    ['--data-dir', 'MUST-NOT-OPEN'],
  ]) {
    const result = spawnSync(executable, args, {
      cwd: directory,
      input: Buffer.concat([header, body]),
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    assert.equal(result.status, 78);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  assert.deepEqual(readdirSync(directory).sort(), before);
});
