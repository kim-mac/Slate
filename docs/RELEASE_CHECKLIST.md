# MVP Release Checklist

This checklist separates private Phase 1 package validation from the later gates
required for public distribution. Completing it does not authorize post-MVP
product work.

## Phase 1 verification record — 2026-09-05

Local ARM64 installer verification passed using the exact unpacked-extension IDs
`adbglhgegppmfcndhonckgfjehkadaca` for Chrome and
`jcfcmapapjlgpbkcgcaeggeblgpidkoo` for Edge. The generated and installed Native
Messaging manifest contained exactly those two origins. Current-user install,
same-version reinstall, default uninstall with **Delete app data** left unchecked,
and reinstall after uninstall all completed without elevation. No SmartScreen
warning appeared on the verification machine.

Chrome and Edge floating Save and context-menu capture reached the existing local
SQLite database. Desktop Refresh, CRUD, pin/unpin, copy, launcher search/copy,
Escape, browser restart, and desktop restart passed. Uninstall removed the owned
application files, shared manifest, and both owned HKCU registrations while
preserving unrelated Native Messaging registrations and
`%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3`. Reinstall restored access to
the retained `PHASE1_PRESERVATION_TEST_2026` clip and browser integration.

The x64 desktop release and NSIS installer were successfully packaged for
`x86_64-pc-windows-msvc`. This records packaging only: x64 installation, runtime,
Native Messaging, launcher, restart, and uninstall behavior have not yet been
verified. Neither architecture has completed the clean-machine gates below.

The Phase 1 IDs above were path-derived unpacked-extension IDs. Current dogfood
builds instead use the public key in the production extension manifest to keep
Chrome ID `jjfaegknedfakmidhhdlmbebnjafcjfi` deterministic across build and load
directories. Installer packaging derives that origin from the same key and keeps
the intended Edge release ID in `apps/extension/release-identity.json`.

## Version and source state

- [ ] Root, desktop, extension, shared package, Cargo, Tauri, and extension
      manifest versions match the intended release.
- [ ] Release commit is identified and the worktree is clean.
- [ ] Formatting, lint, TypeScript, Rust, frontend, extension, native-host, and
      Tauri checks pass.
- [ ] No SQLite schema, command capability, Native Messaging protocol, extension
      permission, or content-script match changed unintentionally.

## Extension release gates

- [ ] Chrome Web Store listing has a stable extension ID.
- [ ] Edge Add-ons listing has a stable extension ID.
- [ ] Icons satisfy both stores' required sizes and formats.
- [ ] Listing screenshots and descriptions accurately represent the MVP.
- [ ] Store privacy disclosures match `PRIVACY.md` and actual permissions.
- [ ] Store packages contain no source maps, test files, debug buffers, remote
      code, or development-only files.
- [ ] Context-menu and floating-Save flows pass store-package verification.

## Windows package generation

- [x] Build script derives the Chrome ID from the packaged manifest key and reads
      the intended Edge ID from release configuration.
- [x] Generated `allowed_origins` contains both exact origins and no wildcard,
      placeholder, or development ID intended only for another package.
- [x] x64 installer is built for `x86_64-pc-windows-msvc`.
- [x] ARM64 installer is built for `aarch64-pc-windows-msvc`.
- [x] Installer filenames clearly distinguish x64 and ARM64.
- [x] Each installer contains `ai-clip-memory-desktop.exe`,
      `ai-clip-memory-native-host.exe`, and `com.aiclipmemory.bridge.json`.
- [x] Native-host PE architecture matches its installer architecture.
- [x] Manifest relative path launches the installed host from a path containing
      spaces.
- [x] WebView2 `downloadBootstrapper` behavior is documented and verified on the
      ARM64 verification machine.

## Signing gate for public distribution

- [ ] Windows code-signing identity and certificate custody are approved.
- [ ] Desktop executable, native-host executable, uninstaller, and final NSIS
      installer are signed as applicable.
- [ ] Signatures use SHA-256 and an approved timestamp service.
- [ ] Signature verification passes on x64 and ARM64 artifacts.
- [ ] SmartScreen behavior is tested after signing.

Unsigned packages may be used only for clearly labelled private testing. Do not
tell users to disable SmartScreen.

## Clean-machine x64 verification

- [ ] Test account/machine has no Node.js, pnpm, Rust, Cargo, source checkout, or
      Visual Studio Build Tools.
- [ ] Current-user installation succeeds without elevation.
- [ ] Desktop launches and CRUD, pin, copy, search, Refresh, and source opening
      work.
- [ ] Ctrl+Shift+Space launcher opens while the app is running.
- [ ] Chrome Native Messaging capture persists locally.
- [ ] Edge Native Messaging capture persists locally.
- [ ] Floating Save works on supported sites.
- [ ] Context-menu capture works as fallback.
- [ ] Browser restart and desktop restart preserve functionality.

## Clean-machine ARM64 verification

- [ ] Test account/machine has no developer toolchain or source checkout.
- [ ] Current-user installation succeeds without elevation.
- [ ] Desktop, launcher, Chrome/Edge Native Messaging, floating Save, context menu,
      restart, and persistence checks match the x64 results.
- [ ] Windows scaling and monitor placement remain usable where available.

## Install, upgrade, and uninstall lifecycle

- [x] Install path under `%LOCALAPPDATA%` contains only expected owned files on the
      ARM64 verification machine.
- [x] Chrome and Edge HKCU keys point to the same owned host manifest.
- [x] Same-version reinstall preserves clips and refreshes installed files.
- [ ] Upgrade from the prior release preserves clips and replaces host/manifest.
- [ ] Downgrade is rejected.
- [x] Default uninstall retains
      `%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3`.
- [ ] Explicit **Delete app data** behavior is separately verified and documented.
- [x] Uninstall removes the owned Chrome and Edge host keys when they still point
      to this installation.
- [ ] Uninstall leaves a host key untouched if its value was changed to another
      manifest after installation.
- [x] Uninstall removes the owned host manifest and executable.
- [x] Unrelated registry keys, browser extensions, profiles, and settings remain
      untouched.
- [x] Reinstall after default uninstall reopens the retained clips.
- [x] A path containing spaces works.
- [ ] A non-ASCII Windows user/profile path works where practical.

## Data and privacy

- [ ] Capture and retrieval work with the internet disconnected after required
      pages are locally available.
- [ ] No capture content leaves the computer through Slate.
- [ ] No clip content or full payload appears in stdout, stderr, logs, installer
      output, or error messages.
- [ ] Local plaintext storage limitation is visible to users.
- [ ] Clipboard and Open Source behavior is accurately disclosed.
- [ ] Default uninstall retention and deliberate deletion steps are accurate.

## Artifact record

- [ ] Record commit SHA, version, build date, Rust target, Node/pnpm versions, and
      Tauri version.
- [ ] Record SHA-256 checksums for extension packages and both installers.
- [ ] Record clean-machine test results and known limitations.
- [ ] Publish only artifacts that use production store IDs and completed signing
      gates.

## Later automation

A future release workflow should build x64 and ARM64 in separate Windows jobs,
run the same tests, inject stable store IDs, sign artifacts, verify signatures,
and publish checksums. Phase 1 deliberately does not add CI, signing, store
publication, or automatic updates.
