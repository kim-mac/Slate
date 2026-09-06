import {
  BRIDGE_ERROR_CODES,
  type CaptureClipResponse,
} from '@ai-clip-memory/shared';

export type FloatingCaptureResult =
  | CaptureClipResponse
  | { version: 1; ok: false; error: 'extension_context_invalidated' };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function sendFloatingCaptureMessage(
  message: unknown,
  send: (message: unknown) => Promise<unknown> = (value) =>
    chrome.runtime.sendMessage(value),
): Promise<FloatingCaptureResult> {
  let response: unknown;
  try {
    response = await send(message);
  } catch {
    return { version: 1, ok: false, error: 'extension_context_invalidated' };
  }
  if (
    typeof response !== 'object' ||
    response === null ||
    !('version' in response) ||
    response.version !== 1 ||
    !('ok' in response)
  )
    return { version: 1, ok: false, error: 'malformed_message' };
  if (
    response.ok === true &&
    'clipId' in response &&
    typeof response.clipId === 'string' &&
    UUID_PATTERN.test(response.clipId)
  )
    return { version: 1, ok: true, clipId: response.clipId };
  if (response.ok === false && 'error' in response) {
    const error = BRIDGE_ERROR_CODES.find((code) => code === response.error);
    if (error) return { version: 1, ok: false, error };
  }
  return { version: 1, ok: false, error: 'malformed_message' };
}
