import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { StartupClient } from '../startupClient';
import { SettingsView } from './SettingsView';

afterEach(cleanup);

function startupClient(enabled = false): StartupClient {
  return {
    getEnabled: vi.fn(async () => enabled),
    setEnabled: vi.fn(async (next) => next),
  };
}

describe('SettingsView', () => {
  test('documents the approved Slate workflows and verified Windows shortcuts in order', async () => {
    render(
      <SettingsView
        startupClient={startupClient()}
        readVersion={async () => '0.1.0'}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    for (const heading of [
      'Keyboard Shortcuts',
      'How to Use Slate',
      'Background & Startup',
      'Privacy & Data',
      'About',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }

    const shortcuts = screen.getByLabelText('Keyboard shortcuts');
    const labels = within(shortcuts)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(labels).toEqual([
      'Open Quick Search',
      'Save selected text from the active app',
      'Move through results',
      'Copy selected clip',
      'Save Quick Capture / Quick Edit',
      'Go back / close',
      'Copy selected preview text',
      'Focus search',
      'Copy open clip',
      'Show / hide sidebar',
    ]);
    expect(shortcuts.textContent).toContain('CtrlShiftSpace');
    expect(shortcuts.textContent).toContain('CtrlAltShiftC');
    expect(shortcuts.textContent).toContain('↑↓');
    expect(shortcuts.textContent).toContain('CtrlEnter');
    expect(shortcuts.textContent).toContain('CtrlShiftC');
    expect(shortcuts.textContent).toContain('CtrlB');
    expect(shortcuts.textContent).not.toContain('Cmd');

    expect(
      screen.getByText((_, element) =>
        Boolean(
          element?.tagName === 'P' &&
          element.textContent?.includes('right-click') &&
          element.textContent?.includes('Save this page'),
        ),
      ),
    ).toBeTruthy();
    expect(screen.getByText('Save selection')).toBeTruthy();
    expect(screen.getByText('Save this page')).toBeTruthy();
    expect(screen.getByText(/floating Save control/)).toBeTruthy();
    for (const heading of [
      'Save from your browser',
      'Capture from a Windows app',
      'Quick Capture',
      'Find and reuse',
      'Edit and delete',
      'Calendar',
      'Runs in the background',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(
      screen.getAllByText(/keeps Slate running in the background/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Windows app data folder/)).toBeTruthy();
    expect(screen.getByText(/not encrypted by Slate/)).toBeTruthy();

    expect(await screen.findByText('Version 0.1.0')).toBeTruthy();
    expect(
      screen.getByText(
        'Local-first capture for things you want to find again.',
      ),
    ).toBeTruthy();
  });

  test('shows a safe About fallback when version metadata is unavailable', async () => {
    render(
      <SettingsView
        startupClient={startupClient()}
        readVersion={async () => {
          throw new Error('private runtime detail');
        }}
      />,
    );

    expect(await screen.findByText('Version unavailable')).toBeTruthy();
    expect(screen.queryByText('private runtime detail')).toBeNull();
  });

  test('keeps the real startup toggle inside Background & Startup with Slate copy', async () => {
    const client = startupClient(true);
    render(
      <SettingsView startupClient={client} readVersion={async () => '0.1.0'} />,
    );

    const toggle = await screen.findByRole('switch', {
      name: 'Start Slate when I sign in to Windows',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText('Keep Slate ready for quick capture after you sign in.'),
    ).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(client.setEnabled).toHaveBeenCalledWith(false));
  });
});
