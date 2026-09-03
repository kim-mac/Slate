# Milestone 5 Native Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver validated browser captures to the existing local `ClipService` through a one-shot Chromium Native Messaging host.

**Architecture:** The extension wraps its existing `BrowserCapturePayload` in a narrow versioned request and uses `sendNativeMessage`. A dedicated Rust binary performs bounded length-prefixed I/O, validates the untrusted request, resolves the same application-data database path as Tauri, persists through `ClipService`, and returns only a UUID or safe error code. Windows-only manifest and HKCU registration stay in isolated PowerShell scripts.

**Tech Stack:** TypeScript 6, Chromium Manifest V3, Vitest 4, Rust 2021, serde/serde_json, url, rusqlite, Tauri 2, PowerShell, pnpm.

---

### Task 1: Add and test the shared extension bridge contract

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/extension/src/bridge.test.ts`
- Create: `apps/extension/src/bridge.ts`

- [ ] Write failing tests for the exact request envelope, native host name, success response, declared safe failure, malformed response, and Chrome runtime failure.
- [ ] Run `pnpm --filter @ai-clip-memory/extension test -- src/bridge.test.ts` and confirm failure because the bridge module is absent.
- [ ] Add the version, host-name, request, response, and safe-error TypeScript types to the shared source export.
- [ ] Implement `sendCaptureToDesktop(payload, runtime)` with an injected narrow runtime API and no logging or persistence.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Wire the existing capture to the bridge

**Files:**
- Modify: `apps/extension/src/background.test.ts`
- Modify: `apps/extension/src/background.ts`

- [ ] Add failing tests proving matching valid captures are sent exactly once, invalid captures are not sent, success/failure is handled without throwing, and console/storage are unused.
- [ ] Run the focused background tests and confirm the new assertions fail.
- [ ] Make the context-menu handler call the typed bridge client only when existing capture validation returns a payload.
- [ ] Keep `CAPTURE_CONTEXT_MENU.title` unchanged and do not retain the payload or response.
- [ ] Re-run extension tests and confirm they pass.

### Task 3: Lock the exact permission change

**Files:**
- Modify: `apps/extension/src/manifest.test.ts`
- Modify: `apps/extension/public/manifest.json`

- [ ] Change the manifest test first to require exactly `activeTab`, `contextMenus`, and `nativeMessaging`, while retaining every forbidden-permission assertion.
- [ ] Run the manifest test and confirm it fails because `nativeMessaging` is absent.
- [ ] Add only `nativeMessaging` to the production manifest.
- [ ] Re-run the manifest test and inspect the built manifest.

### Task 4: Prove and centralize database-path compatibility

**Files:**
- Create: `apps/desktop/src-tauri/src/app_paths.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`

- [ ] Add a failing unit test specifying `<data_dir>/com.aiclipmemory.desktop/clips.sqlite3` and a test proving the former GUI app-data input resolves to the identical file.
- [ ] Run the focused Rust test and confirm failure because the helper is absent.
- [ ] Implement constants and a pure `clip_database_path(data_dir)` helper.
- [ ] Change Tauri setup from `app_data_dir()` to the equivalent `data_dir()` plus the shared helper.
- [ ] Add `dirs` as a direct dependency for the native binary's platform-neutral base data directory lookup.
- [ ] Re-run the focused and existing persistence tests.

### Task 5: Implement protocol validation test-first

**Files:**
- Create: `apps/desktop/src-tauri/src/bridge/mod.rs`
- Create: `apps/desktop/src-tauri/src/bridge/protocol.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] Add failing Rust unit tests for exact request/response serialization and safe errors for malformed JSON, unsupported version/type, missing or extra fields, blank content, wrong content type, invalid source app, and invalid/non-HTTP(S) URL.
- [ ] Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml bridge::protocol` and confirm failures for missing implementation.
- [ ] Implement strict serde envelope decoding, ordered validation, exact-content preservation, and mapping to `CreateClip`.
- [ ] Re-run the protocol tests and confirm they pass.

### Task 6: Implement bounded native framing and persistence test-first

**Files:**
- Create: `apps/desktop/src-tauri/src/bridge/native_host.rs`
- Create: `apps/desktop/src-tauri/tests/native_messaging_bridge.rs`

- [ ] Add failing tests for native-byte-order framing, truncated prefix/body, invalid UTF-8, malformed JSON, a 1 MiB boundary, an oversized declared length with a reader that proves no body allocation/read occurs, safe storage failure, exact content preservation, and persistence into a real temporary SQLite file.
- [ ] Run the focused integration tests and confirm failure because the host runner is absent.
- [ ] Implement `run_once(reader, writer, service)` so it emits one framed response and never logs.
- [ ] Keep response serialization bounded and map every internal persistence failure to `storage_unavailable`.
- [ ] Re-run focused and full Rust tests.

### Task 7: Add the stdout-clean native-host executable

**Files:**
- Create: `apps/desktop/src-tauri/src/bin/ai-clip-memory-native-host.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`

- [ ] Add an integration/build assertion that the binary target exists and protocol output is produced only through the framed writer.
- [ ] Add the second binary target and set the desktop GUI as Cargo's default run target.
- [ ] Resolve the platform data directory, create its application directory, open the existing database through `ClipService`, and call the one-shot runner.
- [ ] On startup failures, return a framed `storage_unavailable` response when framing is available; never print to stdout or include sensitive stderr details.
- [ ] Add narrow `build:bridge` scripts and build the executable.

### Task 8: Add isolated per-user Windows registration

**Files:**
- Create: `scripts/windows/Register-NativeMessagingHost.ps1`
- Create: `scripts/windows/Unregister-NativeMessagingHost.ps1`

- [ ] Implement parameter validation for the absolute existing executable path, exact extension IDs, and Chrome/Edge/Both selection.
- [ ] Generate the native-host JSON under per-user local application data with exact `allowed_origins` and no wildcard.
- [ ] Create only the host-specific HKCU Chrome and/or Edge keys.
- [ ] Implement symmetric removal of only those keys and the generated manifest.
- [ ] Exercise registration in a disposable HKCU test setup where practical and inspect the generated manifest before real browser verification.

### Task 9: Document setup and verify all boundaries

**Files:**
- Modify: `README.md`

- [ ] Document bridge build, unpacked-extension ID discovery, per-user registration, manual capture verification, and unregistration.
- [ ] Run extension tests, Rust tests, full workspace tests, formatting, lint, typecheck, extension build, desktop build, Cargo check, bridge build, Tauri build, and `git diff --check`.
- [ ] Inspect the final manifest and scan bridge sources for stdout logging, payload logging, storage, network, schema, command, capability, and UI changes.
- [ ] Build and register the native host for the real unpacked extension, save a distinctive selected-text clip, verify it in the existing SQLite database and desktop UI, then remove the clip and unregister the development host.
- [ ] Confirm the working diff contains only Milestone 5 files and stop before Milestone 6.

