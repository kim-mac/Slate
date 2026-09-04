import type { CaptureClipResponse } from '@ai-clip-memory/shared';
import { createCapturePayload } from './capture';
import {
  createCaptureRequest,
  sendCaptureToDesktop,
  type SendNativeMessage,
} from './bridge';

export const FLOATING_CAPTURE_MESSAGE = 'floating_capture';
const HOSTS = new Set([
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
]);
const MAX_BYTES = 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function approvedUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

export async function handleFloatingCapture(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
  sendNativeMessage?: SendNativeMessage,
): Promise<CaptureClipResponse> {
  const invalid: CaptureClipResponse = {
    version: 1,
    ok: false,
    error: 'invalid_payload',
  };
  if (
    sender.id !== extensionId ||
    !Number.isInteger(sender.tab?.id) ||
    sender.tab!.id! < 0 ||
    sender.frameId !== 0 ||
    !sender.url
  )
    return invalid;
  const senderUrl = approvedUrl(sender.url);
  if (
    !senderUrl ||
    (sender.origin !== undefined && sender.origin !== senderUrl.origin)
  )
    return invalid;
  if (
    !record(message) ||
    !exactKeys(message, ['type', 'payload']) ||
    message.type !== FLOATING_CAPTURE_MESSAGE
  )
    return invalid;
  const value = message.payload;
  if (
    !record(value) ||
    !exactKeys(value, [
      'content',
      'contentType',
      'sourceApp',
      'sourceUrl',
      'sourcePageTitle',
    ])
  )
    return invalid;
  if (
    typeof value.content !== 'string' ||
    value.contentType !== 'text' ||
    typeof value.sourceApp !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    typeof value.sourcePageTitle !== 'string'
  )
    return invalid;
  // Bound individual strings before allocating the serialized native envelope.
  if (
    value.content.length +
      value.sourceUrl.length +
      value.sourcePageTitle.length >
    MAX_BYTES
  )
    return { version: 1, ok: false, error: 'message_too_large' };
  const sourceUrl = approvedUrl(value.sourceUrl);
  if (!sourceUrl || sourceUrl.origin !== senderUrl.origin) return invalid;
  const payload = createCapturePayload({
    selectionText: value.content,
    pageUrl: value.sourceUrl,
    pageTitle: value.sourcePageTitle,
  });
  if (!payload || payload.sourceApp !== value.sourceApp) return invalid;
  if (
    new TextEncoder().encode(JSON.stringify(createCaptureRequest(payload)))
      .byteLength > MAX_BYTES
  )
    return { version: 1, ok: false, error: 'message_too_large' };
  return sendCaptureToDesktop(payload, sendNativeMessage);
}
