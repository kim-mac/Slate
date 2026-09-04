import { useEffect } from 'react';
import { Button } from './ui/button';

interface ClipFeedbackProps {
  message: string;
  onDismiss: () => void;
}
export function ClipFeedback({ message, onDismiss }: ClipFeedbackProps) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);
  return (
    <div className="clip-feedback">
      <p role="status" aria-live="polite">
        {message}
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        Dismiss
      </Button>
    </div>
  );
}
