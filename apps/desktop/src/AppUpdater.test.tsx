import type { Clip } from '@ai-clip-memory/shared';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { tauriClipClient, type ClipClient } from './clipClient';
import type { UpdateSnapshot, UpdaterClient } from './updaterClient';

vi.mock('./launcher/launcherClient', () => ({
  getLauncherStatus: vi.fn(async () => ({
    available: true,
    shortcut: 'Ctrl+Shift+Space',
    errorCode: null,
  })),
}));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const clip: Clip = {
  id: '029e215c-cdda-41ba-99c7-366219ad1219',
  title: 'Original clip',
  content: 'Synthetic saved fixture',
  contentType: 'text',
  sourceApp: 'Web',
  sourceUrl: null,
  sourcePageTitle: null,
  isPinned: false,
  createdAt: '2026-09-02T15:00:00.000Z',
  updatedAt: '2026-09-02T15:00:00.000Z',
};
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
function fixture() {
  let receive: ((state: UpdateSnapshot) => void) | undefined;
  const updater: UpdaterClient = {
    listen: vi.fn(async (handler) => {
      receive = handler;
      return () => undefined;
    }),
    getStatus: vi.fn(async () => available),
    check: vi.fn(async () => ({ ...available, revision: 4 })),
    download: vi.fn(async () => ({
      ...available,
      revision: 2,
      phase: 'downloading' as const,
    })),
    cancel: vi.fn(async () => ({ ...available, revision: 3 })),
    dismiss: vi.fn(async () => ({
      ...available,
      revision: 3,
      dismissed: true,
    })),
  };
  const client = {
    ...tauriClipClient,
    list: vi.fn(async () => [{ kind: 'clip' as const, clip }]),
    copyContent: vi.fn<ClipClient['copyContent']>(async () => undefined),
  };
  const startupClient = {
    getEnabled: async () => false,
    setEnabled: async (value: boolean) => value,
  };
  return {
    updater,
    client,
    startupClient,
    emit: (value: UpdateSnapshot) => receive?.(value),
  };
}
async function openOriginal() {
  const preview = await screen.findByText(clip.content, {
    selector: '.clip-list-preview',
  });
  fireEvent.click(preview.closest('button')!);
  await screen.findByText(clip.content, { selector: '.clip-content' });
}

test('updater state loading never blocks library startup', async () => {
  const fake = fixture();
  fake.updater.getStatus = vi.fn(
    () => new Promise<UpdateSnapshot>(() => undefined),
  );
  render(
    <App
      client={fake.client}
      startupClient={fake.startupClient}
      updaterClient={fake.updater}
    />,
  );
  expect(
    await screen.findByText(clip.content, { selector: '.clip-list-preview' }),
  ).toBeTruthy();
  await waitFor(() => expect(fake.updater.getStatus).toHaveBeenCalledOnce());
  expect(fake.updater.check).not.toHaveBeenCalled();
});

test('prioritizes updates above extension discovery and the unchanged footer', async () => {
  const fake = fixture();
  render(
    <App
      client={fake.client}
      startupClient={fake.startupClient}
      updaterClient={fake.updater}
    />,
  );
  const notice = await screen.findByRole('region', { name: 'Slate update' });
  const sidebar = notice.closest('[data-slot="sidebar"]')!;
  const footer = sidebar.querySelector('[data-slot="sidebar-footer"]')!;
  const notifications = screen.getByRole('region', {
    name: 'Sidebar notifications',
  });
  const extension = screen.getByRole('region', {
    name: 'Browser extension suggestion',
  });
  expect(notifications.firstElementChild).toBe(notice);
  expect(notice.nextElementSibling).toBe(extension);
  expect(notifications.nextElementSibling).toBe(footer);
  expect(
    footer.contains(screen.getByRole('button', { name: 'Settings' })),
  ).toBe(true);
  fireEvent.click(within(notice).getByRole('button', { name: 'Update Now' }));
  await waitFor(() => expect(fake.updater.download).toHaveBeenCalledOnce());
});

test('Later is temporary and About keeps version and manual access', async () => {
  const fake = fixture();
  render(
    <App
      client={fake.client}
      startupClient={fake.startupClient}
      updaterClient={fake.updater}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
  await waitFor(() =>
    expect(screen.queryByRole('region', { name: 'Slate update' })).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(await screen.findByRole('heading', { name: 'About' })).toBeTruthy();
  expect(document.querySelector('.settings-version')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
  await screen.findByRole('region', { name: 'Slate update' });
  expect(fake.updater.check).toHaveBeenCalledOnce();
});

test.each(['Create', 'Edit'] as const)(
  'preserves an unsaved %s draft across updater events',
  async (mode) => {
    const fake = fixture();
    render(
      <App
        client={fake.client}
        startupClient={fake.startupClient}
        updaterClient={fake.updater}
      />,
    );
    await screen.findByRole('button', { name: 'Update Now' });
    if (mode === 'Create')
      fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    else {
      await openOriginal();
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    }
    const dialog = await screen.findByRole('dialog', { name: `${mode} clip` });
    const draft = within(dialog).getByLabelText('Content');
    fireEvent.change(draft, {
      target: { value: 'Unsaved updater test draft' },
    });
    act(() => fake.emit({ ...available, revision: 2 }));
    const button = screen
      .getByText('Update Now')
      .closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(fake.updater.download).not.toHaveBeenCalled();
    expect(draft).toHaveProperty('value', 'Unsaved updater test draft');
    expect(dialog).toBe(screen.getByRole('dialog', { name: `${mode} clip` }));
  },
);

test('does not start an update during a destructive confirmation', async () => {
  const fake = fixture();
  render(
    <App
      client={fake.client}
      startupClient={fake.startupClient}
      updaterClient={fake.updater}
    />,
  );
  await screen.findByRole('button', { name: 'Update Now' });
  await openOriginal();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const confirmation = await screen.findByRole('alertdialog', {
    name: 'Delete clip?',
  });
  act(() => fake.emit({ ...available, revision: 2 }));
  expect(
    (screen.getByText('Update Now').closest('button') as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(confirmation).toBeTruthy();
});

test('does not start an update during an active local operation', async () => {
  const fake = fixture();
  let finish!: () => void;
  fake.client.copyContent = vi.fn(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  render(
    <App
      client={fake.client}
      startupClient={fake.startupClient}
      updaterClient={fake.updater}
    />,
  );
  await screen.findByRole('button', { name: 'Update Now' });
  await openOriginal();
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  expect(
    (screen.getByRole('button', { name: 'Update Now' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  act(() => fake.emit({ ...available, revision: 2 }));
  expect(fake.updater.download).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(
    (screen.getByRole('button', { name: 'Update Now' }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test('update progress does not clear the current search or selected clip', async () => {
  const fake = fixture();
  render(
    <App
      client={fake.client}
      startupClient={fake.startupClient}
      updaterClient={fake.updater}
    />,
  );
  await screen.findByRole('button', { name: 'Update Now' });
  await openOriginal();
  fireEvent.change(screen.getByRole('searchbox'), {
    target: { value: 'Synthetic' },
  });
  act(() =>
    fake.emit({
      ...available,
      revision: 2,
      phase: 'downloading',
      downloadedBytes: 50,
      totalBytes: 100,
    }),
  );
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(
    'Synthetic',
  );
  expect(
    screen.getByText(clip.content, { selector: '.clip-content' }),
  ).toBeTruthy();
  expect(fake.client.list).toHaveBeenCalledOnce();
});
