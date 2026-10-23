import { useCallback, useEffect, useRef } from 'react';
import { Button } from './ui/button';

interface ClipFeedbackProps {
  message: string;
  onDismiss: () => void;
  notificationId?: number;
}
export function ClipFeedback({
  message,
  onDismiss,
  notificationId,
}: ClipFeedbackProps) {
  const timer = useRef<number | null>(null);
  const remaining = useRef(4000);
  const deadline = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    deadline.current = Date.now() + remaining.current;
    timer.current = window.setTimeout(onDismiss, remaining.current);
  }, [clearTimer, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timer.current === null) return;
    remaining.current = Math.max(0, deadline.current - Date.now());
    clearTimer();
  }, [clearTimer]);

  const resumeTimer = useCallback(() => {
    if (!hovered.current && !focused.current) startTimer();
  }, [startTimer]);

  useEffect(() => {
    remaining.current = 4000;
    if (!hovered.current && !focused.current) startTimer();
    return clearTimer;
  }, [message, notificationId, startTimer, clearTimer]);

  return (
    <div
      className="clip-feedback"
      onMouseEnter={() => {
        hovered.current = true;
        pauseTimer();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        resumeTimer();
      }}
      onFocus={() => {
        focused.current = true;
        pauseTimer();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        focused.current = false;
        resumeTimer();
      }}
    >
      <p role="status" aria-live="polite" aria-atomic="true">
        <span key={notificationId}>{message}</span>
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
