export type Destination =
  | { readonly state: 'unverified'; readonly url: null }
  | { readonly state: 'verified'; readonly url: string };

export const release = {
  version: '0.1.0',
  extensionVersion: '0.1.1',
  downloads: {
    windowsX64: {
      state: 'verified',
      url: 'https://github.com/kim-mac/Slate/releases/download/v0.1.0/Slate-0.1.0-Windows-x64.exe',
      architecture: 'x64',
      title: 'Windows x64',
      description: 'For Intel & AMD PCs',
      filename: 'Slate-0.1.0-Windows-x64.exe',
      sha256:
        'EE3A0832A002905CCBC5567401093CB1F5D6ED1D209F521B04F418D39594E5DA',
    },
    windowsARM64: {
      state: 'verified',
      url: 'https://github.com/kim-mac/Slate/releases/download/v0.1.0/Slate-0.1.0-Windows-ARM64.exe',
      architecture: 'ARM64',
      title: 'Windows ARM64',
      description: 'For Windows-on-ARM PCs',
      filename: 'Slate-0.1.0-Windows-ARM64.exe',
      sha256:
        'EDD641A2231AE846B224FCE0BAA4B7E11FCFBAA63E75D08B2F6FCD9117CFF57C',
    },
    chrome: {
      state: 'verified',
      url: 'https://chromewebstore.google.com/detail/slate/hgbfaclkpmcecikjepoejgjccddjbekh',
    },
    macOSAppleSilicon: { state: 'unverified', url: null },
  },
} as const satisfies {
  version: string;
  extensionVersion: string;
  downloads: Record<
    string,
    Destination & {
      architecture?: string;
      title?: string;
      description?: string;
      filename?: string;
      sha256?: string;
    }
  >;
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

export const windowsDownloads = ['windowsX64', 'windowsARM64'] as const;
