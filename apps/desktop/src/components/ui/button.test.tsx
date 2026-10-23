import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Button } from './button';

afterEach(cleanup);

test('temporary pending buttons block mouse and keyboard activation without disabled dimming', () => {
  const click = vi.fn();
  const { rerender } = render(<Button onClick={click}>Copy</Button>);
  const button = screen.getByRole('button', { name: 'Copy' });
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  rerender(
    <Button pending onClick={click}>
      Copy
    </Button>,
  );
  expect(screen.getByRole('button', { name: 'Copy' })).toBe(button);
  expect(button).toHaveProperty('disabled', true);
  expect(button.hasAttribute('data-pending')).toBe(true);
  expect(button.className).toContain('disabled:opacity-100');
  expect(button.className).not.toContain('disabled:opacity-50');
  for (const key of ['Enter', ' ']) {
    fireEvent.keyDown(button, { key });
    fireEvent.keyUp(button, { key });
    fireEvent.click(button);
  }
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  rerender(<Button onClick={click}>Copy</Button>);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(2);
});

test('genuinely unavailable buttons retain ordinary disabled styling', () => {
  render(<Button disabled>Unavailable</Button>);
  const button = screen.getByRole('button', { name: 'Unavailable' });
  expect(button).toHaveProperty('disabled', true);
  expect(button.hasAttribute('data-pending')).toBe(false);
  expect(button.className).toContain('disabled:opacity-50');
});
