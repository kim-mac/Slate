# Slate v0.3.2 — Windows maintenance update

**Unpublished release-preparation draft.** The public release remains v0.3.1.
The v0.3.2 installers have not yet been built, signed or tested.

## Improvements

- Correct Windows Restart Manager process-lifetime handling: maintenance checks
  verify process identity and actual exit rather than treating stale records as
  evidence that Slate is still running.
- Clearer interactive installer and uninstaller guidance: quit Slate from its
  tray menu, then choose Retry, or choose Cancel to stop before proceeding.
- Safer retry coordination releases maintenance locks while you resolve drafts
  and quit, then revalidates safety before continuing. It does not force-close
  Slate or your browser.
- Group deletion checks the exact clips you reviewed before deleting. If group
  membership changes, Slate asks you to review its clips again.
- Other existing Slate functionality remains unchanged.

## Installation and updates

Windows ARM64 and x64 candidates will use the existing current-user installation
identity. In-place upgrades from v0.3.1 are intended to preserve clips, groups
and settings. No database migration is added in this release. Uninstall retains
application data by default; selecting **Delete the application data** removes it.

Normal updates retain production signature verification and explicit download
and restart confirmation. The actual signed v0.3.1-to-v0.3.2 update has not yet
passed runtime validation; successful W3 unsigned same-version tests do not
replace that release gate.

After publication, use official Slate downloads and compare the matching
installer with its entry in `SHA256SUMS.txt`. Planned filenames are
`Slate-0.3.2-Windows-ARM64.exe` and `Slate-0.3.2-Windows-x64.exe`.
Tauri updater signatures do not provide Windows Authenticode publisher identity;
Windows SmartScreen may show an Unknown Publisher warning for packages without
Authenticode signing. Do not disable Windows security protections.

## Known test limitation

On one ARM64 standard Windows account named `slatetest`, the local test installer
exited without displaying UI or installing Slate. The cause is unresolved; another
application reportedly also failed to install in that account. This observation
does not establish universal standard-user failure or support. No fix for that
scenario is claimed in v0.3.2.
