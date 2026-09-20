# Security Policy

## Supported version

| Version                    | Supported |
| -------------------------- | --------- |
| 0.1.x                      | Yes       |
| Earlier development builds | No        |

## Report a vulnerability

Use GitHub's private security-advisory feature for this repository when
possible. Do not open a public issue for an unpatched vulnerability.

Do not include real clips, selected text, browser conversations, database files,
tokens, personal URLs, or other private content in a report. Use synthetic data
and describe reproduction steps without disclosing user content.

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

## Unsigned V1 direct downloads

By project decision, code signing is not required for the initial Slate 0.1.0
direct-download release. The Windows installers and executables are therefore
unsigned. SmartScreen may show a reputation warning and Windows may display an
unknown publisher.

Users should download only from the official Slate GitHub Release or website and
compare the file's SHA-256 checksum with the published `SHA256SUMS.txt`. Users
may choose **More info → Run anyway** after verifying the source and checksum.
Slate documentation does not ask users to disable SmartScreen, antivirus, or
other Windows security protections.

Unsigned binaries provide no publisher authentication. Code signing remains a
recommended future hardening step, but it is not a V1 release gate.

## Known limitations

- The SQLite database is plaintext at rest. Slate does not provide
  application-level encryption.
- Browser extensions and other local applications may read clipboard content
  after the user copies a clip.
- Desktop selected-text capture temporarily holds a clipboard snapshot in
  process memory while attempting to restore it.
- Security depends on the Windows account, browser, operating system, and
  filesystem remaining trustworthy and up to date.
