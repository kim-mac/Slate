# Slate v0.3.1

Slate v0.3.1 improves everyday clip editing, grouping and Quick Search on Windows x64 and ARM64. Slate remains free, open source and local-first, with no Slate account required.

## What's new and improved

- Edit clip content and titles in place, including individual members of merged groups. Save before navigation and draft guards help protect unfinished edits.
- Automatically group new browser captures from the same exact source URL. Rename groups and manage individual members without unmerging the whole group.
- See group titles, member previews and clip counts in Quick Search, and open groups with Enter or a click.
- Copy standalone results, individual group members or all group content in displayed order.
- More stable group scrolling, save-state controls, notifications and keyboard focus.
- Clearer local-only status and discovery of the optional Chrome extension.
- Improved updater shutdown authorization and handling of failed installer launches.

## Install or update

Choose **Windows x64** for Intel/AMD PCs or **Windows ARM64** for Windows-on-ARM PCs. Download only from this official release.

Once 0.3.1 is offered in Slate, use **Update Now** to download it, then **Restart to update** when ready. Installation is user-confirmed. Do not uninstall Slate or select Delete application data for a normal update.

The update is designed to preserve existing clips, groups, pins and settings. It upgrades the local database; make a cold backup first. Returning to 0.3.0 does not reverse that migration and requires a compatible pre-update backup.

## Verification and known limitations

Compare the installer SHA-256 with this release's [SHA256SUMS.txt](https://github.com/kim-mac/Slate/releases/download/v0.3.1/SHA256SUMS.txt) before opening it. The matching **.exe.sig** files are Tauri updater signatures, not Windows publisher certificates.

The installers are **not Authenticode-signed**. Windows SmartScreen may show **Unknown Publisher**. Verify the official source and checksum before proceeding; do not disable Windows security or bypass malware detections or organizational restrictions.

Windows 11 is supported; macOS remains unavailable. Browser capture requires Slate Desktop and the optional official Chrome extension. Local database backups are not automatic.

Both architectures passed clean-installer manual testing. At release preparation, the first public 0.3.0 → 0.3.1 in-app update and retained-data migration still await post-activation verification; those results are not claimed here.
