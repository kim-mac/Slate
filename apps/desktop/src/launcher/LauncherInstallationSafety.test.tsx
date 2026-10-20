import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Launcher } from './Launcher';
import type { LauncherState } from './launcherClient';
import {
  deferred,
  installationSafetyFixture,
  safetyClip,
} from '../test/installationSafety';

afterEach(cleanup);
function setup(withClip = false) {
  const safety = installationSafetyFixture();
  let receive!: (state: LauncherState) => void;
  const host = {
    listen: vi.fn(async (handler: typeof receive) => {
      receive = handler;
      return vi.fn();
    }),
    ready: vi.fn(async () => ({ session: 1, visible: true })),
    hide: vi.fn(async (): Promise<void> => undefined),
    openTin: vi.fn(async (): Promise<void> => undefined),
  };
  const client = {
    list: vi.fn(async () =>
      withClip ? [{ kind: 'clip' as const, clip: safetyClip }] : [],
    ),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    copyContent: vi.fn(),
    openSource: vi.fn(),
  };
  render(<Launcher host={host} client={client} safetyClient={safety.client} />);
  return {
    safety,
    host,
    client,
    emit: (next: LauncherState) => act(() => receive(next)),
  };
}

test('Quick Search acquires before opening an editor and ignores duplicate clicks', async () => {
  const { safety } = setup();
  const pending = deferred<{ generation: number; leaseId: number }>();
  safety.client.acquire = vi.fn(() => pending.promise);
  const button = await screen.findByRole('button', { name: 'New clip' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(safety.client.acquire).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('textbox', { name: 'Content' })).toBeNull();
  await act(async () => pending.resolve({ generation: 1, leaseId: 1 }));
  expect(await screen.findByRole('textbox', { name: 'Content' })).toBeTruthy();
});

test('Quick Search Edit keeps its lease after a failed save and explicit Cancel releases it', async () => {
  const { safety, client } = setup(true);
  client.update.mockRejectedValue(new Error('synthetic edit failure'));
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Synthetic safety note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit selected clip' }));
  await screen.findByRole('textbox', { name: 'Content' });
  expect(safety.client.acquire).toHaveBeenCalledWith(1, 'editor');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Clip could not be saved.');
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  expect(safety.client.release).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(safety.client.acknowledge).toHaveBeenCalledWith(1, 1),
  );
  expect(await screen.findByRole('searchbox')).toBeTruthy();
});

test('Quick Search holds a confirmation lease through asynchronous delete completion', async () => {
  const { safety, client } = setup(true);
  const pending = deferred<void>();
  client.delete.mockReturnValue(pending.promise);
  const search = await screen.findByRole('searchbox');
  await screen.findByRole('option', { name: /Synthetic safety note/ });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected clip' }));
  await screen.findByRole('alertdialog');
  expect(safety.client.acquire).toHaveBeenCalledWith(1, 'confirmation');
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(client.delete).toHaveBeenCalledOnce());
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.release).not.toHaveBeenCalled();
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await waitFor(() =>
    expect(safety.client.acknowledge).toHaveBeenCalledWith(1, 1),
  );
});

test('Quick Search retains failed-save draft and blocks a clean preparation ack', async () => {
  const { safety, client } = setup();
  client.create.mockRejectedValue(new Error('synthetic save failure'));
  fireEvent.click(await screen.findByRole('button', { name: 'New clip' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Content' }), {
    target: { value: 'Synthetic unsaved launcher note' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Clip could not be saved.');
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Content' }).value,
  ).toBe('Synthetic unsaved launcher note');
  expect(safety.client.release).not.toHaveBeenCalled();
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
});

test('Quick Search keeps a hidden editor draft across native hide and a later session', async () => {
  const { safety, emit } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'New clip' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Content' }), {
    target: { value: 'Synthetic hidden draft' },
  });
  emit({ session: 1, visible: false });
  expect(safety.client.release).not.toHaveBeenCalled();
  emit({ session: 2, visible: true });
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Content' }).value,
  ).toBe('Synthetic hidden draft');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
  expect(await screen.findByRole('searchbox')).toBeTruthy();
});

