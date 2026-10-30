# Local Windows updater TEST preparation

This tooling prepares copied Rust source for two local TEST packages, `0.2.0`
and `0.2.1`. It does not build, sign, launch an installer, change a trust store,
or read updater signing credentials. Installation needs its separate approval
after the installed application's library and related data have been backed up.

## x64 preparation

The optional final architecture argument is `arm64` (the backward-compatible
default) or `x64`. For Intel/AMD test packages, use:

```powershell
node scripts/windows/updater-e2e/prepare.mjs prepare '<public-test-ca.pem>' '<existing-frontend-dist>' x64
```

This creates a new `dist/test/updater-e2e-x64/run-*` directory. Reuse the build
commands below with target `x86_64-pc-windows-msvc` instead of
`aarch64-pc-windows-msvc`. Preserve installers as
`Slate-UPDATER-TEST-0.2.0-x64-setup.exe` and
`Slate-UPDATER-TEST-0.2.1-x64-setup.exe`. Signing remains separately approved and
must authenticate the exact new x64 bytes, never reuse an ARM64 signature.
Pass `x64` as the final argument to both `manifest` and `serve` as well; the
manifest platform is `windows-x86_64`. The public-only verifier is selected for
the Node host architecture, independently from the installer architecture.

Do not run these installers on the ARM64 validation machine. Real x64 update,
restart, retention and browser-capture validation must run on Intel/AMD Windows
after separate approval and a backup. WebView2 provisioning remains disabled;
the x64 machine must already have a working WebView2 runtime. The test HTTPS
server must run on that same test machine because its endpoint is loopback-only.
Its disposable TLS certificate/key and public CA may be transferred for this
test; the external updater private signing key and passphrase must never be
included. Public certificates expire, so verify their dates before scheduling
the test. Only one test server may bind port 17443; the architecture argument
never changes the production endpoint or weakens HTTPS/signature verification.

Test executable manifests can be verified independently of installers:

```powershell
node --test scripts/windows/test-target-manifests.test.mjs
# Cross-compile/inspect only; this does not claim native x64 runtime coverage:
$env:SLATE_TEST_MANIFEST_TARGET = 'x86_64-pc-windows-msvc'
node --test scripts/windows/test-target-manifests.test.mjs
Remove-Item Env:SLATE_TEST_MANIFEST_TARGET
```

The copied application deliberately retains product name `AI Clip Memory`,
identifier `com.aiclipmemory.desktop`, the native host identity and NSIS hooks.
That makes these packages suitable for the approved in-place experiment. Their
window title is `Slate UPDATER TEST`. Do not distribute these packages.

## Prepare

From this worktree, in a clean shell without CI/signing/environment overrides:

```powershell
node scripts/windows/updater-e2e/prepare.mjs prepare '<absolute public TEST ca.pem under dist/test>' '<absolute existing frontend output directory under this worktree>'
```

The frontend directory must already have `index.html`. The public CA must be a
currently valid CA certificate; its private key is not an input. Only the existing
public signing key at `dist/test/updater-disposable-signing/disposable-test.key.pub`
is read. The tool creates a unique `dist/test/updater-e2e-arm64/run-*` directory
with a source SHA-256 inventory, `TEST-POLICY.json`, and versioned `src-tauri`
trees. It does not copy node_modules, target, examples, generated output, or
private material. Native messaging JSON is generated afresh from the public
template and extension identities. Existing source files are never overwritten.

The input frontend directory is absolute for auditing, but each copied Tauri
configuration stores it relative to its own `src-tauri` directory with forward
slashes. Tauri parses an absolute Windows `C:\...` path as a `c:` URL before
trying a filesystem directory, which skips asset embedding and causes launcher
URL construction to panic. Do not replace the generated relative path with an
absolute Windows path. Rebuilt installers require new signatures; never reuse a
signature or manifest from an earlier build.

