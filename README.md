# Slate

Slate is a local-first memory tool for Windows. Save useful text and pages from
your browser or desktop, find them quickly, and copy them back into whatever you
are working on—without an account, cloud sync, telemetry, or a Slate backend.

The core workflow is simple: **capture → find → reuse**. Clips are stored in a
local SQLite database and remain available offline.

Slate 0.1.0 is available for Windows 11 on x64 and ARM64 computers.

## Install Slate on Windows

Download the installer that matches your computer from the Slate GitHub Release
or, when available, the Slate website:

- **Windows x64** — `Slate-0.1.0-Windows-x64.exe` for Intel and AMD Windows PCs.
- **Windows ARM64** — `Slate-0.1.0-Windows-ARM64.exe` for Windows-on-ARM devices
  such as Snapdragon PCs.

Slate does not provide an x86/32-bit installer. Windows 10 support has not been
verified for this release.

The current-user installer normally does not require administrator privileges.
It installs the desktop application and local browser bridge. Microsoft Edge
WebView2 is required for the desktop UI; if it is missing, the installer uses
Microsoft's WebView2 bootstrapper, which requires an internet connection for
that one-time download.

Some Windows surfaces may display **AI Clip Memory**. Slate 0.1.0 intentionally
preserves that earlier internal Windows installation identity so existing users
can upgrade without moving their application data or creating a second app.

### Unsigned installer notice

The initial Slate 0.1.0 direct-download installers are unsigned. Windows
SmartScreen may show **Windows protected your PC**, and the publisher may appear
as **Unknown publisher**. If you downloaded the installer from the official
Slate GitHub Release or website and verified its published SHA-256 checksum, use
**More info → Run anyway** to continue. Do not disable SmartScreen, antivirus, or
other Windows security features globally.

## Install the browser extension

- **Google Chrome:** install Slate from the Chrome Web Store. The listing URL
  will be added to the release page before V1 is published.
- **Microsoft Edge:** for V1, install the same Chrome Web Store extension in
  Edge. Edge may ask you to allow extensions from other stores.

The desktop app must be installed for browser captures to reach the local Slate
library. Unpacked extension installation is only for development and testing;
those instructions live in [the developer guide](docs/DEVELOPMENT.md).

## Quick start

Slate 0.1.0 includes:

- **Browser capture:** save selected text with **Save selection**, save an
  HTTP/HTTPS page as a Link with **Save this page**, or use the floating **Save**
  control on supported ChatGPT, Claude, and Gemini pages.
- **Desktop capture:** select text in a Windows application and press
  **Ctrl+Alt+Shift+C**.
- **Quick Search:** press **Ctrl+Shift+Space** while Slate is running, search or
  browse recent clips, then press **Enter** to copy the selected clip.
- **Quick Capture and Edit:** create or edit from Quick Search and press
  **Ctrl+Enter** to save.
- **Desktop library:** create, edit, delete, pin, search, filter, browse by
  Calendar, copy content, and open stored HTTP/HTTPS sources.
- **Background availability:** closing the main window keeps Slate in the
  Windows notification area. Use the tray menu to reopen or fully quit it.
- **Optional startup:** enable **Start Slate when I sign in to Windows** in
  Settings.

Important shortcuts:

| Area            | Action                                 | Shortcut           |
| --------------- | -------------------------------------- | ------------------ |
| Global          | Open or focus Quick Search             | `Ctrl+Shift+Space` |
| Global          | Save selected text from the active app | `Ctrl+Alt+Shift+C` |
| Quick Search    | Move through results                   | `↑` / `↓`          |
| Quick Search    | Copy selected clip                     | `Enter`            |
| Quick Search    | Save Quick Capture / Quick Edit        | `Ctrl+Enter`       |
| Quick Search    | Go back or close                       | `Esc`              |
| Desktop library | Focus search                           | `Ctrl+F`           |
| Desktop library | Copy open clip                         | `Ctrl+Shift+C`     |
| Desktop library | Show or hide sidebar                   | `Ctrl+B`           |

Use **Refresh** in the desktop library after a browser capture. Browser capture
is local, but the open library does not poll the database automatically.

## Local data and uninstall behavior

Slate stores clips in a plaintext SQLite database at:

```text
%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3
```

Ordinary uninstall keeps this data so clips can survive reinstall or upgrade.
The interactive uninstaller may offer **Delete app data**; selecting it
deliberately removes the application-data directory. See [PRIVACY.md](PRIVACY.md)
before deleting retained data manually.

Uninstall removes Slate's installed local browser bridge and its owned Chrome
and Edge registration values. It does not remove the browser extension or
unrelated browser state.

## Privacy and security

Slate has no account, Slate cloud sync, remote application backend, telemetry,
or analytics. Browser-to-desktop capture uses Chromium Native Messaging on the
same computer rather than a network service. See [PRIVACY.md](PRIVACY.md) for
data-handling details and [SECURITY.md](SECURITY.md) for security boundaries and
reporting guidance.

## Development

Repository setup, verification, unpacked-extension testing, and private package
commands are documented in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## License

Slate is available under the [MIT License](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
