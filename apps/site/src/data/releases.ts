export type Destination =
  | { readonly state: 'unverified'; readonly url: null }
  | { readonly state: 'verified'; readonly url: string };

export const release = {
  version: '0.3.1',
  extensionVersion: '0.1.1',
  downloads: {
    windowsX64: {
      state: 'verified',
      url: 'https://github.com/kim-mac/Slate/releases/download/v0.3.1/Slate-0.3.1-Windows-x64.exe',
      architecture: 'x64',
      title: 'Windows x64',
      description: 'For Intel & AMD PCs',
      filename: 'Slate-0.3.1-Windows-x64.exe',
      sha256:
        '98726C7C7549B6112DB84657E8AE8F8D54DFD22909C85EB854E021884176DAE8',
    },
    windowsARM64: {
      state: 'verified',
      url: 'https://github.com/kim-mac/Slate/releases/download/v0.3.1/Slate-0.3.1-Windows-ARM64.exe',
      architecture: 'ARM64',
      title: 'Windows ARM64',
      description: 'For Windows-on-ARM PCs',
      filename: 'Slate-0.3.1-Windows-ARM64.exe',
      sha256:
        '16630847830DC275B07751197CEC10B63E0356D5ED6E18820EE045367B59E6B8',
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
