# Slate Developer Guide

## Repository structure

- `apps/desktop` — Tauri 2, React, TypeScript, Vite, Tailwind CSS, shadcn/ui,
  Rust, and SQLite desktop application
- `apps/extension` — Chromium Manifest V3 browser extension
- `packages/shared` — source-exported TypeScript contracts shared by the apps
- `scripts/windows` — Windows development registration and release packaging
- `docs` — product source-of-truth and release documentation

## Prerequisites

- Node.js 22.13 or newer in the 22.x line, or Node.js 24+
- Corepack with pnpm 11.19.0
- Rust stable MSVC toolchain
- Windows Tauri prerequisites: Microsoft C++ Build Tools and WebView2

Install and verify:

```powershell
corepack enable
pnpm install
pnpm format:check
pnpm lint
pnpm test
pnpm typecheck
pnpm build:extension
pnpm build:desktop
pnpm build:bridge
pnpm check:rust
```

Run the desktop app:

```powershell
pnpm dev:desktop
```

## Unpacked extension and development Native Messaging

Unpacked installation is for development and testing only. Public V1 users
should install the Chrome Web Store package.

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

4. Remove only the development registration when finished:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/Unregister-NativeMessagingHost.ps1 -Browser Both
   ```

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

After both NSIS packages exist, copy them to friendly public filenames and
regenerate `SHA256SUMS.txt`:

```powershell
pnpm release:stage:windows
```

Generated release files are written under `dist/release/v0.1.0/`, which is
ignored by Git. The original Tauri installer files are retained. See
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before distributing anything.
