export const APP_NAME = 'AI Clip Memory';

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
  contentType: 'text';
  sourceApp: BrowserSourceApp;
  sourceUrl: string;
  sourcePageTitle: string;
}

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
