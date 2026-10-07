# Slate 0.1.0

Draft notes for the upcoming first public Windows/Desktop release, Slate 0.1.0.
The accompanying Chrome extension is independently versioned at 0.1.1. Downloads
and the Chrome Web Store listing are not published yet.

Capture useful text and pages, find them quickly, and reuse them without an
account, Slate cloud service, telemetry, or analytics.

## Highlights

- Save selected browser text, whole HTTP/HTTPS pages, and supported AI-chat page
  selections through the Slate browser extension.
- Capture selected text from Windows applications with `Ctrl+Alt+Shift+C`.
- Find and copy clips from Quick Search with `Ctrl+Shift+Space`.
- Create, edit, delete, pin, search, filter, and browse clips by Calendar.
- Merge related clips into persistent groups without replacing their original
  records or source information. Unmerge members or whole groups when needed.
- Refresh externally captured clips when the main window regains focus. Quick
  Search loads fresh data on opening, refreshes on focus, and silently refreshes
  approximately every two seconds while visible in Search mode, without
  interrupting Create/Edit drafts.
- Keep Slate available in the notification area and optionally start it when
  signing in to Windows.
- Store clips locally in SQLite for offline access.

## Supported systems

- Windows 11 x64 (Intel and AMD 64-bit PCs)
- Windows 11 ARM64 (Windows-on-ARM devices)

The browser extension is required for browser capture. After publication, Chrome
and Microsoft Edge will use the same Chrome Web Store package for V1. macOS is
not released yet.

## Installation notes

The initial direct-download installers are unsigned. Windows SmartScreen may
show **Windows protected your PC**, and the publisher may appear as unknown.
After publication, download only from verified official locations and compare
the published SHA-256 checksum. Do not disable Windows security protections.

Technical Windows paths and executable names may still contain **AI Clip
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
- The main window does not continuously poll. It refreshes external captures on
  focus when no protected edit/confirmation/local mutation is active; manual
  Refresh is also available. Quick Search's visible Search mode refresh does not
  run during Create/Edit.
