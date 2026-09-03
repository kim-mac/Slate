# Milestone 5 Native Messaging Design

## Scope

Implement only the local Chromium-extension-to-desktop bridge required by
Milestone 5. A validated `BrowserCapturePayload` is sent from the existing
Manifest V3 background service worker to a short-lived Rust Native Messaging
host, validated again at the native boundary, and persisted through the
existing `ClipService` into the existing `clips.sqlite3` database.

No localhost server, schema change, React change, Tauri command change,
content script, popup, cloud service, telemetry, or Milestone 6 behavior is
part of this work.

## Architecture

```text
Selection-only context-menu event
  -> existing BrowserCapturePayload creation
  -> typed version 1 capture_clip request
  -> chrome.runtime.sendNativeMessage
  -> one-shot Rust native-host executable
  -> length-prefixed JSON framing and boundary validation
  -> existing ClipService::create
  -> existing SQLite repository and clips.sqlite3
  -> minimal clipId or safe error code response
```

The browser launches one native-host process for each capture. The host does
not require the Tauri GUI to be running, does not listen on a port, and exits
after writing one response. Protocol and persistence code remain platform
independent. Windows-only installation and registry behavior lives under
`scripts/windows` so future macOS registration can be added without changing
the shared protocol or service path.

## Shared protocol contract

The shared TypeScript package continues to own `BrowserCapturePayload` and adds
only the envelope and response types used by the extension:

```ts
export const NATIVE_MESSAGING_HOST_NAME = 'com.aiclipmemory.bridge';
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export interface CaptureClipRequest {
  version: 1;
  type: 'capture_clip';
  payload: BrowserCapturePayload;
}

export type CaptureClipResponse =
  | { version: 1; ok: true; clipId: string }
  | { version: 1; ok: false; error: BridgeErrorCode };
```

The Rust boundary mirrors this JSON contract with serde types. Success never
returns clip content or metadata. Failures return only one of the documented
safe codes.

## Framing and size limit

The native host reads exactly one Native Messaging frame:

1. Read a four-byte unsigned length in native byte order.
2. Reject a declared body larger than 1 MiB before allocating the body.
3. Allocate only after the length passes validation.
4. Read exactly the declared byte count.
5. Reject truncated bodies and invalid UTF-8 safely.
6. Parse and validate JSON.
7. Write one framed JSON response using the same native-byte-order prefix.

The host response is far below Chromium's 1 MiB host-to-extension limit.
`stdout` is reserved exclusively for the framed response. The host contains no
stdout logging or tracing. Necessary diagnostics may use only fixed,
non-sensitive stderr messages and must not contain content, payloads, URLs,
database paths, SQL errors, or filesystem details.

## Validation order and safe errors

The boundary validates in this order:

- frame length and completeness;
- UTF-8 and JSON syntax;
- envelope shape;
- `version === 1`;
- `type === "capture_clip"`;
- exact payload shape;
- nonblank content using `trim()` only for the blank check;
- `contentType === "text"`;
- `sourceApp` is `ChatGPT`, `Claude`, `Gemini`, or `Other Web`;
- `sourceUrl` parses as HTTP or HTTPS;
- `sourcePageTitle` is a string.

Valid content is stored byte-for-byte as received. Blank page titles map to
`None`; nonblank titles remain unchanged. The fixed safe error codes are:

- `malformed_message`
- `malformed_json`
- `message_too_large`
- `unsupported_version`
- `unsupported_message_type`
- `invalid_payload`
- `invalid_content`
- `invalid_content_type`
- `invalid_source_app`
- `invalid_source_url`
- `storage_unavailable`

No serde, URL, filesystem, SQLite, or internal error text crosses the protocol
boundary.

## Application-data path compatibility

Both GUI startup and the native host use one Rust path helper. The helper joins
Tauri's platform data directory with the existing application identifier
`com.aiclipmemory.desktop` and filename `clips.sqlite3`. GUI startup obtains the
platform data base directory from Tauri; the native host obtains the equivalent
platform data base directory through the platform-neutral `dirs` crate.

A unit test proves the shared helper produces the current GUI path, and an
integration test opens one path through the host handler and then the same path
through `ClipService` to prove the captured clip is visible without a second
database.

## Extension behavior and permissions

The existing source detection and `BrowserCapturePayload` construction remain
unchanged. A small bridge client constructs the request, calls
`chrome.runtime.sendNativeMessage`, and validates the minimal response. The
background handler sends only payloads that already passed capture validation.
It handles success and failure internally without logging, storage, retained
payload state, or context-menu-title changes.

The final permission set is exactly:

```json
["activeTab", "contextMenus", "nativeMessaging"]
```

There are no host permissions, content scripts, storage, tabs, scripting,
clipboard, notification, or network permissions.

## Windows registration

PowerShell scripts generate a host manifest in a per-user local application
data directory and register its absolute path under HKCU. The registration
script requires an existing absolute host executable path and one or more exact
32-character Chromium extension IDs. It supports Chrome, Edge, or both and
generates exact `chrome-extension://<id>/` allowlist entries with no wildcard.

Registry locations:

- Chrome: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aiclipmemory.bridge`
- Edge: `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.aiclipmemory.bridge`

The unregister script removes only these host-specific keys and the generated
manifest. Neither script requires administrator privileges or reads clip data.

## Testing and verification

Extension tests cover request construction, success, host-declared failure,
runtime failure, malformed responses, background integration, exact permissions,
and absence of content logging or storage.

Rust tests cover request/response serialization, valid persistence, malformed
JSON, truncated frames, invalid UTF-8, unsupported versions and types, every
payload validation rule, oversized declarations before body allocation, safe
responses, framing, exact content preservation, and shared GUI/native-host path
compatibility.

End-to-end manual verification builds the native host and extension, registers
the unpacked extension ID under HKCU, saves selected text while offline, opens
the desktop application, confirms the clip is present in the existing database,
deletes the test clip, and unregisters the development host.

