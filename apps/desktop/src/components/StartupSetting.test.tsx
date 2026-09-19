import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { StartupSetting } from './StartupSetting';
import type { StartupClient } from '../startupClient';

afterEach(cleanup);

function fakeStartupClient(initial: boolean) {
  let actual = initial;
  const getEnabled = vi.fn(async () => actual);
  const setEnabled = vi.fn(async (enabled: boolean) => {
    actual = enabled;
    return actual;
  });
  return {
    client: { getEnabled, setEnabled } satisfies StartupClient,
    getEnabled,
    setEnabled,
  };
}

test('renders the actual Windows autostart state', async () => {
  const { client, getEnabled } = fakeStartupClient(true);

  render(<StartupSetting client={client} />);

  const control = await screen.findByRole('switch', {
    name: 'Start Slate when I sign in to Windows',
  });
  expect(control.getAttribute('aria-checked')).toBe('true');
  expect(getEnabled).toHaveBeenCalledTimes(1);
});

test('enables autostart and re-reads the actual state', async () => {
  const { client, getEnabled, setEnabled } = fakeStartupClient(false);
  render(<StartupSetting client={client} />);

  const control = await screen.findByRole('switch', {
    name: 'Start Slate when I sign in to Windows',
  });
  fireEvent.click(control);

  await waitFor(() =>
    expect(control.getAttribute('aria-checked')).toBe('true'),
  );
  expect(setEnabled).toHaveBeenCalledWith(true);
  expect(getEnabled).toHaveBeenCalledTimes(2);
});

test('re-reads OS state after an update fails and shows a safe retryable error', async () => {
  const getEnabled = vi.fn().mockResolvedValue(false);
  const setEnabled = vi.fn().mockRejectedValue(new Error('registry details'));
  const client = { getEnabled, setEnabled } satisfies StartupClient;
  render(<StartupSetting client={client} />);

  const control = await screen.findByRole('switch', {
    name: 'Start Slate when I sign in to Windows',
  });
  fireEvent.click(control);

  expect(
    await screen.findByText('Windows startup could not be updated. Try again.'),
  ).toBeTruthy();
  expect(screen.queryByText(/registry details/i)).toBeNull();
  expect(control.getAttribute('aria-checked')).toBe('false');
  expect(getEnabled).toHaveBeenCalledTimes(2);
});

test('handles an initial state read failure without showing a fake boolean', async () => {
  const getEnabled = vi.fn().mockRejectedValue(new Error('registry details'));
  const setEnabled = vi.fn();
  const client = { getEnabled, setEnabled } satisfies StartupClient;
  render(<StartupSetting client={client} />);

  expect(
    await screen.findByText('Windows startup status is unavailable.'),
  ).toBeTruthy();
  expect(
    screen.queryByRole('switch', {
      name: 'Start Slate when I sign in to Windows',
    }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(getEnabled).toHaveBeenCalledTimes(2);
});
