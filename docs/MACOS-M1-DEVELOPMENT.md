# macOS M1 development foundation

M1 is an isolated, debug-only porting profile, not a supported public macOS release. It starts from shipped desktop commit `abd997637dedf0955afa15fe68114eba8154ea56` (tree `8f1e9ce3e3ff930da9eef1bc30765d7cbcb77e33`), not website production main. Windows configuration, updater implementation, installer hooks, migrations 0001–0003 and extension protocol remain unchanged.

**P1 correction (2026-10-26), awaiting review:** the host's shipped unconditional Cargo target is restored. The added `native-host` required/default feature contract was removed because Tauri CLI 2.12.2's binary selector uses explicitly selected features, not Cargo's default-feature expansion. An actual pinned-CLI regression now checks rendered NSIS inputs for ARM64 and x64, including the maintenance alias from the same selected host file. An injected first-line compiler error stops before any installer is produced. No released package was rebuilt. Do not commit, push or dispatch without approval.

## Isolation contract

- Product/window title: **Slate macOS Development**.
- Bundle/application identifier: `com.aiclipmemory.desktop.macos-dev`.
- SQLite: `~/Library/Application Support/com.aiclipmemory.desktop.macos-dev/clips.sqlite3`. The actual account home comes from the OS account database, not a `HOME` override. Tauri's resolved application-data directory must match before storage initialization.
- The development directory is created with mode `0700`; existing profiles must belong to the current non-root user and forbid group/other access. An exclusive private `profile.lock` prevents two cooperating development instances. Redirected ancestry, links, unsafe permissions, hardlinked database files and replaced profile roots are rejected. Existing unsafe permissions are never repaired automatically.
- WKWebView uses the fixed development-only `dataStoreIdentifier` `[83,108,97,116,101,77,49,68,101,118,83,116,111,114,101,49]`. This is a separate persistent WebKit store, not a promise that WebKit uses the SQLite directory. Both the bundle minimum and runtime OS check require macOS 14+; older systems cannot silently fall back to the default store. See [Tauri configuration](https://v2.tauri.app/reference/config/).
- The main window is not automatically created. Effective configuration and profile guards run before plugins/windows, then the guarded main window is constructed explicitly.
- Empty updater endpoint/key plus the existing inert native updater module: no discovery, download, staging, installer launch or restart-to-update path. The updater SDK dependency remains locked, but the production application adapter is not selected.
- No Native Messaging registration, autostart plugin, global shortcut registration, production maintenance gate, production single-instance forwarding or privileged writes.
- The bundle includes `ai-clip-memory-native-host`, preserving the unconditional Windows target contract. Under `macos-dev`, compile-time selection replaces its entire entry point with a standard-library-only function returning exit code 78 (unavailable). Production imports, protocol handling, argument processing, filesystem/database access, maintenance export, updater and GUI code are not compiled into that host entry point. It emits no stdout/stderr and is never spawned by the GUI. It is not registered with Chrome and provides no M1 browser capture capability.
- Missing `macos-dev`, release/non-debug builds, Windows use or mixed `ux-dev` fail closed. There is no new `native-host` feature or Cargo default-feature contract. The corrected Mac command retains explicit `--no-default-features` after Tauri's `--` separator.
- The development icon PNG is the unchanged 256px frame from the existing Slate ICO. Tauri converts it to ICNS while bundling; keeping PNG source preserves the historical Windows tooling's existing strict source-file allowlist.
- Main-window clipboard and source opening reuse existing plugins and admission guards. Quick Search, selected-text capture and autostart report unavailable; browser capture is not connected in M1. Existing UI may retain Windows shortcut hints until a later parity checkpoint.
- Startup writes a local `startup-<UUID>.json` receipt under the development directory with identity, database path, WebKit store and disabled-feature status. No credentials or production data are read. The receipt is created only when the application is actually launched; CI does not launch it.

This isolates supported application paths; it is not an OS sandbox against another malicious process running as the same user. Do not redirect the development directory while the app is running. Profile guards never inspect production SQLite contents.

### Tauri data-store code-generation compatibility

The locked Tauri 2.12.3 / tauri-build, tauri-codegen and tauri-macros 2.7.2 / tauri-utils 2.10.1 stack emits a `Vec<u8>` for the array-valued JSON `dataStoreIdentifier`. The first native diagnostic run failed on both architectures for this reason. The published tauri-utils 2.10.2 generator has the same mismatch, so dependency versions remain unchanged.

The compile-time overlay therefore leaves that field unset. The build script records the complete effective configuration using the same locked `tauri_codegen::get_config` parser/merge rules as the context macro. This also preserves bundle-only metadata which Tauri intentionally omits from the generated runtime context. Immediately after `generate_context!`, macOS development startup restores that configuration and applies the unchanged `policy::STORE_ID` through `Context::config_mut()`, validates a candidate, and only then replaces the context configuration. Any preassigned identifier or unsafe configuration is rejected without mutation. The existing runtime validator still rejects an absent or different store, and the explicit window builder still selects the fixed identifier. Preparation and validation complete before profile access, plugins or windows; no WebView can launch using the default store. The two direct build dependencies (`serde_json` and pinned `tauri-codegen`) were already in the lockfile; no package version changes are required. Windows startup does not select this restoration path.

The `macos_development` integration tests exercise the real context macro and typed preparation on native CI. On Windows the same code-generation boundary can be tested by passing the actual overlay as process-scoped `TAURI_CONFIG` with `SLATE_M1_CODEGEN_PROBE=1` while running that integration-test target. This does not launch the application or access user data. Native compilation, bundle inspection and actual WKWebView persistence still require their separately approved macOS checks.

## Local checks on Windows

From this worktree root:

```powershell
corepack pnpm install --frozen-lockfile --filter @ai-clip-memory/desktop --filter @ai-clip-memory/extension --filter ai-clip-memory --ignore-scripts
node --test scripts/macos/*.test.mjs
node scripts/macos/m1.mjs validate
node scripts/macos/m1.mjs rust-policy-tests
corepack pnpm --filter @ai-clip-memory/desktop test
corepack pnpm --filter @ai-clip-memory/extension test
corepack pnpm --filter @ai-clip-memory/desktop --filter @ai-clip-memory/extension typecheck
corepack pnpm exec eslint --config eslint.config.mjs apps/desktop/src apps/extension/src packages/shared/src scripts
corepack pnpm --filter @ai-clip-memory/desktop build:frontend
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
```

Root `pnpm lint` auto-discovers the site's ESLint configuration; the filtered desktop install intentionally does not install its Astro plugin. The explicit root configuration and paths above lint the complete desktop/extension/shared/tooling scope without installing website dependencies or changing lockfiles.

For Rust tests, use one isolated target tree; these environment variables are non-secret and should be scoped to a dedicated terminal:

```powershell
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'dist/test/macos-m1/windows-cargo'
$env:CARGO_INCREMENTAL = '0'
$env:CARGO_PROFILE_DEV_DEBUG = '0'
$env:CARGO_PROFILE_TEST_DEBUG = '0'
cargo test --locked --offline --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Do not reuse a frozen release/rehearsal target directory or build a Windows release package for M1. The packaging-contract test uses tiny synthetic executables of each Windows architecture and the unchanged shipped NSIS template with a first-line `!error`; it deliberately aborts the compiler after rendering, never producing or executing an installer. Inputs and receipts remain ignored under `dist/test/macos-m1`. No cache cleanup is part of this checkpoint.

## Prepared CI, not yet executed

`.github/workflows/macos-m1.yml` is a proposed diagnostic bootstrap with only `workflow_dispatch`, read-only repository permission, pinned Node 24 action SHAs and no production secrets. Dispatch must use `main` and supply a reviewed full `source_sha`. Before checkout, a shell guard rejects non-hex inputs and requires the SHA to equal the fixed `codex/macos-m1-development` remote branch HEAD. Checkout uses that SHA, never the dispatch branch. After checkout it verifies HEAD, frozen ancestry, clean source, protected Windows files, and identical workflow bytes between source and the trusted default-branch workflow commit. Input expressions enter shell only through quoted environment variables. Its native matrix is:

| Runner | Rust target | Bundle executable |
| --- | --- | --- |
| `macos-15` | `aarch64-apple-darwin` | ARM64 |
| `macos-15-intel` | `x86_64-apple-darwin` | Intel x86_64 |

Project Node 22.16.0, pnpm 11.19.0 and Rust 1.98.0 are pinned independently of the action runtime. The deployment target is 14.0. A single concurrency group and `max-parallel: 1` serialize the two native jobs; each has a 45-minute limit and two Cargo workers. Downloaded dependencies are cached per architecture and lockfiles; Cargo target trees are not cached or shared. The workflow runs frontend/extension tests, configuration/policy checks, lint, full Rust tests including existing SQLite migration tests, then a locked debug `.app` build. Cargo-only options are passed after Tauri's separator: `tauri build --debug --features macos-dev --target <target> --bundles app -- --no-default-features --locked`. Tauri CLI 2.12.2 rejects `--no-default-features` as a top-level CLI flag.

The bundle is ad-hoc signed using identity `-`, not Developer ID signed, notarized or stapled. Inspection checks both desktop and host Mach-O architectures/minimum OS/ad-hoc signatures, Info.plist identity/version, a strict file inventory and absence of the production updater endpoint/key. Only on a disposable GitHub-hosted runner, inspection deliberately probes the bundled inert host in protocol and maintenance modes; both must return 78 with no output. This probe refuses to run on a real user's Mac account. Standalone source tests also compile the actual host root without the application library and exercise hostile arguments and framed input. Windows-only NSIS contract tests are skipped on Mac; Mac binary inspection/probes remain pending the first authorized CI run.

The first diagnostic run uploads only public provenance, Rust-test/compiler logs and an inspection receipt for three days, including available evidence after failure. No executable, `.app` or archive is uploaded. No private profile/database, source tree, Cargo target, credentials, DMG or production updater signature is published. Evidence from a public repository must not be treated as confidential.

**Dispatch prerequisite:** GitHub requires a manually dispatched workflow to exist on the default branch. This branch currently remains local, and adding a workflow to production main is outside M1 authorization. A separately approved CI bootstrap/review path is required before the first dispatch; do not merge desktop changes into website main merely to register this workflow. See [GitHub manual-workflow requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow?tool=cli).

The proposed default-branch change is exactly one added `.github/workflows/macos-m1.yml`, byte-identical to the reviewed source copy. Source publication, bootstrap commit/push and dispatch each need separate approval. Both proposed source/bootstrap commit messages must begin `[CF-Pages-Skip]` to suppress the existing automatic Pages integration without changing infrastructure settings; verify Pages did not deploy after any future push. Cloudflare documents this prefix in [GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message). Main's website and updater manifest must remain byte-identical.

No CI run or macOS compilation success is implied by local validation. Runner availability, Xcode/SDK compatibility, ad-hoc bundle signing and the actual bundle inventory must pass the first approved CI run. OS-specific account/filesystem tests also remain pending that run.

## Future Mac developer commands — not run in M1

After CI review and access to a suitable Mac, use a normal non-root account with no signing/configuration overrides. Select the native target explicitly:

```sh
# Apple Silicon; on Intel use x86_64-apple-darwin instead.
export CARGO_TARGET_DIR="$PWD/dist/test/macos-m1/cargo-aarch64-apple-darwin"
export CARGO_INCREMENTAL=0
export MACOSX_DEPLOYMENT_TARGET=14.0
node scripts/macos/m1.mjs validate
corepack pnpm --filter @ai-clip-memory/desktop tauri dev --features macos-dev --target aarch64-apple-darwin -- --no-default-features --locked
```

For a CI-equivalent bundle instead of launching:

```sh
corepack pnpm --filter @ai-clip-memory/desktop tauri build --debug --features macos-dev --target aarch64-apple-darwin --bundles app -- --no-default-features --locked
```

The workflow runs `m1.mjs inspect` on the disposable hosted runner after building. Do not spoof CI environment variables to run its direct-host probe on a personal Mac. No GUI application launch is part of CI inspection.

Do not enter production signing credentials. Do not remove macOS security attributes, grant privileged access, register a browser host or enable autostart to make this development bundle run. Gatekeeper/public distribution is a later signing/notarization checkpoint.

## Remaining gates

1. Review and separately authorize the CI bootstrap, source commit/push and first manual run.
2. Pass both native compilation/test/bundle-inspection jobs; investigate failures without weakening isolation.
3. On real Mac hardware verify actual WKWebView launch/store isolation, CRUD/grouping, clipboard, preferences and persistence after restart, normal Quit/hide behavior, focus, tray and Dock. macOS Command-Q/session termination behavior remains unvalidated; do not treat M1 as complete lifecycle parity.
4. Implement Native Messaging, Quick Search/shortcuts and production distribution in later scoped checkpoints. No production macOS updater exists in M1.
