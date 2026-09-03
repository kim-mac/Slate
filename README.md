# AI Clip Memory

AI Clip Memory is a local-first desktop application and browser extension for saving and reusing useful pieces of AI conversations.

This repository contains the Milestone 0 foundation, Milestone 1 desktop shell, Milestone 2 local SQLite data layer, Milestone 3 desktop clip library, Milestone 4 browser selection capture, and the Milestone 5 local Chromium Native Messaging bridge. It does not include accounts, cloud services, telemetry, or remote networking.

## Repository structure

- `apps/desktop` — minimal Tauri 2, React, TypeScript, and Vite desktop shell
- `apps/extension` — minimal Chromium Manifest V3 extension shell
- `packages/shared` — source-exported TypeScript shared by workspace applications
- `docs` — project source-of-truth documentation

## Requirements

- Node.js 22.13 or newer in the 22.x line, or Node.js 24+
- pnpm 11.19.0
- Rust stable MSVC toolchain
- Windows Tauri prerequisites: Microsoft C++ Build Tools and WebView2

## Commands

```powershell
pnpm install
pnpm format:check
pnpm lint
pnpm test
pnpm test:rust
pnpm typecheck
pnpm build:extension
pnpm build:desktop
pnpm build:bridge
pnpm check:rust
pnpm dev:desktop
```

All application data and future clip content must remain local by default. No account or cloud connection is required for the MVP.

## Native Messaging development setup on Windows

The Native Messaging host is a short-lived local process. Chrome or Edge launches it for one capture, it validates one request, persists through the existing `ClipService`, returns a minimal response, and exits. It does not open a port and the desktop GUI does not need to be running.

1. Build the extension and native host:

   ```powershell
   pnpm build:extension
   pnpm build:bridge
   ```

2. Load `apps/extension/dist` as an unpacked extension and copy its 32-character ID from `chrome://extensions` or `edge://extensions`.

3. Register the development host for the browser and exact extension ID:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/Register-NativeMessagingHost.ps1 `
     -Browser Chrome `
     -ExtensionId <extension-id> `
     -HostPath "$(Resolve-Path apps/desktop/src-tauri/target/debug/ai-clip-memory-native-host.exe)"
   ```

   Use `-Browser Edge` for Edge or `-Browser Both` to register both per-user HKCU locations. Multiple exact IDs can be supplied as a comma-separated PowerShell array. Registration does not require administrator privileges.

4. Reload the unpacked extension after rebuilding it. Select text on an HTTP/HTTPS page and choose `Save to AI Clip Memory`. Opening or restarting the desktop app will show the clip stored in the existing local database.

5. Remove the development registration when finished:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/Unregister-NativeMessagingHost.ps1 -Browser Both
   ```
