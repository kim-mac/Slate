import type {
  BrowserCapturePayload,
  BrowserSourceApp,
} from '@ai-clip-memory/shared';

export interface BrowserCaptureInput {
  selectionText?: string;
  pageUrl?: string;
  pageTitle?: string;
}

function isDomainOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function detectBrowserSource(url: URL): BrowserSourceApp {
  const hostname = url.hostname.toLowerCase();

  if (
    isDomainOrSubdomain(hostname, 'chatgpt.com') ||
    hostname === 'chat.openai.com'
  ) {
    return 'ChatGPT';
  }
  if (isDomainOrSubdomain(hostname, 'claude.ai')) return 'Claude';
  if (isDomainOrSubdomain(hostname, 'gemini.google.com')) return 'Gemini';
  return 'Other Web';
}

export function createCapturePayload(
  input: BrowserCaptureInput,
): BrowserCapturePayload | null {
  if (!input.selectionText || input.selectionText.trim().length === 0)
    return null;
  if (!input.pageUrl) return null;

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.pageUrl);
  } catch {
    return null;
  }
  if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
    return null;
  }

  return {
    content: input.selectionText,
    contentType: 'text',
    sourceApp: detectBrowserSource(sourceUrl),
    sourceUrl: input.pageUrl,
    sourcePageTitle: input.pageTitle ?? '',
  };
}
