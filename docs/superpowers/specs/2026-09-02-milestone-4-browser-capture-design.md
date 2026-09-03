# Milestone 4 Browser Capture Design

## Scope

Implement only Milestone 4 browser-extension capture. A Chromium Manifest V3
background service worker will expose a selection-only context-menu action that
constructs a validated browser capture payload from the user's explicit text
selection and current page metadata.

The payload is ephemeral. It is not logged, stored, transmitted, sent to the
desktop application, or retained after the context-menu handler completes.
Milestone 5 bridge behavior is explicitly excluded.

## Architecture

```text
Selected text context-menu event
  -> Manifest V3 background service worker
  -> pure capture parsing and validation
  -> BrowserCapturePayload
  -> discarded after validation
```

The extension will not use a content script, injected UI, popup, storage API,
network request, native messaging, or desktop bridge. Chrome API wiring stays in
the background service worker. Selection parsing, URL validation, metadata
normalization, and source detection stay in pure TypeScript functions.

## Manifest and permissions

The manifest will request exactly:

- `activeTab`
- `contextMenus`

It will not declare `host_permissions`, content scripts, or permissions for
`storage`, `tabs`, `scripting`, clipboard access, or networking.

The context-menu item will:

- be titled `Save to AI Clip Memory`;
- appear only in the `selection` context;
- be limited to `http://*/*` and `https://*/*` document URL patterns.

`activeTab` provides temporary access to the current tab's title only after the
user explicitly invokes the context-menu action. No persistent host access is
needed.

## Shared payload contract

The shared package will export:

```ts
export type BrowserSourceApp =
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'Other Web';

export interface BrowserCapturePayload {
  content: string;
  contentType: 'text';
  sourceApp: BrowserSourceApp;
  sourceUrl: string;
  sourcePageTitle: string;
}
```

The capture payload is intentionally narrower than `ClipInput`. It represents
browser metadata before Milestone 5 performs desktop-boundary validation and
persistence.

## Validation and source detection

Capture validation will:

- reject a missing selection;
- reject a selection when `selection.trim().length === 0`;
- preserve every character of valid nonblank selection text;
- parse the source URL with `URL`;
- accept only `http:` and `https:` URLs;
- reject malformed and non-HTTP(S) URLs;
- preserve a valid page URL as supplied;
- use the tab title when available and otherwise use an empty string.

Source detection will use the parsed, lowercase hostname:

- `chatgpt.com` and its subdomains -> `ChatGPT`;
- exactly `chat.openai.com` -> `ChatGPT`;
- `claude.ai` and its subdomains -> `Claude`;
- `gemini.google.com` and its subdomains -> `Gemini`;
- every other valid HTTP(S) hostname -> `Other Web`.

Domain matching will require either exact hostname equality or a dot-delimited
subdomain suffix. Raw substring matching is prohibited.

## Chrome event flow

On extension installation, the background service worker will register one
context-menu item. On a matching click, it will ignore unrelated menu IDs and
call the pure capture function with `selectionText`, `pageUrl`, and `tab.title`.

If validation returns no payload, the handler ends without throwing. If a valid
payload is created, the handler ends after local validation. It does not retain
or forward the payload.

## Testing

Pure unit tests will cover:

- exact selected-text preservation;
- missing and whitespace-only selections;
- malformed and non-HTTP(S) URLs;
- ChatGPT, Claude, Gemini, and Other Web detection;
- exact-host and subdomain matching without substring false positives;
- URL and title metadata;
- missing tab title fallback;
- exact payload shape and `contentType: 'text'`.

Manifest tests will assert:

- Manifest V3;
- the exact permission set `activeTab` and `contextMenus`;
- no `host_permissions` property;
- absence of storage, tabs, scripting, and clipboard permissions;
- no content scripts;
- selection-only, HTTP/HTTPS-only context-menu configuration through the
  production registration descriptor.

Integration wiring will remain deliberately small, with no mock bridge or debug
capture buffer.

## Verification

Automated verification will include extension tests, the full workspace test
suite, formatting, linting, TypeScript typechecking, the extension build, and the
desktop compatibility build.

Manual verification will load the unpacked extension from `apps/extension/dist`
in Chrome or Chromium, confirm the context-menu visibility rules on HTTP/HTTPS
pages, exercise representative source URLs, and inspect the service worker at a
debugger breakpoint to confirm a valid ephemeral payload is constructed without
logging, persistence, or transport.

## Explicit exclusions

- Extension-to-desktop communication
- Native Messaging or localhost transport
- SQLite or desktop changes
- Persistent or session storage
- Capture history or debug buffers
- Popup, floating button, notification, or injected page UI
- Cloud, authentication, telemetry, analytics, sync, AI, or networking
- Milestone 5 behavior