Each copied controller enables installation in its constructor. Each copied
Cargo package/config version is updated; `app.package_info().version` therefore
uses the test version. The copied driver uses pinned Tauri 2.12.3/updater 2.13.3,
direct reqwest 0.13.4/native TLS, an embedded public CA, no proxy, and only
`https://127.0.0.1:17443/slate-e2e/`. Redirects obey the same constraint.
Certificate and hostname checks, signed-version authentication and downgrade
protection remain enabled. Runtime provisioning is skipped. Production source
and configuration remain disabled and are checked before/after preparation.

## Build commands for the separately authorized operator

Run these only after reviewing the staged source and inventory. These commands
have **not** been executed by this preparation tool. The installed local CLI's
`build --help` confirms `--debug`, `--no-sign`, and runner arguments after `--`.
Use the root's installed compiler/dependencies and existing shared target cache;
do not install a compiler, SDK, WebView or other dependency to make this work.

Set these explicit paths to the returned run directory and this worktree:

```powershell
$testWorktree = '<absolute worktree>'
$testRun = '<returned run directory>'
$testTarget = Join-Path $testWorktree 'apps/desktop/src-tauri/target'
$testCli = Join-Path $testWorktree 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'
$env:CARGO_TARGET_DIR = $testTarget
$env:CARGO_NET_OFFLINE = 'true'
```

For each version, first build its native host, then bundle from the directory
containing its copied `src-tauri`. Build `0.2.0` and preserve its resulting test
installer before starting `0.2.1`; both versions reuse the target directory.

```powershell
$testVersion = '0.2.0' # Repeat explicitly with 0.2.1 after preserving 0.2.0.
$testStage = Join-Path $testRun "$testVersion/src-tauri"
cargo build --offline --locked --manifest-path (Join-Path $testStage 'Cargo.toml') --target aarch64-pc-windows-msvc --target-dir $testTarget --bin ai-clip-memory-native-host
if ($LASTEXITCODE -ne 0) { throw 'STOP: native host build failed' }
Push-Location (Split-Path -Parent $testStage)
try {
  node $testCli build --debug --no-sign --bundles nsis --target aarch64-pc-windows-msvc -- --offline --locked
  if ($LASTEXITCODE -ne 0) { throw 'STOP: TEST bundle build failed' }
} finally { Pop-Location }
```

Inspect the actual reported bundle path under the shared target's
`aarch64-pc-windows-msvc/debug/bundle/nsis`. Preserve only the exact newly built
installers with exclusive, ordinary-file writes and record their SHA-256s.
The update package's preserved filename must be
`Slate-UPDATER-TEST-0.2.1-arm64-setup.exe` in the selected TEST output directory.
The initial package should be named `Slate-UPDATER-TEST-0.2.0-arm64-setup.exe`.
These names and the loopback URL are incompatible with the production release
validator. Build failure is a stop condition; no weakened validation is allowed.

These are unoptimized debug-bundled TEST installers, not production release
candidates. This reuses the existing debug dependencies to avoid another complete
release build. The actual updater controller, signed download authentication,
maintenance barrier, current-user NSIS hooks and restart path are exercised.

Before installing, close Slate through its tray and close Chrome/Edge in the test
account only, after the user approves. Repeat a cold backup from a normal interactive
PowerShell session, not a Codex-launched packaged context. Do not assume that a
one-row database visible from that context is the current visible Slate library.
Confirm the backup's logical baseline against the real library before proceeding.
Keep the frozen v0.1.0 installer available for a separately approved recovery;
do not bypass downgrade protection or automatically uninstall/reset data.

## Manual signature gate and local server

The user separately approves manual signing. This tooling supplies no signing
command and never reads a signing key. The operator must provide the genuine
`.sig` for the exact `0.2.1` TEST EXE, with authenticated trusted version `0.2.1`.
The signature is adjacent to the preserved installer, with suffix `.exe.sig`.

```powershell
node scripts/windows/updater-e2e/prepare.mjs manifest '<TEST output directory containing the exact update EXE and genuine .sig>'
```

This executes only the existing public-key-only A1 verifier at its exact cached
ARM64 debug path. It verifies artifact bytes, signature, public key and signed
version before writing either `a1-verification.json` or `manifest.json` using
exclusive writes. Unsigned, tampered, wrong-key, or wrong-version inputs fail
closed. No manifest or signature is fabricated. Cargo's known executable may
have its normal `deps` hardlink; artifact/source/key/TLS inputs may not.

