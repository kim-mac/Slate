// @ts-check
// Builds only the standalone, public-key-only verifier. Never Slate or an installer.
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { localInputPath } from './validate-desktop-update-release.mjs';

const worktree = fileURLToPath(new URL('../../', import.meta.url));
const crate = join(worktree, 'scripts/windows/update-signature-verifier');
const defaultTarget = join(crate, 'target');
const binary = 'slate-update-signature-verifier';

/** @param {string} host @param {string} targetDirectory */
export function buildPlan(host, targetDirectory) {
  if (!/^[a-z0-9_]+(?:-[a-z0-9_]+){2,}$/.test(host))
    throw new Error('Invalid Rust host target');
  const target = localInputPath(targetDirectory);
  const testRelative = relative(join(worktree, 'dist/test'), target);
  if (
    target !== defaultTarget &&
    (isAbsolute(testRelative) ||
      testRelative.startsWith('..') ||
      !/^verifier-clean-build-[^\\/]+[\\/]/.test(testRelative))
  ) {
    throw new Error(
      'Verifier build target must be its cache or an isolated clean-build test directory',
    );
  }
  return {
    target,
    args: [
      'build',
      '--offline',
      '--locked',
      '--manifest-path',
      join(crate, 'Cargo.toml'),
      '--bin',
      binary,
      '--target',
      host,
      '--target-dir',
      target,
      '--message-format',
      'json',
      // Scope CRT linkage to this standalone tool's target. No runtime install
      // is required on a clean test PC, and Slate's build remains unchanged.
      ...(host.endsWith('-windows-msvc')
        ? [
            '--config',
            `target.${host}.rustflags=["-C","target-feature=+crt-static"]`,
          ]
        : []),
    ],
  };
}

/** Resolve the executable from Cargo's actual compiler-artifact message, not a guessed cache path.
 * Explicit --target overrides CARGO_BUILD_TARGET; --target-dir overrides CARGO_TARGET_DIR.
 * @param {string} [targetDirectory]
 */
export function buildVerifier(targetDirectory = defaultTarget) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/KEY|PASS|TOKEN|SECRET|CREDENTIAL/i.test(name),
    ),
  );
  const hostResult = spawnSync('rustc', ['-vV'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env,
  });
  if (hostResult.error || hostResult.status !== 0)
    throw new Error('Unable to determine installed Rust host');
  const host = /^host: ([a-z0-9_-]+)$/m.exec(hostResult.stdout)?.[1];
  if (!host) throw new Error('Missing Rust host target');
  const plan = buildPlan(host, targetDirectory);
  const result = spawnSync('cargo', plan.args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      'Offline locked verifier build failed; check local Rust toolchain and cached dependencies',
    );
  let executable;
  try {
    for (const line of result.stdout.trim().split(/\r?\n/)) {
      const item = JSON.parse(line);
      if (
        item.reason === 'compiler-artifact' &&
        item.target?.name === binary &&
        item.executable
      )
        executable = item.executable;
    }
  } catch {
    throw new Error('Invalid Cargo build report');
  }
  if (typeof executable !== 'string')
    throw new Error('Cargo did not report the verifier executable');
  executable = resolve(executable);
  const location = relative(plan.target, executable);
  if (
    isAbsolute(location) ||
    location.startsWith('..') ||
    (!location.startsWith(`${host}/`) && !location.startsWith(`${host}\\`))
  )
    throw new Error('Cargo reported an unexpected verifier target');
  if (!lstatSync(executable).isFile())
    throw new Error('Built verifier executable is missing');
  return { built: true, host, executable };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error('No command-line overrides supported');
    process.stdout.write(`${JSON.stringify(buildVerifier(), null, 2)}\n`);
  } catch {
    process.stderr.write(
      'Offline verifier build failed. Check installed Rust, local dependency cache and worktree access; no network/dependency installation was attempted.\n',
    );
    process.exitCode = 1;
  }
}
