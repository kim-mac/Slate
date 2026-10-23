import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { UpdateControls, UpdateSnapshot } from '../updaterClient';
import { UpdateNotice } from './UpdateNotice';
import { UpdateSettings } from './UpdateSettings';

afterEach(cleanup);

const available: UpdateSnapshot = {
  revision: 1,
  phase: 'available',
  currentVersion: '0.1.0',
  availableVersion: '0.2.0',
  downloadedBytes: 0,
  totalBytes: null,
  dismissed: false,
  error: null,
  installationEnabled: false,
};

function controls(change: Partial<UpdateSnapshot> = {}): UpdateControls {
  return {
    state: { ...available, ...change },
    pending: false,
    connectionError: false,
    actionError: null,
    check: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
  };
}

describe('Update notice', () => {
  test('requires an explicit restart click after verification and respects edit blocking', () => {
    const model = controls({ phase: 'ready', installationEnabled: true });
    model.restart = vi.fn(async () => undefined);
    const view = render(<UpdateNotice controls={model} blocked />);
    const button = screen.getByRole('button', { name: 'Restart to update' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(model.restart).not.toHaveBeenCalled();
    view.rerender(<UpdateNotice controls={model} />);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(model.restart).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(model.restart).toHaveBeenCalledOnce();
    expect(model.download).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Installation is disabled in this preview.'),
    ).toBeNull();
  });

  test('preparation prevents additional actions while retaining the sidebar notice', () => {
    const model = controls({ phase: 'preparing', installationEnabled: true });
    render(<UpdateNotice controls={model} />);
    expect(screen.getByRole('status').textContent).toContain(
      'Preparing to restart',
    );
    expect(screen.queryByRole('button', { name: 'Later' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update Now' })).toBeNull();
  });

  test.each(['unconfigured', 'idle', 'checking', 'up_to_date'] as const)(
    'does not show an update notice for %s without an offer',
    (phase) => {
      render(
        <UpdateNotice controls={controls({ phase, availableVersion: null })} />,
      );
      expect(screen.queryByRole('region', { name: 'Slate update' })).toBeNull();
    },
  );

  test('shows a compact available version and explicit download/Later actions', () => {
    const model = controls();
    render(<UpdateNotice controls={model} />);
    expect(screen.getByRole('region', { name: 'Slate update' })).toBeTruthy();
    expect(screen.getByText('Slate 0.2.0 available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update Now' }));
    expect(model.download).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(model.dismiss).toHaveBeenCalledTimes(1);
  });

  test('hides a dismissed offer without removing manual access in About', () => {
    const model = controls({ dismissed: true });
    render(
      <>
        <UpdateNotice controls={model} />
        <UpdateSettings controls={model} />
      </>,
    );
    expect(screen.queryByRole('region', { name: 'Slate update' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
    expect(model.check).toHaveBeenCalledTimes(1);
  });

  test('reports real byte progress and allows cancellation', () => {
    const model = controls({
      phase: 'downloading',
      downloadedBytes: 25,
      totalBytes: 100,
    });
    render(<UpdateNotice controls={model} />);
    const progress = screen.getByRole('progressbar', {
      name: 'Update download',
    }) as HTMLProgressElement;
    expect(progress.value).toBe(25);
    expect(progress.max).toBe(100);
    expect(screen.getByText('Downloading update…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(model.cancel).toHaveBeenCalledTimes(1);
  });

  test('uses indeterminate progress when download size is unknown', () => {
    render(
      <UpdateNotice
        controls={controls({ phase: 'downloading', downloadedBytes: 25 })}
      />,
    );
    expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
  });

  test('shows signature verification separately from download completion', () => {
    render(<UpdateNotice controls={controls({ phase: 'verifying' })} />);
    expect(screen.getByText('Verifying update signature…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update Now' })).toBeNull();
  });

  test('cannot install or restart even after successful verification', () => {
    render(<UpdateNotice controls={controls({ phase: 'ready' })} />);
    expect(
      (
        screen.getByRole('button', {
          name: 'Restart to update',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Installation is disabled in this preview.'),
    ).toBeTruthy();
    expect(screen.getByText('Update verified and ready.')).toBeTruthy();
  });

  test('keeps ready-state Restart and Later in the existing shared action row', () => {
    const model = controls({ phase: 'ready' });
    render(<UpdateNotice controls={model} />);
    const restart = screen.getByRole('button', {
      name: 'Restart to update',
    }) as HTMLButtonElement;
    const later = screen.getByRole('button', {
      name: 'Later',
    }) as HTMLButtonElement;
    expect(restart.parentElement).toBe(later.parentElement);
    expect(
      restart.parentElement?.classList.contains('sidebar-update-actions'),
    ).toBe(true);
    expect(Array.from(restart.parentElement!.children)).toEqual([
      restart,
      later,
    ]);
    expect(restart.disabled).toBe(true);
    expect(later.disabled).toBe(false);
    expect(later.tagName).toBe('BUTTON');
    expect(later.tabIndex).toBe(0);
    later.focus();
    expect(document.activeElement).toBe(later);
    fireEvent.click(restart);
    expect(model.download).not.toHaveBeenCalled();
    expect(model.check).not.toHaveBeenCalled();
    fireEvent.click(later);
    expect(model.dismiss).toHaveBeenCalledOnce();
  });

  test('keeps ready-state details accessible from the collapsed sidebar', () => {
    const expand = vi.fn();
    const model = controls({ phase: 'ready' });
    render(<UpdateNotice controls={model} collapsed onExpand={expand} />);
    const details = screen.getByRole('button', { name: 'Show update details' });
    details.focus();
    expect(document.activeElement).toBe(details);
    fireEvent.click(details);
    expect(expand).toHaveBeenCalledOnce();
    expect(model.download).not.toHaveBeenCalled();
    expect(model.dismiss).not.toHaveBeenCalled();
  });

  test.each(['offline', 'download_failed', 'invalid_signature'])(
    'shows a clear %s failure with retry and no installer action',
    (code) => {
      const model = controls({
        phase: 'error',
        error: { code, message: 'Could not download this update. Try again.' },
      });
      render(<UpdateNotice controls={model} />);
      expect(screen.getByRole('alert').textContent).toContain(
        'Could not download this update.',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(model.download).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole('button', { name: 'Restart to update' }),
      ).toBeNull();
    },
  );

  test('retries a failed check instead of downloading an unknown offer', () => {
    const model = controls({
      phase: 'error',
      availableVersion: null,
      error: { code: 'check_failed', message: 'Could not check for updates.' },
    });
    render(<UpdateNotice controls={model} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(model.check).toHaveBeenCalledTimes(1);
    expect(model.download).not.toHaveBeenCalled();
  });

  test('offers retry after an IPC failure without inventing a backend failure state', () => {
    const model = controls();
    model.actionError = 'The update action could not be completed. Try again.';
    render(<UpdateNotice controls={model} />);
    expect(screen.getByRole('alert').textContent).toBe(model.actionError);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(model.download).toHaveBeenCalledOnce();
  });

  test('does not allow Update Now during an unsaved edit or mutation', () => {
    const model = controls();
    render(<UpdateNotice controls={model} blocked />);
    const button = screen.getByRole('button', {
      name: 'Update Now',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(model.download).not.toHaveBeenCalled();
    expect(
      screen.getByText('Finish your current edit or operation first.'),
    ).toBeTruthy();
  });

  test('provides keyboard-accessible collapsed access without navigating away from drafts', () => {
    const expand = vi.fn();
    const model = controls();
    render(
      <UpdateNotice controls={model} collapsed onExpand={expand} blocked />,
    );
    const button = screen.getByRole('button', { name: 'Show update details' });
    fireEvent.click(button);
    expect(expand).toHaveBeenCalledOnce();
    expect(model.download).not.toHaveBeenCalled();
  });

  test('disables overlapping manual checks while updating', () => {
    const model = controls({ phase: 'downloading' });
    render(<UpdateSettings controls={model} />);
    expect(
      (
        screen.getByRole('button', {
          name: 'Check for Updates',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test('explains the unconfigured checkpoint without claiming no update exists', () => {
    render(
      <UpdateSettings
        controls={controls({ phase: 'unconfigured', availableVersion: null })}
      />,
    );
    expect(
      screen.getByText('Update checking is not configured in this preview.'),
    ).toBeTruthy();
  });
});
