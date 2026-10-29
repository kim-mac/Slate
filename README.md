# Slate

Useful information gets buried in ChatGPT, Claude, Gemini, other AI conversations,
and browser tabs. Slate helps you save what matters without breaking your flow,
then find and reuse it from your own private, local-first library.

**Capture → find → reuse.** No Slate account required.

**[Website](https://tryslate.tech/) · [Download for Windows](https://tryslate.tech/download/windows/) · [macOS - Coming soon] · [Chrome extension](https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh)**

For people collecting useful answers, research and working notes, Slate keeps
selected text and links close at hand on their own PC.

## What Slate does

- **Save from AI conversations:** use the floating Save control on supported ChatGPT, Claude, and Gemini pages to save a selected snippet, not a whole conversation.
- **Capture from the web:** right-click and choose **Save selection** for selected
  text. **Save this page** keeps the page's title and URL as a link, not its full
  text or HTML.
- **Capture from desktop apps:** select copyable text and press `Ctrl+Alt+Shift+C`.
  Some apps or protected clipboard formats may prevent capture.
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

## Download and availability

Slate is publicly available for Windows, with a companion extension published on
the Chrome Web Store. The [source repository](https://github.com/kim-mac/Slate)
is public.

| Component        | Current public version | Availability                                                                                        |
| ---------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| Desktop          | 0.3.1                  | Windows 11 x64 (Intel/AMD) and ARM64                                                                |
| Chrome extension | 0.1.1                  | [Chrome Web Store](https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh) |
| macOS            | Not released           | Planned                                                                                             |

**Get started:**

1. Use the [Windows download guide](https://tryslate.tech/download/windows/) or
   [latest official GitHub release](https://github.com/kim-mac/Slate/releases/latest).
   Choose x64 for Intel/AMD PCs or ARM64 for Windows-on-ARM PCs.
2. Install Slate for your Windows account and open it to view your library.
   The desktop installer supplies the native host required for browser capture.
3. Install the [Slate Chrome extension](https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh) to capture content from supported AI conversations and webpages.

Browser capture requires the installed Slate native host, provided by the Windows
installer. WebView2 is required for the desktop UI; if missing, setup downloads
Microsoft's bootstrapper. Windows 10 and x86/32-bit Windows are not verified
release targets. Microsoft Edge uses the Chromium extension package, but is not
listed here as a separately verified store release.

The current Windows installers are **not Authenticode-signed**. SmartScreen may
show **Unknown Publisher**. Verify the official source and compare the installer
SHA-256 with that release's `SHA256SUMS.txt` before opening it. Tauri updater
signatures are separate from Windows publisher certificates. Do not disable
Windows protection or bypass malware detections or organizational restrictions.

**Updates:** Slate checks for updates at startup and when requested. If a newer
release is offered, choose **Update Now**, then **Restart to update** when ready.
Downloads must pass production signature and signed-version checks; installation
is user-confirmed. Normal upgrades are designed to preserve clips and settings.
Do not uninstall or choose **Delete app data** for a normal update. Back up
important data with Slate fully quit; reinstalling an older version does not
reverse a database migration.

## How it works and privacy

Browser capture follows this local path:

```text
Slate extension → Chrome Native Messaging → installed Slate native host → local SQLite
```

The native host writes through the shared persistence implementation directly to
SQLite; the desktop GUI does not need to relay the capture. Slate then reads that
library to display and organise your clips.

- No Slate account, cloud backend, or cloud sync.
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

## Help

For capture, installation, tray and update troubleshooting, see
[Slate Support](https://tryslate.tech/support/) or email
[support@tryslate.tech](mailto:support@tryslate.tech). Check All Clips and Refresh
before retrying a capture that is not visible. Use synthetic examples in
[public bug reports](https://github.com/kim-mac/Slate/issues); do not share private
clips, sensitive URLs, database files or credentials. Report security details
privately using the guidance in [SECURITY.md](SECURITY.md).

## Development

- `apps/desktop`: Tauri, React/TypeScript, Rust, and SQLite.
- `apps/extension`: Chromium Manifest V3 extension.
- `apps/site`: static Astro landing page.
- `packages/shared`: shared TypeScript contracts.
- `scripts/windows`: Native Messaging registration and release packaging.

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites, local setup,
desktop/extension commands, Native Messaging testing, and verification. Internal
workspace package names are private build identifiers, not public branding.
Production website main and frozen desktop release source are separate lines;
use the release tag when inspecting the source of a published desktop version.

## License

Slate is available under the [MIT License](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
