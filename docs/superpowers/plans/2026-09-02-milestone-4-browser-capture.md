# Milestone 4 Browser Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Manifest V3 context-menu flow that converts an explicit browser text selection and page metadata into an ephemeral, validated `BrowserCapturePayload` without storing, logging, or transmitting it.

**Architecture:** The MV3 background service worker owns only Chrome API registration and event wiring. Pure functions in `capture.ts` parse and validate context-menu inputs, detect the source from a parsed hostname, and return a shared payload or `null`; the background handler deliberately allows a valid payload to leave scope without retaining or forwarding it.

**Tech Stack:** TypeScript 6, Chrome Manifest V3 APIs, Vite 8, Vitest 4, pnpm workspace, source-exported shared TypeScript package.

---

### Task 1: Add extension test tooling

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/tsconfig.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add only test/type development dependencies**

Add versions aligned with the workspace:

- `@types/chrome`
- `vitest` matching the desktop package

Add `"test": "vitest run"`. Enable `resolveJsonModule` and Chrome types in the
extension TypeScript config only as needed for production Chrome APIs and the
manifest-test import.

- [ ] **Step 2: Install dependencies**

Run `pnpm install` and confirm the supply-chain policy succeeds.

- [ ] **Step 3: Prove the test runner is available**

Run:

```powershell
pnpm --filter @ai-clip-memory/extension test --passWithNoTests
```

Expected: exit code 0 with no extension tests found yet.

### Task 2: Add the shared browser capture contract

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `apps/extension/src/capture.test.ts`

- [ ] **Step 1: Write the failing capture contract test**

Create `apps/extension/src/capture.test.ts` with an initial test importing the intended shared contract through `createCapturePayload` and asserting this exact shape:

```ts
expect(payload).toEqual({
  content: '  selected text\n',
  contentType: 'text',
  sourceApp: 'Other Web',
  sourceUrl: 'https://example.com/page',
  sourcePageTitle: 'Example page',
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @ai-clip-memory/extension test -- src/capture.test.ts
```

Expected: failure because the capture module and shared contract do not exist.

- [ ] **Step 3: Define the shared contract**

Add to `packages/shared/src/index.ts`:

```ts
export const BROWSER_SOURCE_APPS = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Other Web',
] as const;

export type BrowserSourceApp = (typeof BROWSER_SOURCE_APPS)[number];

export interface BrowserCapturePayload {
  content: string;
  contentType: 'text';
  sourceApp: BrowserSourceApp;
  sourceUrl: string;
  sourcePageTitle: string;
}
```

Keep `ClipInput` and the SQLite-facing model unchanged.

### Task 3: Build pure capture validation and detection test-first

**Files:**
- Create: `apps/extension/src/capture.ts`
- Create: `apps/extension/src/capture.test.ts`

- [ ] **Step 1: Add failing source-detection tests**

Test exact and subdomain matches for `chatgpt.com`, exact legacy `chat.openai.com`, `claude.ai`, and `gemini.google.com`. Test lookalike hostnames such as `notchatgpt.com` and `chatgpt.com.example.org` as `Other Web`.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: failure because `detectBrowserSource` is absent.

- [ ] **Step 3: Implement minimal parsed-hostname source detection**

Implement:

