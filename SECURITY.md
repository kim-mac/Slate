# Security Policy

## Supported version

| Version                    | Supported |
| -------------------------- | --------- |
| 0.1.x                      | Yes       |
| Earlier development builds | No        |

## Report a vulnerability

Use GitHub's private security-advisory feature for this repository when possible.
Do not open a public issue for an unpatched vulnerability.

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
- Bridge failures expose fixed safe codes rather than database or payload details.
- Clip content, full payloads, URLs, and database paths are not logged by the
  Native Messaging host.
- Saved content is displayed as text and is not executed or rendered as captured
  HTML.

## Known limitations

- The SQLite database is plaintext at rest. Slate does not currently
  provide application-level encryption.
- Private Phase 1 installers and executables are unsigned. Windows may show an
  unknown-publisher or SmartScreen reputation warning.
- Browser extensions and other local applications may read clipboard content
  after the user copies a clip.
- Security still depends on the Windows account, browser, operating system, and
  filesystem remaining trustworthy and up to date.

Code signing, public extension-store distribution, and automated release
infrastructure are later release gates. Their absence must remain visible in
release notes and distribution guidance.