Once A1 passes, an operator may start the fixed local HTTPS endpoint with an
already generated TEST TLS certificate/key. Only these transport credentials
are inputs to `serve`; no updater signing material is supported:

```powershell
node scripts/windows/updater-e2e/prepare.mjs serve '<same TEST output directory>' '<absolute dist/test/.../server.pem>' '<absolute dist/test/.../server.key>'
```

The server freshly repeats A1 before reading TLS credentials or binding. It
compares the saved manifest/evidence, binds only `127.0.0.1:17443`, accepts only
GET with the exact Host header, and serves exactly the fixed manifest and update
artifact routes. No directory traversal or arbitrary file serving exists.
It streams the authenticated, frozen artifact bytes in 256 KiB chunks every
20 ms, allowing visible progress without exhausting the driver's 30s timeout.
There is no external network publication. Stop this foreground server with
Ctrl+C after the separately authorized installation/UI experiment.

Expected operator scenarios after backup and installation approval: install
`0.2.0`; launch it and check current version; check for `0.2.1`; observe download
progress, cancel and retry; verify the ready/restart state; approve restart to
update; observe safety-gate behavior and `0.2.1` after restart. Record any running
Chrome/extension activity and safety-gate decisions. Do not bypass those gates.
No installer is launched by the preparation or server tool.

## Minimal end-to-end acceptance checklist

The user-reported x64 happy-path result, independent evidence, regression results,
limitations, and deferred cleanup are recorded in
[Windows x64 updater E2E validation](../../../docs/WINDOWS_X64_UPDATER_E2E_VALIDATION.md).
This checklist remains a procedure, not a claim that every scenario was exercised.

1. Obtain separate approval to close the existing Slate tray app and Chromium
   browsers, finish the normal-session cold backup, and run the initial installer.
   Record the real library's count, schema version and clip-ID digest without
   displaying clip contents. Preserve originals and the backup.
2. Install the TEST `0.2.0` in place, then confirm Settings/About says `0.2.0`.
   Create a synthetic clip named `SLATE UPDATER E2E ARM64`, verify it opens, and
   record the baseline count/ID digest after this intentional addition.
3. After separately approved interactive TEST signing and successful A1 validation,
   start the local HTTPS server. Confirm Update Available appears without an
   automatic download. Click Update Now, observe progress and verified readiness.
4. Confirm an open main-window or Quick Search editor blocks restart without
   discarding its draft. Explicitly save/cancel it, then click Restart to Update
   only after installation approval. Do not bypass a maintenance-gate error.
5. Confirm Slate exits normally, the passive NSIS install finishes, and Slate
   automatically returns. Check Settings/About and installed file metadata for
   `0.2.1`. Compare the pre-update clip count/ID digest and open the synthetic clip.
6. Save synthetic/public text from a normal browser page through the existing
   Chrome extension. Verify the success acknowledgement, live refresh and that
   the new clip is still present after a full Slate restart.
7. For basic recovery, stop only the TEST HTTPS server and use Check for Updates:
   expect an error while normal library use remains available. Restart the server
   and retry. If installer execution itself fails, record the error and installed
   version before any recovery; NSIS does not promise transactional rollback.

Signing, installer execution, application shutdown and data-changing acceptance
actions above are instructions for a future approved run, not preparation steps.

## Verify tooling

```powershell
node --test scripts/windows/updater-e2e/updater-e2e.test.mjs
```

Tests use existing public fixtures and a currently valid public CA under
`dist/test/updater-e2e-transport/run-*/ca.pem`, create ignored TEST output only,
and run no build, signing, or installer command. The real wrong-version A1 test
executes the cached public verifier. The managed filesystem may prohibit
creating the hardlink negative fixture; that one test then explicitly skips.
Preparation uses ancestor/canonical path checks, bounded regular unlinked
source files, exclusive writes and before/after source hashes. It is a local
cooperative tool, not a replacement for the runtime's handle-pinned Windows
security boundary against an adversary changing paths concurrently.
