# Windows x64 updater E2E validation

> **Current status — Checkpoint 7C-B (2026-10-20):** The observations, artifact
> hashes, test counts and limitations below remain the historical 2026-10-16
> record. Normal source has since reached v0.3.0 with production public trust,
> the permanent HTTPS endpoint and explicitly user-confirmed installation enabled
> for configured Windows builds. Earlier disabled/unconfigured-source statements
> are not current policy. The maintainer subsequently reported production-signed
> private 0.2.9 → 0.3.0 updates passed on both architectures; that does not certify
> future public installer bytes. See `DESKTOP_UPDATE_RELEASE_CONTRACT.md`.

Recorded: 2026-10-16. Branch: `codex/desktop-updater`, base commit
`1078c27a2d702c6f936548000975cfb50080c82e` plus the uncommitted updater work.

## Verdict and evidence boundary

**PASS, user-reported x64 happy-path E2E:** test 0.2.0 discovered 0.2.1,
downloaded after a user action, restarted through the installer handoff, returned
showing version 0.2.1, and retained a previously saved clip.

This is not production release approval or an independent inspection of the
Intel/AMD PC. The reviewing agent has access to the ARM64 development worktree,
not the remote PC, its registry, installed files, database, or server logs.
No new installer execution or ARM64 E2E validation was performed for this report.

## Environment and artifacts

- User's Intel/AMD Windows PC; transferred tooling in
  `%LOCALAPPDATA%\SlateUpdaterX64TestV2`.
- User previously supplied Node v24.22.0, x64. Exact Windows build, processor model,
  and installed WebView2 version were not independently collected.
- Endpoint: `https://127.0.0.1:17443/slate-e2e/manifest.json`, served on the same PC.
- Pinned Tauri 2.12.3 / updater 2.13.3; current-user NSIS; test versions 0.2.0 and
  0.2.1; raw EXE update, `windows-x86_64`; WebView2 provisioning skipped.
- Debug-bundled TEST packages, not production release candidates or a production
  signing identity. Do not publish them.
- Maintainer package source:
  `dist/test/updater-e2e-x64/run-OUQnvR`.
- Corrected transfer source:
  `dist/test/updater-e2e-x64/transfer-kit-20261016-portable-v2`.
- Build snapshot `run-OUQnvR/source-inventory.json` SHA-256:
  `C283AB88E592753C8376D016185DD86FEF1446EAE8D71023FFF7079EE50632DD`.

| Artifact                               |     Bytes | SHA-256                                                            |
| -------------------------------------- | --------: | ------------------------------------------------------------------ |
| Slate-UPDATER-TEST-0.2.0-x64-setup.exe | 6,658,834 | `6B5BE0DF06227FF665936469CD5C3F6C2FE75DCDBCBD62C4052E5FEA2F4C7C6C` |
| Slate-UPDATER-TEST-0.2.1-x64-setup.exe | 6,661,189 | `2F997781EAF1B8256A6B0D92C77C6B1C5F0725D9B90597C1871AD3B944DB951D` |
| 0.2.1 EXE detached signature           |       452 | `FCDF2E1CF3408A674B0A2B829F0B4EFE3A29E3F897E2F4B90B37822D1D5EE449` |

The user's earlier hashes matched the installer, signature, public key, original
verifier, and preparation script. The initial verifier failed before execution
with Windows `0xC0000135` (DLL not found), not a cryptographic rejection. The
corrected x64 verifier statically links its C runtime, embeds RT_MANIFEST ID 1
with `asInvoker`/`uiAccess=false`, and imports only Windows system DLLs.
Its SHA-256 is `E40058663565CADD97B536BF43BEBFB4F0EECE1F033AA7A03AE4B3E6D777BA6C`.
No installer bytes, signature, signing identity, or verification rules changed.

## Manual observations supplied by the user

| Step                                       | Reported result                                 |
| ------------------------------------------ | ----------------------------------------------- |
| Launch initial Slate and check for updates | Launched; update detected                       |
| Click Update Now                           | Reached Restart to Update                       |
| Click Restart to Update                    | Slate closed and automatically relaunched       |
| Check Settings after relaunch              | Up to date, version 0.2.1                       |
| Open library after update                  | A clip saved before the update remained present |

Download timing/progress, installer exit code/log, every clip's identity/content,
preferences, autostart, shortcuts, and post-update browser capture were not
explicitly verified in this x64 report. Do not infer those results from the happy
path or from earlier ARM64/manual tests.

## Independently verified locally

