import type { CaptureClipResponse } from '@ai-clip-memory/shared';

export const CAPTURE_NOTIFICATION_ID = 'ai-clip-memory-capture-result';

type CreateNotification = (
  id: string,
  options: chrome.notifications.NotificationCreateOptions,
) => Promise<string> | void;
type ClearNotification = (id: string) => Promise<boolean> | void;

export async function notifyCaptureResult(
  result: CaptureClipResponse,
  create: CreateNotification = (id, options) =>
    chrome.notifications.create(id, options),
  iconUrl = 'icons/notification.png',
  clear: ClearNotification = (id) => chrome.notifications.clear(id),
): Promise<void> {
  const message = result.ok
    ? 'Clip saved locally.'
    : result.error === 'storage_unavailable'
      ? 'Could not save locally. Make sure AI Clip Memory is installed, then try again.'
      : result.error === 'message_too_large'
        ? 'Selection is too large. Select less text and try again.'
        : 'Could not save this selection. Try again.';
  try {
    await clear(CAPTURE_NOTIFICATION_ID);
  } catch {
    // Clearing is best-effort; creation still provides the current result.
  }
  await create(CAPTURE_NOTIFICATION_ID, {
    type: 'basic',
    iconUrl,
    title: 'AI Clip Memory',
    message,
  });
}
