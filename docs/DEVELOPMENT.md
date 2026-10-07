# Slate Developer Guide

## Repository structure

- `apps/desktop` — Tauri 2, React, TypeScript, Vite, Tailwind CSS, shadcn/ui,
  Rust, and SQLite desktop application
- `apps/extension` — Chromium Manifest V3 browser extension
- `packages/shared` — source-exported TypeScript contracts shared by the apps
- `scripts/windows` — Windows development registration and release packaging
- `docs` — current development/release guidance and labelled historical designs

## Prerequisites

- Node.js 22.13 or newer in the 22.x line, or Node.js 24+
- Corepack with pnpm 11.19.0
- Rust stable MSVC toolchain
- Windows Tauri prerequisites: Microsoft C++ Build Tools and WebView2

Install and verify:

```powershell
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @slate/site format:check ../.. `
  --ignore-path ../../.gitignore `
  --ignore-path ../../.prettierignore `
  --ignore-path .prettierignore
pnpm format:rust:check
pnpm lint
pnpm --filter @slate/site build
pnpm test
pnpm typecheck
pnpm build:extension
pnpm build:desktop
pnpm build:bridge
pnpm check:rust
```

Build the site before `pnpm test`: its output tests read generated
`apps/site/dist` files, which are ignored by Git and absent from a fresh clone.
The other build commands above validate the desktop frontend, extension, and
native host; they do not publish anything.

`--ignore-scripts` skips dependency install hooks, not the explicit build/test
commands. The pinned packages include the prebuilt binaries used by the verified
Windows setup. This avoids pnpm adding dependency-script approval settings.
The full-repository formatting command runs from the site's package so its Astro
plugin resolves under pnpm's isolated dependencies. It combines the existing root
and site ignore files to exclude generated output; Rust formatting is checked
separately. The root `pnpm format:check` shortcut currently cannot resolve that
site-only plugin from the root directory.

Run the desktop app:

```powershell
pnpm dev:desktop
```

## Unpacked extension and development Native Messaging

Unpacked installation is for development and testing only. Once published,
public V1 users should install the Chrome Web Store package.

Development registration uses the same `com.aiclipmemory.bridge` host name and
Chrome/Edge HKCU keys as the installed app, so it replaces the installed host
registration for the chosen browsers. Prefer an isolated Windows testing profile.
If testing in your normal profile, plan to restore the installed production host
registration afterward by reinstalling Slate or explicitly registering that host.

1. Build both components:

   ```powershell
   pnpm build:extension
   pnpm build:bridge
   ```

2. Load `apps/extension/dist` as unpacked in `chrome://extensions` or
   `edge://extensions`, then copy its exact 32-character ID.

3. Register the development host for that exact ID:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/Register-NativeMessagingHost.ps1 `
     -Browser Chrome `
     -ExtensionId <extension-id> `
     -HostPath "$(Resolve-Path apps/desktop/src-tauri/target/debug/ai-clip-memory-native-host.exe)"
   ```

   Use `-Browser Edge` for Edge. Use `-Browser Both` with all exact unpacked IDs
   when both browsers should share the development manifest.

4. Unregister the current host only when you intend to remove that registration:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/Unregister-NativeMessagingHost.ps1 -Browser Both
   ```

   This script removes the current registration keys; it does not check whether
   they still point to the development manifest. It can therefore remove an
   installed production registration too. Restore production registration before
   returning to normal browser capture.

Normal users receive the Native Messaging registration from the desktop
installer.

## Windows installers and release staging

Build compatibility-named NSIS installers:

```powershell
pnpm package:windows:x64
pnpm package:windows:arm64
```

The relevant Rust target and Visual Studio C++ target tools must already be
installed. The build script does not install machine-level tools.

Build and validate a clean Chrome Web Store ZIP:

```powershell
pnpm release:extension
```

The source/unpacked manifest retains its key and development Chrome ID
`jjfaegknedfakmidhhdlmbebnjafcjfi`; the Chrome Web Store upload ZIP omits
the key. The Chrome Web Store draft has the distinct production ID
`hgbfaclkpmcecikjepoejgjccddjbekh`. Windows installer manifest generation
allows both Chrome origins and the configured Edge origin
`jcfcmapapjlgpbkcgcaeggeblgpidkoo`.

Windows/root release version is `0.1.0`; the extension release version is
independently read from `apps/extension/public/manifest.json`, currently `0.1.1`.
Its upload artifact is `Slate-Extension-0.1.1.zip`.

After both NSIS packages exist, copy them to friendly public filenames and
regenerate `SHA256SUMS.txt`:

```powershell
pnpm release:stage:windows
```

Generated release files are written under `dist/release/v0.1.0/`, which is
ignored by Git. The original Tauri installer files are retained. See
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before distributing anything.
