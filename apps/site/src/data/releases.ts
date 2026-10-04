export type Destination =
  | { readonly state: 'unverified'; readonly url: null }
  | { readonly state: 'verified'; readonly url: string };

export const release = {
  version: '0.1.0',
  downloads: {
    windowsX64: { state: 'unverified', url: null },
    windowsARM64: { state: 'unverified', url: null },
    chrome: { state: 'unverified', url: null },
    macOSAppleSilicon: { state: 'unverified', url: null },
  },
} as const satisfies {
  version: string;
  downloads: Record<string, Destination>;
};

/** Only explicitly verified HTTPS destinations can be rendered as download links. */
export function downloadUrl(destination: {
  state: string;
  url: string | null;
}): string | null {
  if (destination.state !== 'verified' || !destination.url) return null;
  try {
    const parsed = new URL(destination.url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export const publicDownloads = [
  {
    id: 'windowsX64',
    title: 'Windows x64',
    detail: 'Intel & AMD PCs',
    label: 'Download x64',
  },
  {
    id: 'windowsARM64',
    title: 'Windows ARM64',
    detail: 'Windows-on-ARM PCs',
    label: 'Download ARM64',
  },
  {
    id: 'chrome',
    title: 'Chrome extension',
    detail: 'Pairs with the desktop app',
    label: 'Add to Chrome',
  },
] as const;
