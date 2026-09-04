import { useEffect, useState } from 'react';
import { getLauncherStatus } from '../launcher/launcherClient';

export function LauncherAvailability() {
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getLauncherStatus()
      .then((status) => {
        if (active)
          setFailure(
            !status.available && status.errorCode !== 'unsupported_platform'
              ? status.errorCode
              : null,
          );
      })
      .catch(() => {
        /* Browser-only previews have no native shortcut controller. */
      });
    return () => {
      active = false;
    };
  }, []);
  if (!failure) return null;
  return (
    <div
      role="alert"
      className="mx-4 mb-2 shrink-0 rounded-lg border border-border p-2 text-sm"
    >
      {failure === 'shortcut_unavailable'
        ? 'Quick search (Ctrl+Shift+Space) is unavailable. Another app may be using the shortcut. Close that app and restart AI Clip Memory to retry.'
        : 'Quick search could not start. Restart AI Clip Memory to retry.'}{' '}
      The clip library is still available.
    </div>
  );
}
