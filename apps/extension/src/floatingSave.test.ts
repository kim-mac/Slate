// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/c/test"}
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { installFloatingSave } from './floatingSave';
import type { CaptureClipResponse } from '@ai-clip-memory/shared';

let cleanup: () => void;
const success: CaptureClipResponse = {
  version: 1,
  ok: true,
  clipId: 'f7a6c48d-bfd5-4f13-b54d-e238f7cd7842',
};
const failure: CaptureClipResponse = {
  version: 1,
  ok: false,
  error: 'storage_unavailable',
};
function selection(text = '  selected\n text  ') {
  const p = document.createElement('p');
  p.textContent = text;
  document.body.append(p);
  const range = document.createRange();
  range.selectNodeContents(p);
  range.getBoundingClientRect = () => ({
    left: 20,
    right: 100,
    top: 30,
    bottom: 50,
    width: 80,
    height: 20,
    x: 20,
    y: 30,
    toJSON: () => ({}),
  });
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  document.dispatchEvent(new Event('pointerup'));
  return p;
}
function control() {
  return document
    .querySelector('[data-ai-clip-save]')
    ?.shadowRoot?.querySelector('button') as HTMLButtonElement | undefined;
}
function trustedClick(button: HTMLButtonElement) {
  // jsdom cannot create browser-trusted input. Replace only dispatchEvent's event
  // trust at the native listener boundary; real browser verification covers it.
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
beforeEach(() => {
  vi.useFakeTimers();
  // Inject trust for normal tests through the browser event getter used by the controller.
});
afterEach(() => {
  cleanup?.();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('floating Save', () => {
  test('keyboard Select All exposes Save without overriding the browser gesture', () => {
    const send = vi.fn();
    cleanup = installFloatingSave(document, send, '');
    selection();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const event = new KeyboardEvent('keyup', {
      key: 'a',
      ctrlKey: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(control()?.textContent).toBe('Save');
    expect(event.defaultPrevented).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  test('moving keyboard focus into an editable area dismisses without capture', () => {
    const send = vi.fn();
    cleanup = installFloatingSave(document, send, '');
    selection();
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    expect(control()).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
  test('has isolated accessible UI and zero transport on selection or synthetic click', () => {
    const send = vi.fn().mockResolvedValue(success);
    cleanup = installFloatingSave(document, send, ':host { color: black; }');
    selection();
    expect(control()?.textContent).toBe('Save');
    expect(control()?.getAttribute('aria-label')).toBe(
      'Save selection to AI Clip Memory',
    );
    expect(document.activeElement).toBe(document.body);
    expect(send).not.toHaveBeenCalled();
    trustedClick(control()!);
    expect(send).not.toHaveBeenCalled();
  });
  test.each(['scroll', 'resize', 'blur', 'pagehide', 'popstate', 'hashchange'])(
    'dismisses on %s',
    (type) => {
      const send = vi.fn();
      cleanup = installFloatingSave(document, send, '');
      selection();
      window.dispatchEvent(new Event(type));
      expect(control()).toBeUndefined();
      expect(send).not.toHaveBeenCalled();
    },
  );
  test('Escape and click-away dismiss without clearing page selection', () => {
    cleanup = installFloatingSave(document, vi.fn(), '');
    selection();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(control()).toBeUndefined();
    expect(document.getSelection()?.toString()).toBe('  selected\n text  ');
    selection('new');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(control()).toBeUndefined();
  });
  test('does not show during drag or IME composition', () => {
    cleanup = installFloatingSave(document, vi.fn(), '');
    selection();
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('selectionchange'));
    expect(control()).toBeUndefined();
    document.dispatchEvent(new Event('pointerup'));
    expect(control()).toBeDefined();
    document.dispatchEvent(new CompositionEvent('compositionstart'));
    selection('ime');
    expect(control()).toBeUndefined();
    document.dispatchEvent(new CompositionEvent('compositionend'));
    expect(control()).toBeUndefined();
  });
  test('cleared selections and editable selections remove the control', () => {
    cleanup = installFloatingSave(document, vi.fn(), '');
    selection();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    expect(control()).toBeUndefined();
    const p = selection();
    p.setAttribute('contenteditable', 'true');
    document.dispatchEvent(new Event('selectionchange'));
    expect(control()).toBeUndefined();
  });
  test('cleanup removes listeners and UI', () => {
    cleanup = installFloatingSave(document, vi.fn(), '');
    selection();
    cleanup();
    selection('after cleanup');
    expect(control()).toBeUndefined();
  });
});

// Capture native button listeners to deliver browser-shaped trusted events. This
// exercises the same production handlers without adding a test-only trust bypass.
function captureActivation() {
  const original = HTMLButtonElement.prototype.addEventListener;
  let activate: EventListener | undefined;
  vi.spyOn(HTMLButtonElement.prototype, 'addEventListener').mockImplementation(
    function (this: HTMLButtonElement, type, listener, options) {
      if (type === 'click' && typeof listener === 'function')
        activate = listener;
      original.call(this, type, listener, options);
    },
  );
  return () =>
    activate?.({
      isTrusted: true,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as Event);
}
describe('explicit save lifecycle', () => {
  test('sends exact selection once and shows Saved', async () => {
    const activate = captureActivation();
    const send = vi.fn().mockResolvedValue(success);
    cleanup = installFloatingSave(document, send, '');
    selection();
    activate();
    activate();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      content: '  selected\n text  ',
      contentType: 'text',
    });
    await vi.runAllTimersAsync();
    expect(control()).toBeUndefined();
  });
  test('shows safe error and allows explicit retry', async () => {
    const activate = captureActivation();
    const send = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);
    cleanup = installFloatingSave(document, send, '');
    selection();
    activate();
    await Promise.resolve();
    await Promise.resolve();
    expect(control()?.textContent).toBe('Retry');
    expect(
      document.querySelector('[data-ai-clip-save]')?.shadowRoot?.textContent,
    ).toContain('Check the local bridge');
    activate();
    expect(send).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
  });
  test('requires a page reload when the extension context was invalidated', async () => {
    const activate = captureActivation();
    cleanup = installFloatingSave(
      document,
      vi.fn().mockResolvedValue({
        version: 1,
        ok: false,
        error: 'extension_context_invalidated',
      }),
      '',
    );
    selection();
    activate();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      document.querySelector('[data-ai-clip-save]')?.shadowRoot?.textContent,
    ).toContain('Reload this page');
  });
  test('old completion cannot affect a newer selection', async () => {
    let resolve!: (value: CaptureClipResponse) => void;
    const activate = captureActivation();
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<CaptureClipResponse>((done) => {
          resolve = done;
        }),
    );
    cleanup = installFloatingSave(document, send, '');
    selection('first');
    activate();
    selection('second');
    resolve(success);
    await Promise.resolve();
    await Promise.resolve();
    expect(control()?.textContent).toBe('Save');
    expect(send).toHaveBeenCalledTimes(1);
  });
  test('dismissal does not cancel an in-flight save or revive UI', async () => {
    let resolve!: (value: CaptureClipResponse) => void;
    const activate = captureActivation();
    const send = vi.fn().mockImplementation(
      () =>
        new Promise<CaptureClipResponse>((done) => {
          resolve = done;
        }),
    );
    cleanup = installFloatingSave(document, send, '');
    selection();
    activate();
    window.dispatchEvent(new Event('blur'));
    resolve(success);
    await Promise.resolve();
    await Promise.resolve();
    expect(control()).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