```ts
function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectBrowserSource(url: URL): BrowserSourceApp {
  const hostname = url.hostname.toLocaleLowerCase();
  if (
    isDomainOrSubdomain(hostname, 'chatgpt.com') ||
    hostname === 'chat.openai.com'
  ) {
    return 'ChatGPT';
  }
  if (isDomainOrSubdomain(hostname, 'claude.ai')) return 'Claude';
  if (isDomainOrSubdomain(hostname, 'gemini.google.com')) return 'Gemini';
  return 'Other Web';
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

- [ ] **Step 5: Add failing validation tests**

Cover missing selection, whitespace-only selection, malformed URL, `file:`, `chrome:`, and other non-HTTP(S) URLs, exact whitespace preservation, URL/title metadata, missing-title fallback, and exact payload shape.

- [ ] **Step 6: Run focused tests and verify RED**

Expected: failure because `createCapturePayload` is absent.

- [ ] **Step 7: Implement the minimal pure capture function**

Use a narrow input interface:

```ts
export interface BrowserCaptureInput {
  selectionText?: string;
  pageUrl?: string;
  pageTitle?: string;
}
```

Return `null` for blank content or invalid/non-HTTP(S) URLs. Preserve valid `selectionText` and `pageUrl` exactly, use `pageTitle ?? ''`, set `contentType` to `text`, and detect the source from the parsed URL.

- [ ] **Step 8: Run focused tests and verify GREEN**

### Task 4: Lock the minimal manifest and context-menu descriptor

**Files:**
- Modify: `apps/extension/public/manifest.json`
- Create: `apps/extension/src/contextMenu.ts`
- Create: `apps/extension/src/manifest.test.ts`

- [ ] **Step 1: Write failing manifest tests**

Import the manifest JSON and assert:

```ts
expect(manifest.manifest_version).toBe(3);
expect(new Set(manifest.permissions)).toEqual(
  new Set(['activeTab', 'contextMenus']),
);
expect(manifest).not.toHaveProperty('host_permissions');
expect(manifest).not.toHaveProperty('content_scripts');
```

Also assert that the permission list excludes `storage`, `tabs`, `scripting`, `clipboardRead`, and `clipboardWrite`.

- [ ] **Step 2: Write a failing descriptor test**

Assert that `CAPTURE_CONTEXT_MENU` contains:

```ts
{
  id: 'save-selection-to-ai-clip-memory',
  title: 'Save to AI Clip Memory',
  contexts: ['selection'],
  documentUrlPatterns: ['http://*/*', 'https://*/*'],
}
```

- [ ] **Step 3: Run tests and verify RED**

Expected: failures because permissions and the descriptor are missing.

- [ ] **Step 4: Add only the verified permissions**

Set manifest permissions to `activeTab` and `contextMenus`. `activeTab` is retained because Chromium documents `tabs.Tab.title` as sensitive and the context-menu invocation activates temporary host access. Do not add `tabs` or host permissions.

- [ ] **Step 5: Implement the descriptor and verify GREEN**

Define and export the immutable descriptor from `contextMenu.ts`, using `APP_NAME` to construct the title.

### Task 5: Wire the MV3 service worker without retention or transport

**Files:**
- Modify: `apps/extension/src/background.ts`
- Create: `apps/extension/src/background.test.ts`

- [ ] **Step 1: Write failing background wiring tests**

Use a narrow injected API interface rather than mocking the entire Chrome runtime. Assert that:

- installation removes stale menu items and creates the approved descriptor;
- unrelated menu IDs are ignored;
- a valid click calls the pure capture function and completes without a sink;
- invalid capture inputs complete without throwing;
- no module-level last-payload getter, storage call, runtime message, or network transport exists.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: failure because the registration helpers do not exist.

- [ ] **Step 3: Implement minimal registration helpers**

Keep `background.ts` limited to:

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(CAPTURE_CONTEXT_MENU);
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CAPTURE_CONTEXT_MENU.id) return;
  createCapturePayload({
    selectionText: info.selectionText,
    pageUrl: info.pageUrl,
    pageTitle: tab?.title,
  });
});
```

Respect `exactOptionalPropertyTypes` by conditionally adding optional properties rather than explicitly passing `undefined`. Do not assign the result, log it, store it, return it through messaging, or pass it to a callback.

- [ ] **Step 4: Run focused tests and verify GREEN**

### Task 6: Update status and verify the complete milestone

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update repository status**

State that Milestone 4 browser capture exists, while the extension-to-desktop bridge, accounts, cloud services, telemetry, and networking remain absent.

- [ ] **Step 2: Run complete automated verification**

Run:

```powershell
pnpm --filter @ai-clip-memory/extension test
pnpm test
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build:extension
pnpm build:desktop
```

Then run `git diff --check`, inspect the built `dist/manifest.json`, scan the extension source for logging/storage/network/bridge code, and verify no desktop or SQLite implementation files changed.

- [ ] **Step 3: Manually verify unpacked extension behavior**

Load `apps/extension/dist` through `chrome://extensions` or `edge://extensions`, then verify:

- the menu is absent without a selection;
- `Save to AI Clip Memory` appears for selected text on HTTP and HTTPS pages;
- it does not appear on unsupported document schemes;
- representative ChatGPT, Claude, Gemini, and other URLs produce the expected source through a service-worker debugger breakpoint;
- missing titles do not abort capture;
- no selected text or payload is printed in the service-worker console;
- no storage entry, request, native message, or retained payload is produced.

- [ ] **Step 4: Stop at Milestone 4**

Report files, exact permissions, flow, source rules, validation, automated and manual results, known limitations, and the recommended commit message `feat(extension): capture selected browser text`.
