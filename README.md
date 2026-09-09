# AI Clip Memory

AI Clip Memory is a local-first Windows desktop application and Chromium
extension for saving and reusing useful pieces of AI conversations. The MVP
includes the desktop clip library, local SQLite persistence, browser capture,
Native Messaging, retrieval shortcuts, a quick-search launcher, and floating
Save controls on supported AI sites.

There is no account, cloud service, telemetry, analytics, or remote application
backend. Clip content is stored locally on the user's computer.

## Repository structure

- `apps/desktop` — Tauri 2, React, TypeScript, Vite, Tailwind CSS, shadcn/ui,
  Rust, and SQLite desktop application
- `apps/extension` — Chromium Manifest V3 browser extension
- `packages/shared` — source-exported TypeScript contracts shared by the apps
- `scripts/windows` — Windows development registration and release packaging
- `docs` — product source-of-truth and release documentation

## Install on Windows

Choose the installer matching the computer:

- `x64-setup.exe` for ordinary Intel or AMD 64-bit Windows computers
- `arm64-setup.exe` for Windows on ARM computers

The NSIS installer runs for the current user and normally does not require
administrator privileges. It installs the desktop application, the local Native
Messaging host, and the exact Chrome and Edge registrations needed by the
matching extension build. Users do not need Node.js, pnpm, Rust, Cargo, Visual
Studio Build Tools, or a source checkout.

The browser extension is installed separately. Production extension builds carry
a public manifest key so unpacked Chrome installs keep the deterministic ID
`jjfaegknedfakmidhhdlmbebnjafcjfi`, regardless of the directory from which they
are loaded. Windows packages derive that Chrome ID from the same manifest key and
also allow the intended Edge release ID configured in
`apps/extension/release-identity.json`. Public Chrome Web Store and Edge Add-ons
packages are a later release phase.

The installer uses Microsoft's WebView2 download bootstrapper when WebView2 is
missing. Installation may therefore require internet access on a machine that
does not already have WebView2. Once installed, saving and retrieving clips does
not require an internet connection.

These Phase 1 builds are unsigned. Windows SmartScreen may identify the publisher
as unknown or show a reputation warning. Do not disable SmartScreen globally;
verify that the installer came from the expected project release before choosing
to run a private test build.

## Use the MVP

- Highlight text and choose **Save to AI Clip Memory** from the browser context
  menu on an HTTP/HTTPS page.
- On ChatGPT, Claude, and Gemini, highlighting non-editable page text also shows
  the floating **Save** control.
- Press **Refresh** in the desktop library after a browser capture. Browser
  captures are local, but the library does not poll for changes.
- Press **Ctrl+Shift+Space** for quick search while the desktop application is
  running. The shortcut is released when the application exits; there is no tray
  process, autostart, or background service.

## Local data and uninstall behavior

The SQLite database is stored at:

```text
%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3
```

The database is currently plaintext. Ordinary uninstall leaves this application
data in place so clips survive reinstall or upgrade. Tauri's interactive
uninstaller may offer an explicit **Delete app data** option; selecting it
deliberately removes the application-data directory. See [PRIVACY.md](PRIVACY.md)
before removing retained data manually.

Uninstall removes the installed Native Messaging host, its owned manifest, and
only the Chrome/Edge registration values that still point to that installation.
It does not remove the browser extension or unrelated browser state.

## Developer setup

Requirements:

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

### Unpacked extension and development Native Messaging

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

These scripts remain development tools. Normal users receive registration from
the installer.

## Build private Windows installers

The packaging script derives the stable Chrome origin from the extension
manifest key and reads the intended Edge origin from the extension release
identity configuration. It rejects malformed configuration before Tauri runs;
extension IDs cannot be overridden at the command line.

```powershell
pnpm run package:windows:x64
pnpm run package:windows:arm64
```

The relevant Rust target and Visual Studio C++ target tools must already be
installed. The build script never installs machine-level tools silently. Output
is written under the target-specific `apps/desktop/src-tauri/target/<triple>/`
NSIS bundle directory and is clearly labelled `x64` or `arm64`.

See [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) before distributing an
installer.
