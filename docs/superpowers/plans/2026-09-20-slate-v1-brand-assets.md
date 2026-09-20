# Slate V1 Brand Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every active old bookmark product asset with the approved monochrome Slate Angular Fold S while preserving all compatibility-sensitive identities and behavior.

**Architecture:** Keep the approved 1024px raster geometry and metadata under `assets/brand/`, normalize its S and background interiors to opaque white and black, and derive the Chromium and multi-frame Windows assets from that corrected master. Tests inspect real PNG colors and alpha bounds, exact approved hashes, ICO frame coverage, and compatibility identity without adding image-processing dependencies.

**Tech Stack:** PNG/ICO assets, Manifest V3, Vitest/Node built-ins, Rust integration tests, Tauri 2, PowerShell/.NET image tooling.

---

### Task 1: Lock the approved extension assets with failing tests

**Files:**
- Modify: `apps/extension/src/manifest.test.ts`
- Test: `apps/extension/src/manifest.test.ts`

- [ ] Add a PNG decoder using Node `zlib` and verify the 128px icon and notification icon have alpha bounds `16,16..111,111`.
- [ ] Assert SHA-256 fingerprints for the corrected 16, 32, 48, and 128px Chromium assets and the notification asset.
- [ ] Assert representative S, background, and outside pixels use opaque white, opaque black, and transparency in the master, Chromium assets, and Windows ICO frames.
- [ ] Run `pnpm --filter @ai-clip-memory/extension test -- manifest.test.ts` and confirm failures identify the old bookmark files.

### Task 2: Lock the Windows and canonical brand assets with failing tests

**Files:**
- Modify: `apps/desktop/src-tauri/tests/release_packaging.rs`
- Test: `apps/desktop/src-tauri/tests/release_packaging.rs`

- [ ] Add read-only ICO directory parsing and assert the existing frame set remains 16, 24, 32, 48, 64, and 256 pixels at 32bpp.
- [ ] Assert `assets/brand/slate-icon-master-1024.png`, `assets/brand/README.md`, and `assets/brand/brand.json` exist and record that the master is raster-derived.
- [ ] Assert the obsolete bookmark `apps/desktop/src-tauri/icons/app-icon.svg` is absent.
- [ ] Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test release_packaging` and confirm failures identify the missing canonical assets and obsolete SVG.

### Task 3: Install and color-correct the canonical brand source

**Files:**
- Create: `assets/brand/slate-icon-master-1024.png`
- Create: `assets/brand/README.md`
- Create: `assets/brand/brand.json`
- Replace: `apps/extension/public/icons/icon-16.png`
- Replace: `apps/extension/public/icons/icon-32.png`
- Replace: `apps/extension/public/icons/icon-48.png`
- Replace: `apps/extension/public/icons/icon-128.png`
- Replace: `apps/extension/public/icons/notification.png`

- [ ] Preserve the supplied 1024px geometry while converting the enclosed S to opaque `#FFFFFF`, the rounded-square body to opaque `#000000`, and the exterior to transparency.
- [ ] Adapt the supplied README and metadata only to document repository paths and the raster-derived source of truth.
- [ ] Derive `extension/icon-{16,32,48}.png` from the corrected master.
- [ ] Derive the 128px extension and notification assets using a centered 96px artwork area and 16px transparent safe area.
- [ ] Re-run the focused extension tests and confirm they pass without changing the manifest key or declarations.

### Task 4: Rebuild the Windows ICO without fabricating a vector master

**Files:**
- Replace: `apps/desktop/src-tauri/icons/icon.ico`
- Delete: `apps/desktop/src-tauri/icons/app-icon.svg`

- [ ] Use the approved Chromium 16, 32, and 48px rasters directly; derive the Windows-only 24px frame and the 64 and 256px frames directly from the corrected master without upscaling another small icon.
- [ ] Write the six PNG frames into an ICO container with the same existing dimensions and 32bpp directory metadata.
- [ ] Put the approved native 32px frame first because Tauri 2.11 decodes only the first ICO entry for its runtime window/tray image; retain native 16, 24, 48, 64, and 256px frames for Windows resource selection.
- [ ] Lock every embedded frame hash and confirm the 16, 32, and 48px payloads are byte-for-byte the approved Chromium rasters.
- [ ] Delete the obsolete bookmark SVG and do not create a replacement SVG.
- [ ] Re-run the focused Rust release-packaging test and confirm it passes.

### Task 5: Remove the import staging directory and verify active mappings

**Files:**
- Remove after import: `Slate-Brand-Assets-V1/`

- [ ] Verify all permanent and platform assets match their approved source hashes or documented derived frame.
- [ ] Remove only the now-imported untracked staging directory.
- [ ] Confirm Tauri still references `icons/icon.ico` and the extension manifest remains unchanged. The later approved desktop-branding follow-up uses dedicated runtime window/tray PNGs instead of the default icon.
- [ ] Confirm desktop notifications remain on the existing Tauri notification path. Direct `target/debug` and `target/release` executables intentionally lack installed AppUserModelID association, so notification branding must be verified with an installed bundle rather than patched with the Chromium notification asset.

### Task 6: Run complete verification and stale-bookmark audit

**Files:**
- No additional files expected.

- [ ] Run desktop React tests, extension tests, full Rust/integration tests, and focused release-packaging tests.
- [ ] Run workspace typecheck, ESLint, Prettier, Rust formatting, extension production build, desktop frontend build, native-host build/check, Cargo check, and Tauri production no-bundle build.
- [ ] Confirm the built extension contains the new icons, correct dimensions, exact 128px safe area, no old bookmark asset, and deterministic unpacked Chrome ID `jjfaegknedfakmidhhdlmbebnjafcjfi`.
- [ ] Confirm the desktop PE/Tauri build accepts the new ICO without producing a final installer.
- [ ] Run `git diff --check` and audit all remaining `bookmark`, `logo`, and `icon` references by active, historical, generated, or semantic category.

### Task 7: Create the single approved checkpoint

**Files:**
- Stage only the approved visual assets, focused tests, permanent brand metadata, and this implementation plan.

- [ ] Review `git diff --stat`, `git diff --name-status`, and `git status` for unrelated changes.
- [ ] Create one commit: `feat(brand): integrate Slate V1 identity`.
- [ ] Verify the working tree is clean and do not push, merge, tag, publish, rebuild the Store ZIP, or create final installers.

### Approved desktop-branding follow-up

- Keep `productName`, bundle identifier, executable, install directory, AppData, Native Messaging, and autostart identities unchanged.
- In the existing NSIS hooks, reject unrelated shortcut-name collisions before installation; after Tauri's shortcut creation, rename only an owned `AI Clip Memory.lnk` to `Slate.lnk`, preserving its executable target and AUMID. Handle same-version reinstall and remove only an owned `Slate.lnk` after a real uninstall, not during an update.
- Copy the approved Chromium 32 px and 16 px assets byte-for-byte to dedicated runtime window and tray PNGs. Apply them through Tauri's runtime icon APIs without enabling a second tray icon. Keep the multi-frame ICO for executable and shell resources.
- Test shortcut ownership guards, idempotent paths, uninstall ownership, exact icon bytes and dimensions, and one-tray initialization. Repeat all project verification, then amend the single local branding commit. Leave the approved Chromium notification path untouched.
