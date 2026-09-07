import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ClipFeedback } from './ClipFeedback';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test('announces success and expires after four seconds', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  render(<ClipFeedback message="Clip copied." onDismiss={dismiss} />);
  expect(screen.getByRole('status').textContent).toContain('Clip copied.');
  act(() => vi.advanceTimersByTime(3999));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
test('can be dismissed and cancels its timer on unmount', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const { unmount } = render(
    <ClipFeedback message="Clip saved." onDismiss={dismiss} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  unmount();
  act(() => vi.advanceTimersByTime(4000));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
test('replacement resets expiry', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const { rerender } = render(
    <ClipFeedback message="Clip saved." onDismiss={dismiss} />,
  );
  act(() => vi.advanceTimersByTime(3000));
  rerender(<ClipFeedback message="Clip copied." onDismiss={dismiss} />);
  act(() => vi.advanceTimersByTime(1000));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(3000));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
test('pauses expiry while hovered and resumes for the remaining time', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  render(<ClipFeedback message="Clip copied." onDismiss={dismiss} />);
  const feedback = screen.getByRole('status').closest('.clip-feedback')!;
  act(() => vi.advanceTimersByTime(1500));
  fireEvent.mouseEnter(feedback);
  act(() => vi.advanceTimersByTime(5000));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(feedback);
  act(() => vi.advanceTimersByTime(2499));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
test('pauses expiry while keyboard focus remains inside the feedback', () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  render(<ClipFeedback message="Clip saved." onDismiss={dismiss} />);
  const dismissButton = screen.getByRole('button', {
    name: 'Dismiss notification',
  });
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.focus(dismissButton);
  act(() => vi.advanceTimersByTime(5000));
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.blur(dismissButton);
  act(() => vi.advanceTimersByTime(2999));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledTimes(1);
});