- Existing A1 public-key verification accepted the exact corrected-kit EXE and
  detached signature, authenticated version 0.2.1, and reported the hashes above.
  The x64 verifier ran under the ARM64 development machine's x64 emulation;
  that does not independently establish native Intel/AMD execution.
- Decoded public-key fingerprint:
  `9868697D6D22F6667160A764C94933FD9C754951E7840FEE51B0A7A93C7ED36D`.
- Preserved extracted 0.2.1 desktop and native-host payloads are PE machine
  `8664` (x64), with file/product version 0.2.1. Desktop hash:
  `2C33F1364E25E5184F8EECD330B222F799734992351AE181D4A1D6E909179EA5`.
  Native-host hash:
  `53C27ECAD1566706295EC3D3CB4EDA3AA31359C132C8E18AB8C66A02D585520D`.
  These are local package-inspection outputs, not remotely measured installed files.
- Staged config and rendered NSIS retain current-user identity/installation,
  disable WebView2 provisioning and downgrades, and use the x64 platform mapping.
- `scripts/windows/updater-e2e/prepare.mjs` authenticates with A1 before exclusive
  manifest/evidence creation, repeats authentication before server startup, and
  binds only loopback with fixed GET routes and frozen authenticated payload bytes.
- Staged driver keeps HTTPS/certificate/hostname checks and signed-version
  verification enabled, embeds the disposable public CA/key, and restricts test
  transport to the fixed loopback origin/path. No production endpoint is used.
- `src/updater/mod.rs` checks metadata asynchronously, requires explicit download
  and restart actions, retains authenticated version/bytes, and invokes safety
  preparation before handoff. Production constructor installation remains disabled;
  only ignored staged test copies enable it.
- `src/updater/handoff.rs` privately stages and rechecks the authenticated bytes,
  pins file/ancestor handles, launches without a shell with `/P /UPDATE /NS /R`,
  and requests normal Slate exit only after process creation succeeds. NSIS
  independently holds the maintenance barrier, waits boundedly instead of killing
  writers, releases maintenance on success, and uses `/R` to restart Slate.

## Persistence and isolation: important qualification

**The transfer directory is isolated; the installed app and its data are not.**
The staged packages deliberately retain product name `AI Clip Memory`, identifier
`com.aiclipmemory.desktop`, Native Messaging identity, and normal storage paths.
They can replace an existing current-user Slate installation in that Windows
account. They are not the separate visual-preview identity or a sandboxed profile.

Default install path is `%LOCALAPPDATA%\AI Clip Memory`, but NSIS restores an
existing registered installation location when applicable. Actual remote location
is unverified. `src/app_paths.rs`, `src/storage.rs`, and normal startup continue to
use Tauri's app-data directory and `clips.sqlite3`, not the transfer-kit directory.
The expected normal interactive DB directory is
`%APPDATA%\com.aiclipmemory.desktop`; actual physical resolution is unverified.
WebView/theme preferences, HKCU Chrome/Edge Native Messaging, autostart, and public
shortcuts retain their existing identities too.

NSIS update mode guards app-data deletion and autostart removal; existing database
bootstrap/migration logic and safety permits are reused. The manually retained
clip is positive persistence evidence for that clip, not a full database/settings
equivalence check. No remote cold-backup baseline, row count, ID digest, or physical
database identity was supplied. Do not claim all data was independently verified.
This audit did not open, reset, migrate, or delete any production database.

Optional read-only check on the x64 PC, in normal PowerShell (not executed by the
agent): inspect the expected desktop EXE. If absent, report it rather than searching
other profiles. Compare its metadata/hash with the payload values above.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $exe = Join-Path $env:LOCALAPPDATA 'AI Clip Memory\ai-clip-memory-desktop.exe'
    $file = Get-Item -LiteralPath $exe
    [pscustomobject]@{
        Path = $file.FullName
        FileVersion = $file.VersionInfo.FileVersion
        ProductVersion = $file.VersionInfo.ProductVersion
        SHA256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    } | ConvertTo-Json
}
```

## Fresh regression commands and results

Commands below run from the updater worktree unless noted. These are local
development regressions, not another ARM64 installed-app validation.

```powershell
# From apps/desktop:
node node_modules/vitest/vitest.mjs run

# From apps/extension (browser-capture regression tests, not browser interaction):
node node_modules/vitest/vitest.mjs run

# From the worktree root:
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib updater::
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib

node --test --test-reporter=spec scripts/windows/verify-desktop-update-signatures.test.mjs scripts/windows/disposable-test-signing.test.mjs scripts/windows/validate-desktop-update-release.test.mjs scripts/windows/updater-e2e/updater-e2e.test.mjs scripts/windows/test-updater-sdk-transport.test.mjs

node --test --test-reporter=spec --test-name-pattern 'Windows verifier embeds|alternate installed Windows architecture|both Windows verifier targets|build plan explicitly' scripts/windows/build-update-signature-verifier.test.mjs
```

| Gate                                                                                                        | Result                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Complete desktop suite                                                                                      | 315/315, 31 files                               |
| Complete extension suite                                                                                    | 172/172, 11 files                               |
| Focused Rust updater tests                                                                                  | 20/20; included in the full library total below |
| Complete Rust library unit suite                                                                            | 107/107                                         |
| Selected Rust integrations below                                                                            | 111/111; 218/218 including library, two runs    |
| Offline signature, disposable-signing, release contract, E2E preparation and transport source-policy suites | 149/149                                         |
| Verifier architecture/import/manifest/build-plan checks                                                     | 4/4                                             |

The 149 tests include source-policy checks for the SDK transport harness, not a
fresh execution of all 21 HTTPS SDK scenarios. The earlier 21/21 transport result
is historical and was not rerun for this milestone. The four verifier checks
inspect both architectures; they are not an ARM64 E2E run.

Initial sandbox attempts failed before test execution: Vitest temporary-file
renames returned EPERM and the Rust permissions build script returned access
denied. The successful commands were rerun outside the Codex filesystem sandbox,
without administrator privileges or changes to Windows security settings.

This broader Rust command originally failed during compilation/linking, before
its integration tests ran. It now passes unchanged, twice in this review:

```powershell
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --test updater_security --test installation_safety_contract --test release_packaging --test clip_persistence --test storage_reliability --test native_messaging_bridge --test desktop_quick_capture --test background_lifecycle
```

Rust reported `png`, `tao`, and `tauri_winrt_notification` required in `rlib` format
but unavailable in that form. The following investigation did not change code,
dependencies, Cargo configuration, architecture selection, or test assertions:

1. Inspected `rustc -vV`, `cargo -V`, allowlisted Cargo/Rust flag environment
   variables, applicable Cargo config locations, crate types, cached dependency
   artifacts/fingerprints, and verbose compiler arguments. Host is Rust/Cargo
   1.98.0, `aarch64-pc-windows-msvc`; no target/flag/wrapper overrides were found.
2. `cargo test --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --test updater_security --no-run --verbose`
   succeeded. Its compiler commands targeted the expected host and used local
   rlib dependencies. Existing rlib variants for the named dependencies were
   present; there was no evidence of missing dependency source packages.
3. The original combined command passed: library 107, background lifecycle 11,
   clip persistence/migration 17, desktop capture 24, installation safety contract
   4, Native Messaging bridge 8, release packaging 34, storage reliability 8, and
   updater security 5. Total **218 passed, 0 failed**.
4. `cargo check --offline --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets`
   passed. Repeating the original combined test command after that metadata-only
   check also passed all 218 tests. The check/test sequence did not reproduce it.
5. The locked dependency tree for `tao` resolves through Tauri's expected Windows
   runtime. The test-specific manifest flags affect test executable linking, not
   dependency versions or feature selection. No deterministic configuration,
   feature, architecture, or test-setting defect was established.

**Resolution status:** the build gate is restored by ordinary Cargo compilation/
reruns, with no cleanup or workaround. Stale/inconsistent generated artifact state
is the leading explanation, **not a proven historical root cause**. The exact
trigger cannot be reconstructed from the previous error text; do not call it a
fixed source bug or a flaky test. A cached incremental hardlink/copy warning
remains, but these runs pass. No minimal source/dependency fix is justified.

Cargo intentionally builds application binaries for integration tests; that
explains why a library-only test could pass while an integration command failed
to link the app. Rust also distinguishes metadata-readable dependencies from
code-bearing rlibs. See the official [Cargo target-selection documentation](https://doc.rust-lang.org/cargo/commands/cargo-build.html#target-selection)
and [Rust linkage reference](https://doc.rust-lang.org/reference/linkage.html).
These explain the failure category, not its specific historical trigger.

If it recurs, preserve verbose compiler output and relevant fingerprints before
changing anything. A fresh isolated target-directory reproduction is a possible
next diagnostic only after reviewing disk cost; do not purge existing caches,
alter crate types/features, or upgrade dependencies speculatively.

The 218-test command is a selected integration gate, not the entire Rust suite:
native-host executable, cross-process gate, launcher-permission, and documentation
tests were not all rerun by that command. Earlier results are not relabeled fresh.

## Post-update functionality: automated versus pending manual evidence

- Extension tests cover selection/page/floating capture and Native Messaging
  success/failure feedback. Native bridge tests persist synthetic captures to the
  same path contract as the GUI; success responses follow persistence and flush.
- `App.test.tsx` checks focus-triggered discovery of external captures without
  losing query/selection or disrupting editors. Launcher tests check its visible
  session polling/focus refresh. Main-window refresh is focus-driven, not an
  unconditional two-second background poll.
- The 17 persistence tests include database close/reopen retention and additive
  migration preservation. Storage reliability tests reject destructive recreation
  of missing/corrupt established storage. These use disposable fixture databases,
  not the remote library.
- The 11 lifecycle tests distinguish normal close/hide from explicit tray Quit
  and verify presentation/reuse behavior. They do not launch and relaunch the real
  installed WebView or prove every existing remote clip survives.

Still required on the x64 PC; these steps have **not** been executed by the agent:

1. Open the already installed Slate normally (no installer). Confirm Settings
   version 0.2.1, then open the previously retained clip. Optionally run the
   metadata/hash command above. Keep personal clip contents out of reports.
2. With no open editor or confirmation dialog, use the official Chrome extension
   to save harmless synthetic text via Save selection, Save page, and the floating
   Save button on a supported AI site. These deliberately add new test captures;
   do not edit/delete existing clips or reset data. Record success/failure for each.
3. Return focus to the already-open main Slate window. Confirm the new captures
   appear without clicking Refresh. Open them locally to confirm they are usable.
   Optionally open Quick Search with Ctrl+Shift+Space and check refresh/query
   preservation there; allow about two seconds for its polling interval.
4. Wait for captures/saves to finish, explicitly save or cancel any draft, and use
   tray **Quit Slate**. Closing the main window only hides it. Do not close the
   debug console as a substitute for graceful quit and do not force-terminate it.
5. Relaunch the existing app from its normal shortcut, not either installer.
   Confirm 0.2.1, the old clip and all new test captures remain visible and open.
   Note whether existing theme/preferences remain as expected; no preference reset.
6. Report results before any repair, uninstall, reinstall, data restoration, or
   additional updater run if anything fails.

The user has already confirmed the update/relaunch and one retained clip. The
additional browser capture, full tray-quit/reopen, and broader retention checks
remain unreported. Automated mocks do not substitute for these x64 runtime checks.

## Windows release GUI subsystem verification

`src/main.rs` uses `cfg_attr(not(debug_assertions), windows_subsystem = "windows")`.
`scripts/windows/Build-WindowsInstaller.ps1` calls `tauri build --bundles nsis
--target <architecture>` without `--debug` and expects `target/<triple>/release`.
The production build is therefore intended to use the GUI subsystem. No checked-in
GitHub Actions workflow is present in this checkout; this audit inspected the
existing Windows release script, not an assumed hosted build workflow. The
native-host binary intentionally retains console/stdio behavior for Chrome's
protocol; do not apply the desktop GUI rule to it.

Actual PE checks, with no executable/installer launch:

| Inspected desktop binary                                      | Machine                     | Subsystem          | Status                                                      |
| ------------------------------------------------------------- | --------------------------- | ------------------ | ----------------------------------------------------------- |
| Desktop extracted from frozen v0.1.0 Windows x64 installer    | 8664, x64                   | 2, Windows GUI     | Verified                                                    |
| Desktop extracted from frozen v0.1.0 Windows ARM64 installer  | AA64, ARM64                 | 2, Windows GUI     | Verified                                                    |
| Existing updater-worktree v0.1.0 release output, x64          | 8664, x64                   | 2, Windows GUI     | Verified; distinct build from frozen release                |
| Existing updater-worktree v0.1.0 release output, ARM64        | AA64, ARM64                 | 2, Windows GUI     | Verified; distinct build from frozen release                |
| Debug E2E 0.2.1 desktop payloads, x64 and ARM64               | Correct respective machines | 3, Windows Console | Previously verified; expected debug-only console            |
| Final production v0.2.0 desktop payloads, either architecture | Not available               | Not inspected      | Must inspect final candidates after separate build approval |

The frozen installers were read using the existing 7-Zip utility into fresh ignored
inspection copies only; they were not executed or changed. Source installer hashes
matched the approved values before/after. Inspection evidence:
`dist/test/x64-validation-release-pe-e5dd16f8f5cf4b10b9cee16690207168`.
Extracted frozen desktop hashes are:

- x64: `B89B17593151817A635A17EE50E0E93C6A798F16253EFE7EFCF2BDAB34A1886E`
- ARM64: `8BC1231972AF5D13971B31BACF8FD1CF461117B23877DB1D0260928C4BDB8776`

This is static artifact inspection, not new ARM64 runtime/E2E testing. The NSIS
stub's own subsystem/architecture is not a substitute for checking its bundled
desktop executable. Future release acceptance must inspect the actual final
v0.2.0 desktop payloads separately; a debug-test pass does not establish that.

## Cleanup plan: no cleanup authorized or performed

Keep evidence and the working app until the remaining checks/recovery decision
are approved. Do not use wildcard deletion, uninstall for cleanup, or kill a
process based only on a port number. Do not assume a path containing TEST is safe.

| Resource and exact path/pattern                                                                                                   | Ownership and proposed handling                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| x64 foreground HTTPS server for the fixed endpoint                                                                                | User-reported remote server; PID not independently known. After approval, use Ctrl+C in its own verified server terminal. Do not terminate unrelated Node processes.                                                                                                                             |
| x64 `%LOCALAPPDATA%\SlateUpdaterX64TestV2`                                                                                        | Transferred disposable kit, plus locally generated `dist\test\updater-e2e-x64\package\manifest.json` and `a1-verification.json`. Preserve those as evidence first. Remote current contents/link status unverified; remove only after approval and a fresh ordinary-path/ownership/process audit. |
| x64 `%LOCALAPPDATA%\SlateUpdaterX64Test`                                                                                          | Earlier failed kit; current existence/content unverified. Same audit/approval requirement; never merge it with V2.                                                                                                                                                                               |
| TLS files under each kit's `dist\test\updater-e2e-transport\localhost`                                                            | Disposable test CA certificate, leaf certificate, and TLS leaf private key. No updater private key or CA private key is in the kit. Retain until no approved tests need them; expire 2026-10-23 03:33:17 UTC. No trust-store removal is expected because no CA installation was required.        |
| x64 `<actual install directory>`, normally `%LOCALAPPDATA%\AI Clip Memory`                                                        | **Shared Slate installation, not safely disposable.** Preserve. Recovery/replacement requires separately approved installation; do not uninstall or recursively delete.                                                                                                                          |
| x64 `%APPDATA%\com.aiclipmemory.desktop`, existing WebView profile directories, SQLite WAL/SHM, settings                          | **Potential production/shared user data.** Actual physical paths not verified. Preserve; no deletion, move, reset, restore, or migration commands.                                                                                                                                               |
| x64 `<token-derived profile>\.slate-coordination\com.aiclipmemory.desktop\maintenance-v2.lock`                                    | Shared authoritative barrier, not x64-kit-owned. Never delete/replace to clear a lock; kernel releases locks when owners exit. Preserve.                                                                                                                                                         |
| x64 HKCU Chrome/Edge `NativeMessagingHosts\com.aiclipmemory.bridge`, HKCU Run `AI Clip Memory`, Slate shortcuts/uninstall entries | Shared current-user registrations. Not isolated test resources; preserve. No registry cleanup commands are approved.                                                                                                                                                                             |
| x64 `<process temp>\Slate-update-<UUID>\Slate-0.2.1-update.exe`                                                                   | Updater-staged installer pattern from `handoff.rs`; exact remote UUID/path/active handles unknown. Retain until process ownership, matching hash, inactive use and recovery needs are independently checked. Never delete all `Slate-update-*`.                                                  |
| x64 NSIS `$PLUGINSDIR` / temporary installer files                                                                                | Exact paths unknown; may already be automatically removed by NSIS. Do not delete generic `%TEMP%\ns*` or other applications' files.                                                                                                                                                              |
| Maintainer `dist/test/updater-e2e-x64/run-OUQnvR`                                                                                 | Original stages, extracted payloads, rendered templates, installers and provenance inventory. Important evidence; preserve now.                                                                                                                                                                  |
| Maintainer `dist/test/updater-e2e-x64/transfer-kit-20261016` and `transfer-kit-20261016-portable-v2`                              | Original/corrected kits; both preserved. Future disposal only after evidence retention, ordinary-path audit and explicit approval.                                                                                                                                                               |
| Other maintainer `dist/test/updater-e2e-x64/run-*`                                                                                | Preparation-only source copies, not necessarily the installed test. Enumerate individually before any cleanup; don't delete the parent or match all runs.                                                                                                                                        |
| Maintainer `dist/test/updater-e2e-transport/run-15139d5cb4f34d118222db734f1e8c0e`                                                 | Shared ARM64/x64 frontend/TLS test source; not x64-exclusive. Preserve.                                                                                                                                                                                                                          |
| External `C:\SlateSigning-Test` and ignored disposable-signing verification directory                                             | Shared disposable signing identity/evidence, not kit cleanup. No private-key access or destruction in this milestone; separate approval required.                                                                                                                                                |
| Frozen releases, primary main, extension archive, storage diagnostic worktree, installed ARM64 Slate                              | Protected; excluded from every cleanup action.                                                                                                                                                                                                                                                   |

Safe future inspection on the x64 PC (read-only; not run here):

```powershell
Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 17443 -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'Slate-update-*' |
    Select-Object FullName, LastWriteTime
