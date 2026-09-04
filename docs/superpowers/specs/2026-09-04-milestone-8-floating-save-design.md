# Milestone 8 floating-save design

Approved scope: static isolated-world, top-frame content script on exactly
https://chatgpt.com/*, https://chat.openai.com/*, https://claude.ai/* and
https://gemini.google.com/*. API permissions remain activeTab, contextMenus,
nativeMessaging. No host_permissions, scripting, storage, popup or remote assets.

Selection detection creates one Shadow DOM Save control without layout shifts.
Exclude inputs, textareas, editable areas, composition and active dragging.
Preserve exact valid selection text. Do not send anything until trusted Save
activation. Native buttons support focus/Enter/Space; Escape dismisses; do not
steal focus or register shortcuts. Match system monochrome light/dark styling.

Content script -> narrow runtime message -> service-worker validation -> existing
sendCaptureToDesktop -> unchanged native host -> ClipService -> existing SQLite.
Validate own sender ID, tab, top frame, exact HTTPS host, source/sender origin,
exact payload fields, existing source classification, nonblank content and the
UTF-8 serialized native request limit of 1 MiB. Never log content or metadata.

Only ephemeral current-selection/request state. Dismiss on click-away, Escape,
scroll, resize, navigation or selection clearing; preserve the actual selection.
Prevent repeat activation while pending. A newer selection invalidates old UI
responses. In-flight native saves are not cancelled. Success briefly shows Saved;
safe failures permit explicit retry, never automatic retry/deduplication.

Keep context-menu behavior, capture.ts, bridge.ts, shared contracts, Rust,
registration, persistence, desktop and launcher untouched. No post-MVP work.
Manual browser verification is required in addition to automated DOM tests;
report inaccessible authenticated-site checks honestly and give the user steps.
Do not commit or modify user clips.
