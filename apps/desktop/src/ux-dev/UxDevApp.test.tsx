import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { UpdateNotice } from '../components/UpdateNotice';
import { useUpdater } from '../hooks/useUpdater';
import { fixtureClient } from './fixtureClient';
import { useState } from 'react';
import { UxDevApp } from './UxDevApp';
import { EXTENSION_DISMISSAL_KEY } from '../extensionDiscoveryPreference';

// The dev-only banner test does not mount the native IPC application. Its real
// editor/controller integration remains covered by the full App suites.
vi.mock('../App', () => ({ App: () => null }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});
function Fixture() {
  const [client] = useState(fixtureClient);
  const controls = useUpdater(client);
  return <UpdateNotice controls={controls} />;
}
test('the DEV fixture is explicitly labeled and real update actions are disabled', async () => {
  render(<Fixture />);
  await screen.findByText('Update notification — visual fixture');
  expect(
    screen.getByText(/No update is available from this fixture/),
  ).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Update Now' })
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Later' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Slate update' })).toBeNull(),
  );
});
test('fixture transport actions reject rather than calling IPC or network', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  const client = fixtureClient();
  await expect(client.download()).rejects.toThrow(/disabled/);
  await expect(client.restart!()).rejects.toThrow(/disabled/);
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});

test('development reset removes only its dismissal key and requests a normal restart', () => {
  window.localStorage.setItem(EXTENSION_DISMISSAL_KEY, 'true');
  window.localStorage.setItem('unrelated-synthetic-preference', 'retained');
  render(<UxDevApp />);
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Reset extension suggestion for next restart',
    }),
  );
  expect(window.localStorage.getItem(EXTENSION_DISMISSAL_KEY)).toBeNull();
  expect(window.localStorage.getItem('unrelated-synthetic-preference')).toBe(
    'retained',
  );
  expect(screen.getByRole('status').textContent).toMatch(
    /Save or cancel edits.*quit and reopen/,
  );
});
