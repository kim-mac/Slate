# Security Policy

## Release versions and reporting scope

| Component        | Current public version |
| ---------------- | ---------------------- |
| Desktop          | 0.3.2                  |
| Chrome extension | 0.1.1                  |

Start with the [latest official desktop release](https://github.com/kim-mac/Slate/releases/latest)
and the published [Chrome extension](https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh)
when reporting an issue. Include both component versions. Local development
builds and future release drafts are not evidence that an update is publicly
available. This policy does not promise support for every historical build or
a response or fix timeline.

## Report a vulnerability

Use GitHub's private vulnerability-reporting feature for this repository when
GitHub offers it. This document does not confirm that it is enabled. If it is
unavailable, email [support@tryslate.tech](mailto:support@tryslate.tech) to ask how
to arrange a private report, without including sensitive details in the initial
message. Do not post vulnerability details in public issues. No response time,
mailbox availability or fix schedule is guaranteed.

Do not include real clips, selected text, browser conversations, database files,
tokens, secrets, personal URLs, or other private content in a report. Do not
publish vulnerability details or sensitive data in public issues. Use synthetic
data and describe reproduction steps without disclosing user content.

## Current security boundaries

- Clip data remains in a local SQLite database.
- Browser captures use Chromium Native Messaging rather than a network port.
- The host manifest allows only exact extension origins; wildcard origins are
  forbidden.
- Chrome and Edge registrations are per-user under HKCU.
- Incoming bridge frames are limited to 1 MiB and validated before persistence.
- The native host reserves stdout for framed protocol responses.
- Bridge failures expose fixed safe codes rather than database or payload
  details.
- Clip content, full payloads, URLs, and database paths are not logged by the
  Native Messaging host.
- Saved content is displayed as text and is not executed as captured HTML.

## Installer verification and update signatures

Current public Windows installers are **not Authenticode-signed**. Windows
SmartScreen may show **Unknown Publisher** or a reputation warning. Tauri updater
signatures authenticate update artifacts against Slate's production verification
key and enforce signed-version checks; they are not Windows publisher
certificates and do not remove SmartScreen warnings.

Download only through the [official website](https://tryslate.tech/download/windows/)
or [GitHub release](https://github.com/kim-mac/Slate/releases/latest). Compare the
installer's SHA-256 with the matching filename in that release's `SHA256SUMS.txt`.
For example, after substituting your actual downloaded file path:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\path\to\Slate-installer.exe'
```

This detects differing bytes; a checksum alone does not authenticate the publisher.
Obtain the installer and checksum through the official release. Proceed past a
SmartScreen reputation warning only after verifying the official source and
checksum. Do not disable Windows security or bypass malware detections or
organizational restrictions.

The updater checks metadata automatically, but download and installation are
user-confirmed. Do not disable signature verification or substitute update
endpoints to work around a failure. Normal upgrades are designed to preserve application data;
an older installer does not reverse a database migration. Historical first-release
signing decisions do not replace current updater verification requirements.

## Known limitations

- The SQLite database is plaintext at rest. Slate does not provide
  application-level encryption.
- Browser extensions and other local applications may read clipboard content
  after the user copies a clip.
- Desktop selected-text capture temporarily holds a clipboard snapshot in
  process memory while attempting to restore it.
- Security depends on the Windows account, browser, operating system, and
  filesystem remaining trustworthy and up to date.
