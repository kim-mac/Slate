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

4. Reload the unpacked extension after rebuilding it. Select text on an HTTP/HTTPS page and choose `Save to AI Clip Memory`. Press **Refresh** in the desktop library to see new captures without restarting the app.

5. Remove the development registration when finished:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/windows/Unregister-NativeMessagingHost.ps1 -Browser Both
   ```

## Desktop retrieval (Milestone 6)

- All Clips opens by default. All Clips and Pinned are ordered newest-first,
  with ID as a deterministic tie-breaker; sidebar counts ignore search/filters.
- The sidebar starts expanded and collapses to icons using its header toggle,
  edge rail, or Ctrl/Cmd+B outside editable fields/dialogs. Icon tooltips retain
  navigation labels and counts. Search or Ctrl/Cmd+F expands and focuses search.
  Sidebar state is session-only; it is not written to cookies or local storage.
- Search is local, literal, and case-insensitive. Each whitespace-separated
  term must occur in content, title, source app, URL, page title, or content type.
  Existing complete substring matches are preserved. The type filter combines
  with search and Pinned; Clear filters resets search and type, not navigation.
- Untitled rows display the page title, then the first nonblank content line,
  then “Untitled clip.” These are display fallbacks, not stored title changes.
- Ctrl/Cmd+F focuses search. Arrow Down from search focuses the selected result;
  Up/Down and Home/End navigate focused results. Ctrl/Cmd+Shift+C copies the
  selected clip when focus is in the library, outside editable fields/dialogs
  and without a text selection. These are app shortcuts, not global shortcuts.
- Refresh uses the existing local list command. Selection and filters survive
  when possible; failed refreshes keep loaded data visible. Retry handles load
  failures. There is no polling, automatic deduplication, or background refresh.
- Copy/save/delete/pin confirmations disappear after four seconds or dismissal.
  Errors remain available for retry; clip contents are never included in feedback.

## Windows quick search (Milestone 7)

- While the desktop app is running, **Ctrl+Shift+Space** opens a separate compact
  launcher, including when the main window is minimized. Repeated invocation
  focuses the same launcher without clearing its current query.
- Each new opening focuses search, clears the previous query and reloads local
  clips. Empty search shows newest-first clips; typing uses the same literal,
  case-insensitive, multi-term search as the desktop library.
- Up/Down selects results while keeping search focused. Enter copies the selected
  stored clip and closes the launcher only after success. Escape closes without
  copying. IME composition and repeated Enter do not trigger copies. Home/End
  keep their normal text-caret behavior.
- Losing focus or closing the launcher hides it for reuse. Main-window filters,
  selection and unsaved forms are independent. There is no direct paste or input
  injection, background service, tray residency or autostart.
- Closing the main window exits the app and releases the shortcut. If another
  app owns the shortcut, the main library remains usable and shows a safe notice;
  release the conflicting shortcut and restart AI Clip Memory to retry.
- The launcher is bounded to the monitor work area and inherits the system
  light/dark theme. The Windows adapter owns native shortcut/window behavior;
  macOS shortcut support is not implemented in this milestone.

## Floating browser Save (Milestone 8)

- On exactly `https://chatgpt.com/*`, `https://chat.openai.com/*`,
  `https://claude.ai/*`, and `https://gemini.google.com/*`, selecting nonblank
  page text reveals a small Save control. Other sites/subdomains retain the
  unchanged `Save to AI Clip Memory` context-menu fallback.
- This requires narrowly scoped automatic content-script access on those four
  hosts; Chrome/Edge may request approval of updated site access. API permissions
  remain exactly `activeTab`, `contextMenus`, and `nativeMessaging`. There are no
  wildcard hosts, host_permissions, scripting, storage, popup or remote assets.
- Nothing is sent until Save is explicitly activated. Exact selected text and
  page metadata pass through a validated internal message to the existing native
  bridge and local SQLite. No captured content is logged or stored by the extension.
- Save is keyboard-focusable; Enter/Space activates it. Escape, click-away,
  scroll, resize, page navigation or clearing selection dismisses it without
  clearing the page selection. Editing fields, IME composition and active drag
  selection are excluded. A small confirmation follows success; failures offer
  explicit Retry. There are no automatic retries or duplicate detection.
- Dismissing after Save cannot cancel a request already delivered to the native
  host. If a response is lost, check desktop Refresh before retrying: the save
  may have completed. Refresh remains manual; launcher/desktop behavior is unchanged.
- UI styles are scoped to Shadow DOM and follow system light/dark preferences.
  Only top-level documents are supported, not embedded frames, browser/PDF pages,
  or text inside editable/shadow-root controls. Site interference cannot be
  eliminated on a hostile page; the context menu remains available as fallback.

### Manual Milestone 8 verification

1. In the Milestone 8 worktree run `pnpm build:extension` and `pnpm build:bridge`.
2. Load/reload `apps/extension/dist` in Chrome/Edge; approve only the four listed
   site matches. Reload existing supported-site tabs to load the content script.
3. Use the existing per-user registration instructions above with this unpacked
   extension's exact ID and the built native-host executable. No schema or host
   protocol changes are required.
4. On ChatGPT, Claude and Gemini, select a short synthetic passage, then a
   multiline passage. Try legacy chat.openai.com if reachable; it may redirect.
   Check Save near viewport edges, scrolling, zoom and in-site navigation.
5. Check keyboard Tab focus and Enter/Space, Escape/click-away, repeated clicks,
   editable fields and both system themes. Selection alone must never save.
6. Save one clearly marked synthetic verification passage; open the desktop and
   press Refresh. Confirm exact text/metadata. Repeat the context-menu fallback.
7. If the local host is unavailable, check safe error/Retry; after restoring the
   registration, retry explicitly. Check for an existing saved clip first if a
   response was lost. Do not change another installation's registration for tests.
8. Report outcomes and any site-specific issue. Remove only identified test clips
   and registrations created specifically for verification after approval.
