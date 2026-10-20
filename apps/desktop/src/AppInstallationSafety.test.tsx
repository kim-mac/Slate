import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { tauriClipClient } from './clipClient';
import {
  deferred,
  installationSafetyFixture,
  safetyClip,
} from './test/installationSafety';

vi.mock('./launcher/launcherClient', () => ({
  getLauncherStatus: vi.fn(async () => ({
    available: true,
    shortcut: 'Ctrl+Shift+Space',
    errorCode: null,
  })),
}));
afterEach(cleanup);

function setup(withClip = false) {
  const safety = installationSafetyFixture();
  const client = {
    ...tauriClipClient,
    list: vi.fn(async () =>
      withClip ? [{ kind: 'clip' as const, clip: safetyClip }] : [],
    ),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  render(
    <App
      client={client}
      safetyClient={safety.client}
      startupClient={{
        getEnabled: async () => false,
        setEnabled: async (v) => v,
      }}
    />,
  );
  return { safety, client };
}

test('main acquires a lease before opening Create, including repeated clicks', async () => {
  const { safety } = setup();
  const pending = deferred<{ generation: number; leaseId: number }>();
  safety.client.acquire = vi.fn(() => pending.promise);
  const button = await screen.findByRole('button', { name: 'New clip' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(safety.client.acquire).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => pending.resolve({ generation: 1, leaseId: 1 }));
  expect(
    await screen.findByRole('dialog', { name: 'Create clip' }),
  ).toBeTruthy();
});

test('main Edit keeps its unchanged editor lease, including after a failed edit save', async () => {
  const { safety, client } = setup(true);
  client.update.mockRejectedValue(new Error('synthetic edit failure'));
  fireEvent.click(
    (
      await screen.findByText(safetyClip.content, {
        selector: '.clip-list-preview',
      })
    ).closest('button')!,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByRole('dialog', { name: 'Edit clip' });
  expect(safety.client.acquire).toHaveBeenCalledWith(1, 'editor');
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  act(() => safety.emit({ generation: 2, preparing: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('The local clip operation could not be completed.');
  expect(safety.client.release).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
});

test('main destructive confirmation blocks preparation until explicit cancellation', async () => {
  const { safety, client } = setup(true);
  fireEvent.click(
    (
      await screen.findByText(safetyClip.content, {
        selector: '.clip-list-preview',
      })
    ).closest('button')!,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('alertdialog');
  expect(safety.client.acquire).toHaveBeenCalledWith(1, 'confirmation');
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(safety.client.acknowledge).toHaveBeenCalledWith(1, 1),
  );
  expect(client.delete).not.toHaveBeenCalled();
});

test('main keeps an unsaved draft and its lease on save failure and preparation', async () => {
  const { safety, client } = setup();
  client.create.mockRejectedValue(new Error('synthetic save failure'));
  const button = await screen.findByRole('button', { name: 'New clip' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('dialog', { name: 'Create clip' });
  fireEvent.change(screen.getByLabelText('Content'), {
    target: { value: 'Synthetic draft retained' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save clip' }));
  await screen.findByText('The local clip operation could not be completed.');
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(screen.getByLabelText<HTMLTextAreaElement>('Content').value).toBe(
    'Synthetic draft retained',
  );
  expect(safety.client.release).not.toHaveBeenCalled();
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
});

test('main releases after explicit cancellation without saving the draft', async () => {
  const { safety, client } = setup();
  const button = await screen.findByRole('button', { name: 'New clip' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('dialog', { name: 'Create clip' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(client.create).not.toHaveBeenCalled();
});

test('main holds its editor lease through an outstanding save and releases only on success', async () => {
  const { safety, client } = setup();
  const saved = deferred<object>();
  client.create.mockReturnValue(saved.promise);
  const button = await screen.findByRole('button', { name: 'New clip' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('dialog', { name: 'Create clip' });
  fireEvent.change(screen.getByLabelText('Content'), {
    target: { value: 'Synthetic saved note' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save clip' }));
  await waitFor(() => expect(client.create).toHaveBeenCalledOnce());
  expect(safety.client.release).not.toHaveBeenCalled();
  await act(async () =>
    saved.resolve({
      id: 'saved',
      content: 'Synthetic saved note',
      contentType: 'text',
      title: null,
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
      isPinned: false,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    }),
  );
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('main retries a completed save lease release without repeating the create', async () => {
  const { safety, client } = setup();
  client.create.mockResolvedValue(safetyClip);
  safety.client.release = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic release failure'))
    .mockResolvedValue(undefined);
  const button = await screen.findByRole('button', { name: 'New clip' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await screen.findByRole('dialog', { name: 'Create clip' });
  fireEvent.change(screen.getByLabelText('Content'), {
    target: { value: safetyClip.content },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save clip' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  act(() => safety.emit({ generation: 2, preparing: false }));
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  await screen.findByRole('dialog', { name: 'Create clip' });
  expect(safety.client.release).toHaveBeenCalledTimes(2);
  expect(safety.client.acquire).toHaveBeenCalledTimes(2);
  expect(client.create).toHaveBeenCalledOnce();
});
