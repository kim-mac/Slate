# Slate 0.1.0 Release Checklist

This checklist gates the first public Slate release. Completing source changes
does not authorize publishing until the applicable manual gates are recorded.

## Release source and version

- [ ] Root, desktop, extension, shared package, Cargo, Tauri, and extension
      manifest versions are exactly `0.1.0`.
- [ ] Release commit is recorded and the worktree is clean.
- [ ] Full tests, formatting, lint, typecheck, frontend, extension, native-host,
      and Tauri production builds pass.
- [ ] No schema, persistence, Tauri command, Native Messaging protocol,
      extension permission, or content-script match changed unintentionally.
- [ ] MIT license and third-party notices are present and reviewed.

## Browser extension

- [ ] Production extension output is deleted and rebuilt from source.
- [ ] `Slate-Extension-0.1.0.zip` passes package validation.
- [ ] ZIP root contains `manifest.json` directly, not a wrapping directory.
- [ ] ZIP contains the stable manifest key and derives Chrome ID
      `jjfaegknedfakmidhhdlmbebnjafcjfi`.
- [ ] Permissions are exactly `activeTab`, `contextMenus`, `nativeMessaging`,
      and `notifications`.
- [ ] Content-script matches are exactly the four approved ChatGPT, Claude, and
      Gemini HTTPS patterns.
- [ ] ZIP contains the required 16, 32, 48, and 128 pixel icons.
- [ ] ZIP contains no source maps, tests, TypeScript source, debug files, or
      development-only manifests.
- [ ] Chrome Web Store package validation passes.
- [ ] Chrome Web Store listing, privacy fields, screenshots, and descriptions
      match the shipped product.
- [ ] Chrome Web Store publication/listing URL is recorded in release materials.
- [ ] Microsoft Edge installation from the Chrome Web Store is verified.
- [ ] Save selection, Save this page, and floating Save pass using the store
      package in Chrome and Edge.

Edge Add-ons publication is deferred. Unpacked installation is development and
testing only.

## Windows packages

- [ ] Final x64 package is built for `x86_64-pc-windows-msvc`.
- [ ] Final ARM64 package is built for `aarch64-pc-windows-msvc`.
- [ ] Public artifacts are named `Slate-0.1.0-Windows-x64.exe` and
      `Slate-0.1.0-Windows-ARM64.exe`.
- [ ] Each public installer is byte-for-byte identical to its generated
      compatibility-named NSIS installer.
- [ ] Each package includes `ai-clip-memory-desktop.exe`,
      `ai-clip-memory-native-host.exe`, and `com.aiclipmemory.bridge.json`.
- [ ] Native-host architecture matches the installer architecture.
- [ ] The installed host manifest contains only the approved Chrome and Edge
      origins and resolves its relative host path correctly.
- [ ] Current-user installation succeeds without elevation.
- [ ] WebView2 bootstrapper behavior is verified on a machine without WebView2,
      where practical.

## Manual compatibility verification

- [ ] x64 clean-machine verification passes.
- [ ] ARM64 clean-profile verification passes.
- [ ] Real-data upgrade from the current dogfood build preserves clips and
      browser integration.
- [ ] Default uninstall and reinstall retain clips.
- [ ] The explicit **Delete app data** option removes the application database
      only when selected.
- [ ] Browser capture, desktop selected-text capture, Quick Search, Quick
      Capture/Edit/Delete, Calendar, tray, autostart, and restart behavior pass.
- [ ] Offline desktop CRUD, retrieval, launcher, and desktop capture pass.
- [ ] No clip content, full payload, clipboard snapshot, personal URL, or
      database path appears in logs or installer output.

## Unsigned release decision

- [x] Code signing is **not required for the initial V1 direct-download release
      by project decision**.
- [ ] Final x64 and ARM64 binaries are recorded as unsigned.
- [ ] README, SECURITY.md, release notes, GitHub Release, and website clearly
      explain the SmartScreen/unknown-publisher warning.
- [ ] Guidance tells users to verify the official source and SHA-256 checksum and
      does not tell them to disable Windows security features.

## Artifact and publication record

- [ ] `SHA256SUMS.txt` is generated from the final staged artifacts.
- [ ] Final x64 package SHA-256 is recorded.
- [ ] Final ARM64 package SHA-256 is recorded.
- [ ] Final extension ZIP SHA-256 is recorded.
- [ ] Commit SHA, build date, Rust targets, Node/pnpm/Rust/Tauri versions, and
      build machine details are recorded.
- [ ] README download links point to the final artifacts.
- [ ] Release notes are finalized from `docs/RELEASE_NOTES_0.1.0.md`.
- [ ] Annotated `v0.1.0` tag is created from the approved release commit.
- [ ] GitHub Release is created from `v0.1.0` with all artifacts and checksums.
- [ ] Slate website download links point to the same verified artifacts.

## Post-V1 distribution work

- [ ] Evaluate code signing for future direct downloads.
- [ ] Evaluate Microsoft Store packaging and policies as a separate distribution
      project; Store requirements differ from the current NSIS release.
- [ ] Evaluate Edge Add-ons publication.
- [ ] Evaluate automated release builds only after the manual V1 process is
      stable and documented.
