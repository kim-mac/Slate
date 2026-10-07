type WindowsInstaller = 'windowsX64' | 'windowsARM64';
type ArchitectureHints = {
  platform?: string;
  architecture?: string;
  bitness?: string;
};
type DownloadNavigator = {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<ArchitectureHints>;
  };
  clipboard?: Pick<Clipboard, 'writeText'>;
};

/** No UA-string fallback: missing or ambiguous hints must not become a guess. */
export function recommendedArchitecture(
  hints?: ArchitectureHints,
): WindowsInstaller | null {
  if (hints?.platform !== 'Windows' || hints.bitness !== '64') return null;
  if (hints.architecture === 'x86') return 'windowsX64';
  if (hints.architecture === 'arm') return 'windowsARM64';
  return null;
}

export async function detectArchitecture(
  browser: DownloadNavigator,
): Promise<WindowsInstaller | null> {
  const data = browser.userAgentData;
  if (data?.platform !== 'Windows' || !data.getHighEntropyValues) return null;
  try {
    return recommendedArchitecture(
      await data.getHighEntropyValues(['architecture', 'bitness']),
    );
  } catch {
    return null;
  }
}

/** Local progressive enhancement only; never hides options or persists hints. */
export function initializeDownloads(
  root: ParentNode,
  browser: DownloadNavigator,
) {
  void detectArchitecture(browser).then((id) => {
    if (!id) return;
    const card = root.querySelector<HTMLElement>(
      `[data-windows-installer="${id}"]`,
    );
    if (!card) return;
    card.dataset.recommended = 'true';
    const badge = card.querySelector<HTMLElement>('[data-recommendation]');
    if (badge) badge.hidden = false;
  });

  root
    .querySelectorAll<HTMLButtonElement>('[data-copy-hash]')
    .forEach((button) => {
      const label = button.querySelector<HTMLElement>('[data-copy-label]');
      const status = button
        .closest('article')
        ?.querySelector<HTMLElement>('[data-copy-status]');
      let busy = false;
      let reset: ReturnType<typeof setTimeout> | undefined;
      button.addEventListener('click', async () => {
        if (busy) return;
        const hash = button.dataset.copyHash;
        if (!hash || !label || !status) return;
        busy = true;
        clearTimeout(reset);
        try {
          if (!browser.clipboard) throw new Error('Clipboard unavailable');
          await browser.clipboard.writeText(hash);
          label.textContent = 'Copied';
          status.textContent = 'SHA-256 copied.';
          reset = setTimeout(() => {
            label.textContent = 'Copy';
            status.textContent = '';
          }, 2000);
        } catch {
          label.textContent = 'Copy';
          status.textContent = 'Could not copy. Expand SHA-256 to select it.';
        } finally {
          busy = false;
        }
      });
    });
}
