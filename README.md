# AI Clip Memory

AI Clip Memory is a local-first desktop application and browser extension for saving and reusing useful pieces of AI conversations.

This repository currently contains only the Milestone 0 foundation. It does not include clip storage, browser capture, accounts, cloud services, telemetry, or networking.

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
pnpm typecheck
pnpm build:extension
pnpm build:desktop
pnpm check:rust
pnpm dev:desktop
```

All application data and future clip content must remain local by default. No account or cloud connection is required for the MVP.
