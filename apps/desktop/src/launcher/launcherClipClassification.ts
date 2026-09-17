import type { ClipContentType } from '@ai-clip-memory/shared';

export function isSingleHttpUrl(content: string): boolean {
  const candidate = content.trim();
  if (!candidate || /\s/.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function automaticContentType(content: string): ClipContentType {
  return isSingleHttpUrl(content) ? 'link' : 'text';
}
