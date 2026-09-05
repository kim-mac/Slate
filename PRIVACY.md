# Privacy

AI Clip Memory 0.1.0 is a local-first Windows application and Chromium browser
extension. It does not require an account, login, cloud database, remote backend,
or cloud sync.

## Clip storage

Saved clips and their source metadata are stored in a local SQLite database:

```text
%APPDATA%\com.aiclipmemory.desktop\clips.sqlite3
```

The database is currently plaintext. Anyone or any software with access to the
Windows account and this file may be able to read its contents. Device encryption,
Windows account security, backups, and filesystem permissions remain the user's
responsibility.

## Browser capture

The extension captures only text the user explicitly selects and saves. It sends
that text and the current page metadata through Chromium Native Messaging to the
local AI Clip Memory native host. The native host writes the clip to the local
SQLite database.

AI Clip Memory does not send captured content to an AI Clip Memory server. The
browser page itself may be provided by an online service, but the extension's
capture transport remains local to the computer.

## Telemetry and analytics

The MVP contains no telemetry or analytics SDK. It does not upload clips, usage
events, crash contents, or diagnostics. Clip contents and full capture payloads
are not written to application logs.

## Clipboard and source URLs

Copy actions write the selected stored clip to the Windows clipboard only after
the user invokes Copy, the keyboard copy shortcut, or launcher Enter action.
Other applications on the computer may be able to read the clipboard.

Open Source opens a stored HTTP or HTTPS source URL only after the user invokes
the action. The browser and destination website may then make their normal
network requests; AI Clip Memory does not attach clip contents to the URL.

## Uninstall and data retention

Ordinary uninstall removes the installed application, Native Messaging host,
owned host manifest, and owned Chrome/Edge registration. It retains the SQLite
database by default so clips can survive reinstall or upgrade.

The interactive uninstaller may offer an explicit **Delete app data** choice.
Selecting it deliberately removes the application-data directory. To remove data
manually, first exit AI Clip Memory, then delete:

```text
%APPDATA%\com.aiclipmemory.desktop
```

Deleting this directory permanently removes the local database unless another
backup exists. It does not remove copies that the user or backup software made
elsewhere.

## Future changes

Cloud sync, accounts, telemetry, and analytics are not part of version 0.1.0. If
future versions introduce optional network features, their behavior and privacy
documentation must be updated before release.
