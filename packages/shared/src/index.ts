export const APP_NAME = 'AI Clip Memory';

export const CLIP_CONTENT_TYPES = ['text', 'code', 'prompt', 'link'] as const;

export type ClipContentType = (typeof CLIP_CONTENT_TYPES)[number];

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
