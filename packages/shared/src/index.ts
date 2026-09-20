export const APP_NAME = 'Slate';

export const CLIP_CONTENT_TYPES = ['text', 'code', 'prompt', 'link'] as const;

export type ClipContentType = (typeof CLIP_CONTENT_TYPES)[number];

export const BROWSER_SOURCE_APPS = [
  'ChatGPT',
  'Claude',
  'Gemini',
  'Other Web',
] as const;

export type BrowserSourceApp = (typeof BROWSER_SOURCE_APPS)[number];

export interface BrowserCapturePayload {
  content: string;
  contentType: 'text' | 'link';
  sourceApp: BrowserSourceApp;
  sourceUrl: string;
  sourcePageTitle: string;
}

export const NATIVE_MESSAGING_HOST_NAME = 'com.aiclipmemory.bridge';

export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export const BRIDGE_ERROR_CODES = [
  'malformed_message',
  'malformed_json',
  'message_too_large',
  'unsupported_version',
  'unsupported_message_type',
  'invalid_payload',
  'invalid_content',
  'invalid_content_type',
  'invalid_source_app',
  'invalid_source_url',
  'storage_unavailable',
] as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export interface CaptureClipRequest {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: 'capture_clip';
  payload: BrowserCapturePayload;
}

export type CaptureClipResponse =
  | {
      version: typeof BRIDGE_PROTOCOL_VERSION;
      ok: true;
      clipId: string;
    }
  | {
      version: typeof BRIDGE_PROTOCOL_VERSION;
      ok: false;
      error: BridgeErrorCode;
    };

export interface ClipInput {
  content: string;
  contentType: ClipContentType;
  title: string | null;
  sourceApp: string | null;
  sourceUrl: string | null;
  sourcePageTitle: string | null;
}

export interface Clip extends ClipInput {
  id: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}
