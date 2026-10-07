# Slate

Useful information gets buried in ChatGPT, Claude, Gemini, other AI conversations,
and browser tabs. Slate helps you save what matters without breaking your flow,
then find and reuse it from your own private, local-first library.

**Capture → find → reuse.** No Slate account required.

## What Slate does

- **Save from AI conversations:** use the floating Save control on supported
  ChatGPT, Claude, and Gemini pages.
- **Capture from the web:** right-click to save selected text or save an
  HTTP/HTTPS webpage as a link, preserving available source and page context.
- **Capture from desktop apps:** select text and press `Ctrl+Alt+Shift+C`.
- **Find and reuse:** press `Ctrl+Shift+Space` for Quick Search, then copy a clip
  back into your work. Create and edit clips directly from Quick Search.
- **Organise your library:** search, filter, pin, and browse by Calendar.
  Persistent Merge groups keep related clips together while preserving each
  original clip and its source information.
- **Stay within reach:** closing the main window keeps Slate in the notification
  area. Optional startup keeps it available when you sign in to Windows.

The main library refreshes external/native-host captures when its window regains
focus, except while editing or performing a local action that needs protection.
Quick Search loads fresh clips when opened, refreshes on focus, and silently
refreshes approximately every two seconds while visible in Search mode. Create
and Edit drafts are not refreshed. Manual Refresh remains available in the main
library; the main window does not continuously poll.

## Platforms and release status

Slate is preparing its first public release:

| Component        | Release candidate | Platform                                                |
| ---------------- | ----------------- | ------------------------------------------------------- |
| Desktop          | 0.1.0             | Windows 11 x64 (Intel/AMD) and ARM64                    |
| Chrome extension | 0.1.1             | Chrome; Microsoft Edge uses the same CWS package for V1 |
| macOS            | Coming soon       | Not released                                            |

The GitHub repository is currently private. The GitHub Release, Chrome Web Store
listing, and website are not published yet. Verified download and store links
will be added after publication. Unpacked extension instructions are for
development and testing, not a substitute for the public store release.

Browser capture requires the installed Slate native host, provided by the Windows
installer. WebView2 is required for the desktop UI; if missing, setup downloads
Microsoft's bootstrapper. Windows 10 and x86/32-bit Windows are not verified
release targets.

The initial Windows installers are unsigned. Microsoft Defender SmartScreen may
show a warning or an unknown publisher. After publication, use verified official
downloads and compare their SHA-256 checksums. Do not disable Windows security
protections.

## How it works and privacy

Browser capture follows this local path:

```text
Slate extension → Chrome Native Messaging → installed Slate native host → local SQLite
```

The native host writes through the shared persistence implementation directly to
SQLite; the desktop GUI does not need to relay the capture. Slate then reads that
library to display and organise your clips.

- No Slate account, cloud backend, or cloud sync in V1.
- No Slate application analytics or telemetry.
- The library is stored locally and remains available offline.
- The SQLite database is plaintext, not application-level encrypted.

The normal Windows library location is:

```text
%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3
```

Ordinary uninstall retains application data. Selecting **Delete app data**
deliberately removes it. Technical identifiers, executable names, and Windows
paths may retain **AI Clip Memory** for upgrade and data compatibility; the
public product name is Slate.

See [PRIVACY.md](PRIVACY.md) for data handling and [SECURITY.md](SECURITY.md) for
security boundaries and vulnerability-reporting guidance.

## Development

- `apps/desktop`: Tauri, React/TypeScript, Rust, and SQLite.
- `apps/extension`: Chromium Manifest V3 extension.
- `apps/site`: static Astro landing page.
- `packages/shared`: shared TypeScript contracts.
- `scripts/windows`: Native Messaging registration and release packaging.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites, local setup,
desktop/extension commands, Native Messaging testing, and verification. Internal
workspace package names are private build identifiers, not public branding.

## License

Slate is available under the [MIT License](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
