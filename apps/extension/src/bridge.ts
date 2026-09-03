import {
  BRIDGE_ERROR_CODES,
  BRIDGE_PROTOCOL_VERSION,
  NATIVE_MESSAGING_HOST_NAME,
  type BrowserCapturePayload,
  type BridgeErrorCode,
  type CaptureClipRequest,
  type CaptureClipResponse,
} from '@ai-clip-memory/shared';

export type SendNativeMessage = (
  hostName: string,
  message: CaptureClipRequest,
) => Promise<unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODES = new Set<string>(BRIDGE_ERROR_CODES);

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === [...expectedKeys].sort()[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeFailure(error: BridgeErrorCode): CaptureClipResponse {
  return { version: BRIDGE_PROTOCOL_VERSION, ok: false, error };
}

function parseCaptureResponse(value: unknown): CaptureClipResponse | null {
  if (!isRecord(value) || value.version !== BRIDGE_PROTOCOL_VERSION)
    return null;

  if (value.ok === true) {
    if (!hasExactKeys(value, ['version', 'ok', 'clipId'])) return null;
    return typeof value.clipId === 'string' && UUID_PATTERN.test(value.clipId)
      ? {
          version: BRIDGE_PROTOCOL_VERSION,
          ok: true,
          clipId: value.clipId,
        }
      : null;
  }

  if (value.ok === false) {
    if (!hasExactKeys(value, ['version', 'ok', 'error'])) return null;
    return typeof value.error === 'string' && SAFE_ERROR_CODES.has(value.error)
      ? {
          version: BRIDGE_PROTOCOL_VERSION,
          ok: false,
          error: value.error as BridgeErrorCode,
        }
      : null;
  }

  return null;
}

export function createCaptureRequest(
  payload: BrowserCapturePayload,
): CaptureClipRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'capture_clip',
    payload,
  };
}

export async function sendCaptureToDesktop(
  payload: BrowserCapturePayload,
  sendNativeMessage: SendNativeMessage = (hostName, message) =>
    chrome.runtime.sendNativeMessage(hostName, message),
): Promise<CaptureClipResponse> {
  try {
    const response = await sendNativeMessage(
      NATIVE_MESSAGING_HOST_NAME,
      createCaptureRequest(payload),
    );
    return parseCaptureResponse(response) ?? safeFailure('malformed_message');
  } catch {
    return safeFailure('storage_unavailable');
  }
}