```

Those commands identify candidates only. They do not establish safe deletion.
No destructive cleanup commands are supplied because remote ownership, physical
paths, running handles, and overlap with real Slate have not been verified.

Existing cleanup tooling is **not** an approved x64-app cleanup path:

- `scripts/windows/Unregister-NativeMessagingHost.ps1` removes selected HKCU host
  registrations without first proving they belong exclusively to this test. Do
  not run it: these registrations may support the user's normal Slate library.
- `docs/DISPOSABLE_TEST_SIGNING.md` has a separately approved allowlisted disposal
  procedure for its specific ignored synthetic directory. It is not a general
  installer cleanup command and does not remove the external `C:\SlateSigning-Test`
  private key. Do not repurpose it or execute it here.
- Test-suite teardown removes only its own newly created disposable fixtures;
  that is not authorization to remove existing E2E evidence, profiles, or caches.
- The new `dist/test/x64-validation-release-pe-e5dd16f8f5cf4b10b9cee16690207168`
  directory contains only this review's extracted public desktop binaries. It is
  eligible for later separately approved disposal after retaining the hashes;
  its frozen source installers must remain untouched. No general updater-install
  cleanup script was found.

## Remaining checks and release blockers

1. The selected Rust integration gate is now restored: 218/218 twice, including a
   run after cargo check. Preserve the historical artifact-error record; investigate
   if it recurs. The final complete production verification gate is still required
   after future approved release changes.
2. Optional metadata-only confirmation of the x64 installed executable/hash above;
   preserve local manifest/A1 evidence and test logs. Full library/settings
   preservation has not been independently established.
3. Complete a short x64 browser capture/live-refresh and full tray-quit/reopen
   retention check if not already performed. Manual x64 unsaved-editor/capture
   blocking and injected failure/recovery scenarios remain unreported; existing
   automated tests cover those boundaries, not an actual interrupted x64 install.
4. Historical ARM64 TEST E2E was previously user-reported and accepted. It was not
   repeated or extended here. Future production candidate validation on both
   architectures needs separate approval after release configuration is settled.
5. Production signing custody/backups/public key, stable manifest distribution,
   consistent production 0.2.0 versioning, and enabling production installation
   remain separate approved steps. Current source is version 0.1.0, has no
   configured production updater endpoint/key, and keeps installation disabled.
   Test success does not authorize promoting disposable identities or endpoints.
6. v0.1.0 users need a manual upgrade to the first updater-enabled release. NSIS
   updates do not promise transactional rollback; no automatic downgrade or data
   restoration was tested or authorized.
7. The test machines now have test 0.2.1, which is newer than planned production
   0.2.0. The updater rejects older versions, and the NSIS template rejects
   unattended downgrades/disables in-place interactive downgrade. Returning these
   accounts to production needs a separately approved, data-preserving transition
   or versioning decision. Do not uninstall or bypass downgrade protection as
   cleanup. This test-machine issue does not block the normal v0.1.0-to-v0.2.0
   upgrade direction.

Recommended next milestone: collect the short x64 post-update capture/reopen
evidence without another updater installation. Then seek explicit approval for production
signing/configuration and release-candidate preparation; do not repeat the working
E2E installation or start another architecture test unnecessarily.

Only this validation document was edited during the follow-up investigation.
Development build caches and fresh ignored archive-inspection copies were
generated; no production release was built. No installation, signing, production
configuration change, production-data access, manual cleanup, commit or push was
performed. Frozen installer/extension/checksum files and the extension archive
were hash-checked and preserved.