test('Quick Search does not close or release the editor while saving', async () => {
  const { safety, client, host } = setup();
  const pending = deferred<object>();
  client.create.mockReturnValue(pending.promise);
  fireEvent.click(await screen.findByRole('button', { name: 'New clip' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Content' }), {
    target: { value: 'Synthetic pending save' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(client.create).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Close Quick Search' }));
  expect(host.hide).not.toHaveBeenCalled();
  expect(safety.client.release).not.toHaveBeenCalled();
  await act(async () =>
    pending.resolve({
      id: 'saved',
      content: 'Synthetic pending save',
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
});

test('hidden idle Quick Search still acknowledges a fresh safety generation', async () => {
  const { safety, emit } = setup();
  await screen.findByRole('searchbox');
  emit({ session: 1, visible: false });
  act(() => safety.emit({ generation: 1, preparing: true }));
  await waitFor(() =>
    expect(safety.client.acknowledge).toHaveBeenCalledWith(1, 1),
  );
  expect(screen.queryByRole('searchbox')).toBeNull();
});

test('Quick Search retries completed-save release without repeating persistence', async () => {
  const { safety, client } = setup();
  client.create.mockResolvedValue(safetyClip);
  safety.client.release = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic release failure'))
    .mockResolvedValue(undefined);
  fireEvent.click(await screen.findByRole('button', { name: 'New clip' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Content' }), {
    target: { value: safetyClip.content },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('searchbox');
  act(() => safety.emit({ generation: 1, preparing: true }));
  expect(safety.client.acknowledge).not.toHaveBeenCalled();
  act(() => safety.emit({ generation: 2, preparing: false }));
  fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
  await screen.findByRole('textbox', { name: 'Content' });
  expect(safety.client.release).toHaveBeenCalledTimes(2);
  expect(safety.client.acquire).toHaveBeenCalledTimes(2);
  expect(client.create).toHaveBeenCalledOnce();
});

test.each(['Close Quick Search', 'Open Slate'])(
  'a delayed %s reply cannot cancel an editor in a newer native session',
  async (action) => {
    const { safety, host, emit } = setup();
    const pending = deferred<void>();
    host.hide.mockImplementation(() => pending.promise);
    host.openTin.mockImplementation(() => pending.promise);
    fireEvent.click(await screen.findByRole('button', { name: 'New clip' }));
    const content = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Content',
    });
    fireEvent.change(content, {
      target: { value: 'Synthetic original draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: action }));
    emit({ session: 1, visible: false });
    emit({ session: 2, visible: true });
    fireEvent.change(content, {
      target: { value: 'Synthetic newer session draft' },
    });
    await act(async () => pending.resolve());
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Content' })
        .value,
    ).toBe('Synthetic newer session draft');
    expect(safety.client.release).not.toHaveBeenCalled();
  },
);

test.each(['Close Quick Search', 'Open Slate'])(
  '%s cancellation cannot expose an editable draft while its release is pending',
  async (action) => {
    const { safety, emit } = setup();
    const pending = deferred<void>();
    safety.client.release = vi.fn(() => pending.promise);
    fireEvent.click(await screen.findByRole('button', { name: 'New clip' }));
    await screen.findByRole('textbox', { name: 'Content' });
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(safety.client.release).toHaveBeenCalledOnce());
    emit({ session: 1, visible: false });
    emit({ session: 2, visible: true });
    expect(screen.queryByRole('textbox', { name: 'Content' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    expect(safety.client.acquire).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    expect(
      await screen.findByRole('textbox', { name: 'Content' }),
    ).toBeTruthy();
    expect(safety.client.acquire).toHaveBeenCalledTimes(2);
  },
);
