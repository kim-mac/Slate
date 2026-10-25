import { initializeDownloads } from './downloads.ts';
import { release, downloadUrl } from '../data/releases.ts';

const initialized = new WeakSet<ParentNode>();
const manualFallback = 'Choose your Windows installer to download manually.';

/** A one-shot request from the homepage opt-in; the static links always work. */
export async function initializeWindowsDownloadGuide(
  root: HTMLElement,
  browser: Parameters<typeof initializeDownloads>[1],
  window: Pick<Window, 'location' | 'history'>,
) {
  if (initialized.has(root)) return;
  initialized.add(root);
  const status = root.querySelector<HTMLElement>('[data-download-status]');
  const announce = (message: string) => {
    if (status) status.textContent = message;
  };
  const url = new URL(window.location.href);
  const flags = url.searchParams.getAll('start');
  const optedIn = flags.length === 1 && flags[0] === '1';

  // Consume even malformed/duplicate flags. Never continue if history is blocked.
  if (flags.length) {
    url.searchParams.delete('start');
    try {
      window.history.replaceState(window.history.state, '', url.href);
    } catch {
      announce(manualFallback);
      void initializeDownloads(root, { clipboard: browser.clipboard });
      return;
    }
  }

  const document = root.ownerDocument;
  let cancelled = document.visibilityState !== 'visible';
  root
    .querySelectorAll<HTMLAnchorElement>('[data-windows-installer] a[download]')
    .forEach((link) => {
      const cancelAutomaticRequest = () => {
        cancelled = true;
        announce('Manual download selected. Check your browser’s downloads.');
      };
      link.addEventListener('click', cancelAutomaticRequest);
      link.addEventListener('auxclick', cancelAutomaticRequest);
    });
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') {
      cancelled = true;
      announce(manualFallback);
    }
  };
  root
    .querySelector<HTMLAnchorElement>('[data-manual-download]')
    ?.addEventListener('click', () => {
      cancelled = true;
      const options = root.querySelector<HTMLDetailsElement>(
        '[data-download-options]',
      );
      if (options) options.open = true;
      announce(manualFallback);
    });
  document.addEventListener('visibilitychange', onVisibility);
  if (optedIn && !cancelled)
    announce('Checking which Windows installer fits your PC…');
  const architecture = await initializeDownloads(root, browser);
  document.removeEventListener('visibilitychange', onVisibility);
  if (
    !optedIn ||
    cancelled ||
    !architecture ||
    document.visibilityState !== 'visible'
  ) {
    if (!cancelled) announce(manualFallback);
    return;
  }
  // Neither the URL query nor DOM attributes can supply a download destination.
  const artifact = release.downloads[architecture];
  const destination = downloadUrl(artifact);
  if (!destination) {
    announce(manualFallback);
    return;
  }
  try {
    window.location.assign(destination);
    announce('Your download should start automatically.');
  } catch {
    announce(manualFallback);
  }
}
