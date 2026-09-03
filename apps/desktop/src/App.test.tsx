import type { Clip, ClipInput } from '@ai-clip-memory/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { App } from './App';
import type { ClipClient } from './clipClient';

const firstClip: Clip = {
  id: '029e215c-cdda-41ba-99c7-366219ad1219',
  content: 'A calm explanation of local-first software.',
  contentType: 'text',
  title: 'Local-first notes',
  sourceApp: 'Web',
  sourceUrl: 'https://example.com/local-first',
  sourcePageTitle: 'Local-first article',
  isPinned: false,
  createdAt: '2026-09-02T15:00:00.000Z',
  updatedAt: '2026-09-02T15:00:00.000Z',
};

const pinnedClip: Clip = {
  id: '68d5b96b-8219-4f64-9a63-9bde31a2c813',
  content: 'Use TypeScript discriminated unions for state.',
  contentType: 'code',
  title: 'TypeScript tip',
  sourceApp: 'ChatGPT',
  sourceUrl: null,
  sourcePageTitle: null,
  isPinned: true,
  createdAt: '2026-09-01T15:00:00.000Z',
  updatedAt: '2026-09-01T15:00:00.000Z',
};

function fakeClient(initialClips: Clip[] = []) {
  const methods = {
    list: vi.fn<ClipClient['list']>().mockResolvedValue(initialClips),
    create: vi.fn<ClipClient['create']>(),
    update: vi.fn<ClipClient['update']>(),
    delete: vi.fn<ClipClient['delete']>().mockResolvedValue(undefined),
    setPinned: vi.fn<ClipClient['setPinned']>(),
    copyContent: vi
      .fn<ClipClient['copyContent']>()
      .mockResolvedValue(undefined),
    openSource: vi.fn<ClipClient['openSource']>().mockResolvedValue(undefined),
  };
  return { client: methods satisfies ClipClient, ...methods };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  test('shows the empty library after loading an empty database', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);

    expect(
      await screen.findByRole('heading', { name: 'No clips yet' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Create a clip here or save one from your browser.'),
    ).toBeTruthy();
  });

  test('keeps local status, search, and create controls in the sidebar', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    const sidebar = screen
      .getByRole('navigation', { name: 'Clip library' })
      .closest<HTMLElement>('[data-slot="sidebar"]');

    expect(sidebar).not.toBeNull();
    expect(within(sidebar!).getByText('Local only')).toBeTruthy();
    expect(
      within(sidebar!).getByRole('searchbox', { name: 'Search clips' }),
    ).toBeTruthy();
    expect(
      within(sidebar!).getByRole('button', { name: 'New clip' }),
    ).toBeTruthy();
  });

  test('renders clips, real counts, and the selected clip detail', async () => {
    const { client } = fakeClient([firstClip, pinnedClip]);
    render(<App client={client} />);

    expect(await screen.findByText(firstClip.content)).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: firstClip.title! }),
    ).toBeTruthy();
    const allClipsItem = screen
      .getByRole('button', { name: 'All Clips' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]');
    const pinnedItem = screen
      .getByRole('button', { name: 'Pinned' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]');

    expect(allClipsItem).not.toBeNull();
    expect(pinnedItem).not.toBeNull();
    expect(within(allClipsItem!).getByText('2')).toBeTruthy();
    expect(within(pinnedItem!).getByText('1')).toBeTruthy();
  });

  test('filters the loaded list with case-insensitive substring search', async () => {
    const { client } = fakeClient([firstClip, pinnedClip]);
    render(<App client={client} />);
    await screen.findByText(firstClip.content);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search clips' }), {
      target: { value: 'TYPESCRIPT' },
    });

    expect(screen.getByText(pinnedClip.content)).toBeTruthy();
    expect(screen.queryByText(firstClip.content)).toBeNull();
  });

  test('creates a manual local clip', async () => {
    const created: Clip = {
      ...firstClip,
      id: 'f2b31d7e-1343-4eef-bd60-136fdf9e0788',
      content: '  Preserve this content.  ',
      contentType: 'prompt',
      title: 'New prompt',
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
    };
    const fake = fakeClient();
    fake.create.mockResolvedValue(created);
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: created.content },
    });
    fireEvent.click(
      within(dialog).getByRole('combobox', { name: 'Content type' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'prompt' }));
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: created.title },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));

    await waitFor(() =>
      expect(fake.create).toHaveBeenCalledWith({
        content: created.content,
        contentType: 'prompt',
        title: 'New prompt',
        sourceApp: null,
        sourceUrl: null,
        sourcePageTitle: null,
      } satisfies ClipInput),
    );
    expect(
      screen.getByText(
        (_, element) =>
          element?.classList.contains('clip-content') === true &&
          element.textContent === created.content,
      ),
    ).toBeTruthy();
  });

  test('keeps a failed create error visible inside the open dialog', async () => {
    const fake = fakeClient();
    fake.create.mockRejectedValue({
      code: 'invalid_input',
      message: 'Content is required.',
    });
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: 'Valid local content' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save clip' }));

    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Content is required.',
    );
  });

  test('edits a clip using full-replacement input', async () => {
    const updated: Clip = {
      ...firstClip,
      content: 'Updated content',
      title: null,
      updatedAt: '2026-09-02T16:00:00.000Z',
    };
    const fake = fakeClient([firstClip]);
    fake.update.mockResolvedValue(updated);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: updated.content },
    });
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: '' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    );

    await waitFor(() =>
      expect(fake.update).toHaveBeenCalledWith(firstClip.id, {
        content: 'Updated content',
        contentType: 'text',
        title: null,
        sourceApp: 'Web',
        sourceUrl: 'https://example.com/local-first',
        sourcePageTitle: 'Local-first article',
      } satisfies ClipInput),
    );
    expect(screen.getByText('Updated content')).toBeTruthy();
  });

  test('cancels create without calling the client', async () => {
    const fake = fakeClient();
    render(<App client={fake.client} />);
    await screen.findByRole('heading', { name: 'No clips yet' });

    fireEvent.click(screen.getByRole('button', { name: 'New clip' }));
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: 'Do not save this' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.update).not.toHaveBeenCalled();
  });

  test('cancels deletion without calling the client', async () => {
    const fake = fakeClient([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fake.delete).not.toHaveBeenCalled();
  });

  test('deletes a clip after alert-dialog confirmation', async () => {
    const fake = fakeClient([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const alert = screen.getByRole('alertdialog', { name: 'Delete clip?' });
    fireEvent.click(within(alert).getByRole('button', { name: 'Delete clip' }));

    await waitFor(() => expect(fake.delete).toHaveBeenCalledWith(firstClip.id));
    expect(screen.getByRole('heading', { name: 'No clips yet' })).toBeTruthy();
  });

  test('pins and unpins a clip', async () => {
    const fake = fakeClient([firstClip]);
    fake.setPinned
      .mockResolvedValueOnce({ ...firstClip, isPinned: true })
      .mockResolvedValueOnce(firstClip);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content);

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await screen.findByRole('button', { name: 'Unpin' });
    const pinnedItem = screen
      .getByRole('button', { name: 'Pinned' })
      .closest<HTMLElement>('[data-slot="sidebar-menu-item"]');
    expect(pinnedItem).not.toBeNull();
    expect(within(pinnedItem!).getByText('1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(fake.setPinned).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy();
  });

  test('copies content and opens the stored source through the client', async () => {
    const fake = fakeClient([firstClip]);
    render(<App client={fake.client} />);
    await screen.findByText(firstClip.content);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }));

    await waitFor(() => {
      expect(fake.copyContent).toHaveBeenCalledWith(firstClip.id);
      expect(fake.openSource).toHaveBeenCalledWith(firstClip.id);
    });
  });

  test('keeps local-first privacy information in settings', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings & About' }));

    expect(
      screen.getByText(
        'Your clips are stored locally on this computer. No account or cloud connection is required.',
      ),
    ).toBeTruthy();
  });
});
