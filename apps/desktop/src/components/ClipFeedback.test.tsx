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
