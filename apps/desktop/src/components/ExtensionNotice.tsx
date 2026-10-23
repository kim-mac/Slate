import { ExternalLink, Puzzle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  persistExtensionDismissal,
  readExtensionDismissal,
} from '../extensionDiscoveryPreference';
import { Button } from './ui/button';

export function ExtensionNotice({
  onOpen,
  collapsed,
  onExpand,
  onDismissFocus,
}: {
  onOpen: () => Promise<void>;
  collapsed: boolean;
  onExpand: () => void;
  onDismissFocus: () => void;
}) {
  const [preference, setPreference] = useState(readExtensionDismissal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = useRef(false);
  const dismissed = useRef(preference.dismissed);
  const mounted = useRef(true);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function dismiss() {
    if (dismissed.current) return;
    dismissed.current = true;
    // Focus only moves if it was inside the disappearing card. Never bring Slate
    // back to the foreground after successfully opening the default browser.
    const restoreFocus =
      card.current?.contains(document.activeElement) && document.hasFocus();
    setPreference({ dismissed: true, warning: persistExtensionDismissal() });
    if (restoreFocus) onDismissFocus();
  }

  async function open() {
    if (opening.current || dismissed.current) return;
    opening.current = true;
    setPending(true);
    setError(null);
    try {
      await onOpen();
      if (mounted.current) dismiss();
    } catch {
      if (mounted.current)
        setError(
          'Could not open the extension listing. Finish any current edit, then try again.',
        );
    } finally {
      opening.current = false;
      if (mounted.current) setPending(false);
    }
  }

  if (preference.dismissed) {
    return preference.warning ? (
      <p className="sidebar-extension-feedback" role="status">
        {preference.warning}
      </p>
    ) : null;
  }
  if (collapsed) {
    return (
      <div className="sidebar-extension-collapsed">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Show browser extension suggestion"
          title="Save from your browser"
          onClick={onExpand}
        >
          <Puzzle aria-hidden="true" />
        </Button>
      </div>
    );
  }
  return (
    <section
      ref={card}
      className="sidebar-extension-card"
      aria-label="Browser extension suggestion"
    >
      <p className="sidebar-extension-title">
        <Puzzle aria-hidden="true" />
        <span>Save from your browser</span>
      </p>
      <Button
        type="button"
        className="sidebar-extension-dismiss"
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss extension suggestion"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
      <p className="sidebar-extension-description">
        Slate works with the browser extension. Save text from the web directly
        to your clips.
      </p>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void open()}
        disabled={pending}
      >
        Get the extension
        <ExternalLink aria-hidden="true" />
      </Button>
      {error && (
        <p className="sidebar-extension-feedback" role="status">
          {error}
        </p>
      )}
      {preference.warning && (
        <p className="sidebar-extension-feedback" role="status">
          {preference.warning}
        </p>
      )}
    </section>
  );
}
