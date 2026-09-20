# Slate 0.1.0

Slate 0.1.0 is the first public release of a local-first memory tool for Windows.
Capture useful text and pages, find them quickly, and reuse them without an
account, Slate cloud service, telemetry, or analytics.

## Highlights

- Save selected browser text, whole HTTP/HTTPS pages, and supported AI-chat page
  selections through the Slate browser extension.
- Capture selected text from Windows applications with `Ctrl+Alt+Shift+C`.
- Find and copy clips from Quick Search with `Ctrl+Shift+Space`.
- Create, edit, delete, pin, search, filter, and browse clips by Calendar.
- Keep Slate available in the notification area and optionally start it when
  signing in to Windows.
- Store clips locally in SQLite for offline access.

## Supported systems

- Windows 11 x64 (Intel and AMD 64-bit PCs)
- Windows 11 ARM64 (Windows-on-ARM devices)

The browser extension is required for browser capture. Chrome uses the Chrome
Web Store package; Microsoft Edge uses that same package for V1.

## Installation notes

The initial direct-download installers are unsigned. Windows SmartScreen may
show **Windows protected your PC**, and the publisher may appear as unknown.
Download only from the official Slate GitHub Release or website, verify the
published SHA-256 checksum, then use **More info → Run anyway** if you choose to
continue.

Some Windows installation, uninstall, or process surfaces may display **AI Clip
Memory**. Slate preserves this earlier internal Windows identity in 0.1.0 so
existing users can upgrade without moving data or installing a second app.

## Privacy

Slate stores clips in a local plaintext SQLite database. It has no account,
Slate cloud sync, remote application backend, telemetry, or analytics. See
[`PRIVACY.md`](../PRIVACY.md) for clipboard, URL, browser, and uninstall details.

## Known limitations

- Installers and executables are unsigned for the initial V1 release.
- Windows 10 and x86/32-bit Windows are not supported release targets.
- The local SQLite database is not encrypted by Slate.
- The open desktop library requires manual Refresh to show clips captured by the
  browser while it is already open.
