# Isolated updater SDK transport test

This is a Windows debug-only, headless test tool, not Slate Desktop or an updater
installation test. It pins Tauri **2.12.3** and updater **2.13.3** in an independent
Cargo crate. Tauri's `MockRuntime` supplies application context only; update
discovery, HTTPS downloads, minisign authentication, and signed-version checks use
the actual SDK. No replacement updater or cryptography is used.

## Preconditions and command

Run only from the `codex/desktop-updater` worktree, with its existing cached Rust
dependencies and existing signed disposable fixtures in
`dist/test/updater-disposable-signing`. The fixtures must have passed Gate A1 for
`0.2.0`. The runner reads the copied public key, two synthetic text artifacts, and
their signatures. It never reads the external updater private key or its passphrase
and never runs a signing command.

An already-installed OpenSSL 3 executable must be available on PATH. There is no
automatic installation or network dependency resolution. The checked-in standalone
lockfile is used with `--offline --locked`. Compilation reuses the worktree's
existing Rust target directory, without building Slate or installers.

```powershell
node --test scripts/windows/test-updater-sdk-transport.test.mjs
node scripts/windows/test-updater-sdk-transport.mjs
```

The second command is an explicitly authorized local TLS test ceremony. It creates
a **new**, ignored `dist/test/updater-sdk-transport/run-*` directory for every run;
it does not overwrite, regenerate, or clean up any existing test fixtures. Stop on
any compile, MockRuntime, fixture authentication, TLS, or scenario failure. No
fallback or insecure client option is permitted.

## Isolation and TLS

- A separate test application identity has no desktop startup, profile, SQLite,
  WebView, shortcut, autostart, or Native Messaging initialization.
- The SDK is initialized programmatically with only the copied disposable public
  key and a random-port HTTPS endpoint bound to `127.0.0.1`.
- A one-day disposable localhost certificate, test CA, unrelated CA, and
  wrong-hostname certificate are generated inside the new ignored output folder.
  These TLS keys are unrelated to updater signing identities. OpenSSL receives a
  run-local minimal configuration, not machine configuration.
- The native TLS client trusts only that run's supplied test CA. Chain and
  hostname verification remain enabled. No Windows trust-store changes, insecure
  HTTP transport, proxy use, or production endpoint access is required.
- Both discovery and download clients enforce HTTPS and restricted redirects.
  Download URLs must remain on the same loopback origin and test path prefix.
- Downloaded text remains in memory. It is never written, executed, installed, or
  passed to a shell. Only the locally compiled harness and offline verifier run.
- An automated source guard rejects installation APIs, process execution,
  artifact-file writes, and hidden source inclusions in the harness. This is a
  regression tripwire, not a security sandbox for arbitrary modified code.
- Normal desktop configuration, release staging, public keys, and installation
  enablement are unchanged. Production builds do not reference this crate.

## Scenario matrix and evidence

The runner first authenticates both existing fixtures with the Gate A1 verifier.
It then exercises the actual SDK for:

1. Native host target discovery and authenticated download.
2. Each explicit `windows-x86_64` and `windows-aarch64` platform: valid bytes,
   tampering, wrong public key, wrong authenticated version, corrupt signature.
3. Equal and older offered versions: no update and no artifact download.
4. HTTP failure, malformed manifest JSON, and disconnected endpoint.
5. Untrusted certificate chain and wrong hostname: no HTTP request reaches the
   server and no artifact is downloaded.
6. A denied redirect to HTTP/outside the test prefix.
7. Cancellation after one gated download chunk, then a separate cancellation
   followed by a retry on the **same SDK Update instance**.

Cancellation drops the download future via `Abortable`; the SDK has no dedicated
cancel method. A fresh download is required for retry, not resumable range fetching.
The download-finished callback precedes signature verification in this SDK, so
only a successful `download()` result is reported as authenticated.

Per-scenario `*-observed.json` records sanitized SDK outcomes before assertions;
`*.json` records passing assertions, and `results.json` exists only after all
scenarios pass. Reports contain version, architecture label, request/progress
counts, hashes, and static error categories, never raw SDK errors, key material,
passphrases, or environment dumps. Treat the generated folder as private test
output: **do not share or commit its disposable TLS private-key files**.

The pure Node tests also confirm that the unchanged production release validator
rejects loopback URLs and synthetic artifact names. Test endpoints and text files
are not valid production manifests or release assets.

## Limitations

An ARM64 process selecting an x64 platform tests SDK manifest selection and
authentication of x64-labeled synthetic bytes, not x64 execution or installation.
Testing on actual x64 Windows remains necessary. This tool does not validate NSIS,
process restart, installation privileges, production HTTPS hosting, updater UI,
database retention, rollback, or real signed installer delivery.

No files are deleted automatically, including on failure. Generated TLS secrets
expire after one day but remain on disk; deleting a specific test-run folder needs
separate cleanup approval. Existing updater signing credentials are never changed.
