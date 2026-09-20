# Privacy

Slate 0.1.0 is a local-first Windows application and Chromium browser
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

Cloud sync, accounts, telemetry, and analytics are not part of version 0.1.0. If
future versions introduce optional network features, their behavior and privacy
documentation must be updated before release.
