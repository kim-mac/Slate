import type {
  BrowserCapturePayload,
  CaptureClipResponse,
} from '@ai-clip-memory/shared';
import { createCapturePayload } from './capture';
import {
  readSelection,
  placeSaveControl,
  type SelectionSnapshot,
} from './selection';

export type SendFloatingCapture = (
  payload: BrowserCapturePayload,
) => Promise<CaptureClipResponse>;

export function installFloatingSave(
  doc: Document,
  send: SendFloatingCapture,
  styles: string,
): () => void {
  if (!doc.defaultView) return () => {};
  const win = doc.defaultView;
  let host: HTMLDivElement | null = null;
  let snapshot: SelectionSnapshot | null = null;
  let sourceUrl = '';
  let session = 0;
  let dragging = false;
  let composing = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners: Array<() => void> = [];

  function on(
    target: EventTarget,
    type: string,
    listener: EventListener,
    capture = false,
  ) {
    target.addEventListener(type, listener, capture);
    listeners.push(() => target.removeEventListener(type, listener, capture));
  }
  function dismiss() {
    session++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    host?.remove();
    host = null;
    snapshot = null;
    sourceUrl = '';
  }
  function inside(event: Event) {
    return host !== null && event.composedPath().includes(host);
  }
  function refresh() {
    if (
      disposed ||
      dragging ||
      composing ||
      doc.hidden ||
      (host && doc.activeElement === host)
    )
      return;
    const next = readSelection(doc);
    if (!next) {
      dismiss();
      return;
    }
    if (host && snapshot?.text === next.text && sourceUrl === doc.location.href)
      return;
    dismiss();
    snapshot = next;
    sourceUrl = doc.location.href;
    const currentSession = session;
    const container = doc.createElement('div');
    container.dataset.aiClipSave = '';
    // The host is positioned independently of the document's layout. Shadow DOM
    // isolates styles, not security; the service worker still distrusts messages.
    container.style.cssText =
      'all:initial;position:fixed;z-index:2147483647;display:block;width:max-content;max-width:calc(100vw - 16px);';
    const root = container.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = styles;
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = 'Save';
    button.setAttribute('aria-label', 'Save selection to AI Clip Memory');
    const status = doc.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(style, button, status);
    host = container;
    doc.documentElement.append(container);
    const position = () => {
      const bounds = container.getBoundingClientRect();
      const point = placeSaveControl(
        next.rect,
        { width: win.innerWidth, height: win.innerHeight },
        { width: bounds.width || 80, height: bounds.height || 32 },
      );
      container.style.left = `${point.left}px`;
      container.style.top = `${point.top}px`;
    };
    position();
    // Keep the page selection when clicking, but do not prevent keyboard focus.
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('keydown', (event) => {
      if (
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      }
    });
    let pending = false;
    button.addEventListener('click', (event) => {
      if (
        !event.isTrusted ||
        pending ||
        composing ||
        dragging ||
        currentSession !== session
      )
        return;
      if (sourceUrl !== doc.location.href) {
        dismiss();
        return;
      }
      const payload = createCapturePayload({
        selectionText: next.text,
        pageUrl: sourceUrl,
        pageTitle: doc.title,
      });
      if (!payload) {
        dismiss();
        return;
      }
      pending = true;
      button.disabled = true;
      button.textContent = 'Saving…';
      status.textContent = 'Saving locally';
      position();
      void (async () => {
        let result: CaptureClipResponse;
        try {
          result = await send(payload);
        } catch {
          result = { version: 1, ok: false, error: 'storage_unavailable' };
        }
        if (disposed || currentSession !== session) return;
        if (sourceUrl !== doc.location.href) {
          dismiss();
          return;
        }
        if (result.ok) {
          button.textContent = 'Saved';
          status.textContent = 'Saved locally';
          position();
          timer = setTimeout(dismiss, 1600);
        } else {
          pending = false;
          button.disabled = false;
          button.textContent = 'Retry';
          button.setAttribute('aria-label', 'Retry saving selection');
          status.textContent =
            result.error === 'message_too_large'
              ? 'Selection too large. Select less text.'
              : 'Could not save. Check the local bridge, then retry.';
          position();
        }
      })();
    });
  }

  on(
    doc,
    'pointerdown',
    (event) => {
      if (!inside(event)) {
        dragging = true;
        dismiss();
      }
    },
    true,
  );
  on(
    doc,
    'pointerup',
    (event) => {
      dragging = false;
      if (!inside(event)) refresh();
    },
    true,
  );
  on(
    doc,
    'pointercancel',
    () => {
      dragging = false;
      dismiss();
    },
    true,
  );
  on(doc, 'selectionchange', () => {
    if (dragging || composing || !host || doc.activeElement === host) return;
    refresh();
  });
  on(doc, 'focusin', (event) => {
    if (!inside(event) && !readSelection(doc)) dismiss();
  });
  on(doc, 'keyup', (event) => {
    const key = event as KeyboardEvent;
    if (
      key.isComposing ||
      key.repeat ||
      key.altKey ||
      key.key === 'Escape' ||
      key.key === 'Tab' ||
      key.key === 'Enter' ||
      key.key === ' '
    )
      return;
    // Observe browser selection gestures without overriding their defaults.
    if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === 'a') {
      refresh();
      return;
    }
    if (
      key.shiftKey &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(key.key)
    )
      refresh();
  });
  on(doc, 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') dismiss();
  });
  on(
    doc,
    'compositionstart',
    () => {
      composing = true;
      dismiss();
    },
    true,
  );
  on(
    doc,
    'compositionend',
    () => {
      composing = false;
    },
    true,
  );
  on(doc, 'visibilitychange', () => {
    if (doc.hidden) dismiss();
  });
  for (const type of [
    'scroll',
    'resize',
    'blur',
    'pagehide',
    'popstate',
    'hashchange',
  ])
    on(win, type, dismiss, type === 'scroll');
  if ('navigation' in win && win.navigation instanceof EventTarget)
    on(win.navigation, 'navigate', dismiss);
  return () => {
    disposed = true;
    dismiss();
    listeners.forEach((remove) => remove());
  };
}
