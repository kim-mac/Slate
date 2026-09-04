import {
  BRIDGE_ERROR_CODES,
  type CaptureClipResponse,
} from '@ai-clip-memory/shared';
import { installFloatingSave } from './floatingSave';
import styles from './floatingSave.css?inline';

installFloatingSave(
  document,
  async (payload): Promise<CaptureClipResponse> => {
    const response: unknown = await chrome.runtime.sendMessage({
      type: 'floating_capture',
      payload,
    });
    if (
      typeof response === 'object' &&
      response !== null &&
      'version' in response &&
      response.version === 1 &&
      'ok' in response
    ) {
      if (
        response.ok === true &&
        'clipId' in response &&
        typeof response.clipId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          response.clipId,
        )
      ) {
        return { version: 1, ok: true, clipId: response.clipId };
      }
      if (response.ok === false && 'error' in response) {
        const error = BRIDGE_ERROR_CODES.find(
          (code) => code === response.error,
        );
        if (error) return { version: 1, ok: false, error };
      }
    }
    return { version: 1, ok: false, error: 'malformed_message' };
  },
  styles,
);
