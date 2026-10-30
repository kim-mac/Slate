import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import console from 'node:console';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { createConnection } from 'node:net';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args) => {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, 'Git preflight failed');
  return result.stdout.trim();
};
function ordinaryTree(file) {
  if (!existsSync(file)) return;
  const stat = lstatSync(file);
  assert.ok(
    !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile()),
    'Linked or special UX path refused',
  );
  assert.equal(
    realpathSync(file).toLowerCase(),
    path.resolve(file).toLowerCase(),
    'Redirected UX path refused',
  );
  if (stat.isFile()) assert.equal(stat.nlink, 1, 'Hardlinked UX file refused');
  else
    for (const name of readdirSync(file)) ordinaryTree(path.join(file, name));
}
try {
  assert.equal(process.platform, 'win32', 'Windows required');
  assert.equal(
    process.arch,
    'arm64',
    'Native ARM64 Node required for this launch',
  );
  assert.ok(
    process.argv.length === 2 ||
      (process.argv.length === 3 && process.argv[2] === '--preflight'),
    'No custom launch arguments accepted',
  );
  for (const name of Object.keys(process.env)) {
    assert.ok(
      !/^(WEBVIEW2_|TAURI_CONFIG$|TAURI_ENV_|TAURI_.*PRIVATE_KEY|SLATE_PRIVATE_REHEARSAL_|SLATE_UPDATER_E2E_|VITE_|NODE_OPTIONS$|NODE_PATH$|RUSTFLAGS$|CARGO_ENCODED_RUSTFLAGS$|CARGO_BUILD_TARGET$|CARGO_PROFILE_|CI$)/i.test(
        name,
      ),
      'Unsafe inherited development override refused',
    );
  }
  assert.equal(path.basename(path.resolve(root)), 'codex-inline-clip-content');
  assert.equal(git('branch', '--show-current'), 'codex/inline-clip-content');
  assert.equal(
    git('rev-parse', 'HEAD'),
    'b40e209fda6772b0095fcc63f3910bc73cb08a50',
  );
  assert.equal(
    git('diff', '--cached', '--name-only'),
    '',
    'Index must remain empty',
  );
  const config = JSON.parse(
    readFileSync(
      path.join(root, 'apps/desktop/src-tauri/tauri.ux-dev.conf.json'),
    ),
  );
  assert.equal(config.identifier, 'com.aiclipmemory.desktop.ux-dev');
  assert.deepEqual(config.plugins.updater, { pubkey: '', endpoints: [] });
  assert.equal(config.bundle.active, false);
  const profile = path.join(root, 'dist/test/ux-dev/profile-v1');
  git('check-ignore', '--quiet', profile);
  assert.equal(
    git('ls-files', '--', 'dist/test/ux-dev'),
    '',
    'UX data must never be tracked',
  );
  for (let cursor = path.resolve(profile); ; cursor = path.dirname(cursor)) {
    if (existsSync(cursor)) {
      assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Linked ancestry refused');
      assert.equal(
        realpathSync(cursor).toLowerCase(),
        cursor.toLowerCase(),
        'Redirected ancestry refused',
      );
    }
    if (path.dirname(cursor) === cursor) break;
  }
  ordinaryTree(profile);
  await new Promise((resolve, reject) => {
    const probe = createConnection({ host: '127.0.0.1', port: 1420 });
    probe.once('connect', () => {
      probe.destroy();
      reject(new Error('Vite port already in use'));
    });
    probe.once('error', (error) => {
      probe.destroy();
      if (error.code === 'ECONNREFUSED') resolve();
      else reject(error);
    });
    probe.setTimeout(1500, () => {
      probe.destroy();
      reject(new Error('Vite port probe timed out'));
    });
  });
  for (const name of [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
  ]) {
    assert.ok(
      !existsSync(path.join(root, 'apps/desktop', name)),
      'Local Vite environment file refused',
    );
  }
  console.log(
    JSON.stringify({
      uxDevelopmentPreflight: 'PASS',
      profile,
      updaterNetworkEnabled: false,
      installationEnabled: false,
    }),
  );
  if (process.argv[2] !== '--preflight') {
    const child = spawn(
      process.execPath,
      [
        path.join(root, 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'),
        'dev',
        '--config',
        'src-tauri/tauri.ux-dev.conf.json',
        '--features',
        'ux-dev',
        '--target',
        'aarch64-pc-windows-msvc',
        '--no-watch',
        '--',
        '--locked',
        '--offline',
      ],
      {
        cwd: path.join(root, 'apps/desktop'),
        stdio: 'inherit',
        shell: false,
        env: {
          ...process.env,
          CARGO_TARGET_DIR: path.join(root, 'dist/test/inline-content/cargo'),
          CARGO_PROFILE_DEV_DEBUG: '0',
        },
      },
    );
    child.on('error', () => {
      console.error('UX development launch failed');
      process.exitCode = 1;
    });
    child.on('exit', (code) => {
      process.exitCode = code ?? 1;
    });
  }
} catch {
  console.error(
    'UX development preflight BLOCKED. No application was launched. Check branch, ignored paths, profile links, config and inherited overrides.',
  );
  process.exitCode = 1;
}
