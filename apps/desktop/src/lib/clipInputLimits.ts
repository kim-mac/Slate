import type { ClipInput } from '@ai-clip-memory/shared';

export const MAX_CLIP_CONTENT_BYTES = 1024 * 1024;
export const MAX_CLIP_METADATA_BYTES = 16 * 1024;

const utf8Length = (value: string) =>
  new TextEncoder().encode(value).byteLength;

export function validateClipInputSize(input: ClipInput): string | null {
  if (utf8Length(input.content) > MAX_CLIP_CONTENT_BYTES)
    return 'Clip content must be 1 MiB or less in UTF-8.';
  for (const value of [
    input.title,
    input.sourceApp,
    input.sourceUrl,
    input.sourcePageTitle,
  ]) {
    if (value !== null && utf8Length(value) > MAX_CLIP_METADATA_BYTES)
      return 'Each optional metadata field must be 16 KiB or less in UTF-8.';
  }
  return null;
}
