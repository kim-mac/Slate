# Privacy

Slate is a local-first Windows application and Chromium browser
extension. It does not require an account, login, cloud database, Slate backend,
cloud sync, telemetry, or analytics.

## Clip storage

Saved clips and source metadata are stored in a local plaintext SQLite database:

```text
%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3
```

Anyone or any software with access to the Windows account and this file may be
able to read it. Device encryption, Windows account security, backups, and
filesystem permissions remain the user's responsibility.

## Browser capture

The extension captures selected text only after the user activates **Save** or
**Save selection**. **Save this page** captures the current HTTP/HTTPS URL and
page title as a Link clip. Source URLs are stored exactly and may include query
parameters or URL fragments, which can contain sensitive information.

The requested capture and source metadata travel through Chromium Native
Messaging to the local Slate native host and then to the local SQLite database.
Slate does not send them to a Slate server. Websites and browser pages still
perform their own normal networking independently of Slate; their privacy
practices and network activity are outside Slate's local capture transport.
Native Messaging is local process communication, not a cloud upload. The native
host supplied with Slate Desktop writes to the library directly; the desktop
window does not relay each capture.

## Upcoming extension v0.1.2: recent save status

This describes forthcoming behavior, not in the published extension v0.1.1. The
storage permission allows a limited capture outcome and timestamp in Chrome
session storage for connection recovery and last-save feedback. The outcome can
be saved, unavailable, or unknown. This recovery-status record does not contain
clip content, selected text, page URLs, page titles, or raw error messages.
Captured content and source metadata still go to the local library as described
above.

The record can survive service-worker restarts within the browser session; it is
not permanent storage. When status is read, outcomes ten minutes old or older are
treated as unknown.
This does not mean the record is physically deleted at exactly ten minutes; a
later outcome can replace it. The popup reports historical save feedback, not a
live connection check. There is no connection polling or automatic capture retry.

## Desktop updates and network requests

Slate Desktop checks for updates at startup and when you request a check. It
requests the configured HTTPS update manifest at
https://tryslate.tech/updates/windows/latest.json. If you choose to download an
offered update, it requests the installer from the official GitHub release
infrastructure. Installation remains user-confirmed.

These update requests do not include your clip contents. Update checks use
ordinary HTTP request information, including the requested resource and an
updater user-agent header. This policy does not claim whether providers retain
request logs. Local clip storage does not mean Slate makes no network requests.

## Desktop selected-text capture and clipboard handling

When the user presses **Ctrl+Alt+Shift+C**, Slate asks the active Windows
application to copy its current selection by sending a synthetic Copy action.
Before doing so, Slate temporarily snapshots available clipboard formats,
captures the copied text, and attempts to restore the previous clipboard state.

Pre-existing clipboard information may temporarily exist in Slate's process
memory while this operation runs. Slate does not intentionally persist that
snapshot, send it over a network, or log its contents. Some applications or
protected clipboard formats may prevent capture or complete restoration; Slate
reports a generic failure rather than saving a partial clip.

## Copy and Open Source actions

Copy actions write stored clip content to the Windows clipboard only after the
user invokes Copy, its keyboard shortcut, or Quick Search Enter. Other local
applications may be able to read clipboard contents.

Open Source opens a stored HTTP/HTTPS URL only after the user invokes it. The
browser and destination website may make their normal network requests. Slate
does not attach clip content to the URL.

## Logs and diagnostics

Slate contains no telemetry or analytics SDK. It does not upload clips, usage
events, crash contents, or diagnostics. Clip contents, full browser-capture
payloads, source URLs, clipboard snapshots, and database paths are not written
to Native Messaging logs.

## Uninstall and data retention

Ordinary uninstall removes the application, native host, owned manifest, and
owned Chrome/Edge registrations, but retains the SQLite database so clips can
survive reinstall or upgrade.

The interactive uninstaller may offer **Delete app data**. Selecting it removes
the application-data directory. To remove data manually, fully quit Slate from
the tray menu, then delete:

```text
%APPDATA%\com.aiclipmemory.desktop
```

Deleting this directory permanently removes the local database unless another
backup exists. It does not remove copies made by the user or backup software.

## Future changes

Cloud sync, accounts, telemetry, and analytics are not part of Slate Desktop or
the extension. If future versions introduce additional network features, their behavior and privacy
documentation must be updated before release.

## Privacy questions

For privacy questions, email [support@tryslate.tech](mailto:support@tryslate.tech).
You can also use [Slate Support](https://tryslate.tech/support/) for the existing
GitHub support channel. Do not send private clip content, sensitive URLs, database
files, or credentials, or include them in public GitHub issues.
