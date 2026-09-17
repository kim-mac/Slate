/// <reference types="node" />

import type { Clip, ClipInput } from '@ai-clip-memory/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ClipFormDialog } from '@/components/ClipFormDialog';

const clip: Clip = {
  id: 'clip-1',
  content: 'Keep this edit draft local.',
  contentType: 'text',
  title: 'Local draft',
  sourceApp: 'Other Web',
  sourceUrl: 'https://example.com/source',
  sourcePageTitle: 'Example source',
  isPinned: false,
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z',
};

afterEach(cleanup);

function renderDialog(options: { clip?: Clip } = {}) {
  const onSubmit = vi.fn<(input: ClipInput) => Promise<void>>();
  onSubmit.mockResolvedValue(undefined);
  const result = render(
    <ClipFormDialog
      {...(options.clip ? { clip: options.clip } : {})}
      isSaving={false}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
      open
    />,
  );

  return { ...result, onSubmit };
}

describe('ClipFormDialog', () => {
  test('uses a vertical-only ScrollArea while keeping Close outside its viewport', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    const scrollArea = dialog.querySelector<HTMLElement>(
      '[data-slot="scroll-area"]',
    );
    const viewport = dialog.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    const close = within(dialog).getByRole('button', { name: 'Close' });

    expect(scrollArea).not.toBeNull();
    expect(scrollArea?.classList.contains('clip-form-dialog-scroll')).toBe(
      true,
    );
    expect(viewport?.style.overflowX).toBe('hidden');
    expect(viewport?.style.overflowY).toBe('scroll');
    expect(scrollArea?.contains(close)).toBe(false);
    expect(dialog.contains(close)).toBe(true);
  });

  test('uses the same scrolling structure for Edit clip', () => {
    renderDialog({ clip });

    const dialog = screen.getByRole('dialog', { name: 'Edit clip' });
    expect(dialog.querySelector('[data-slot="scroll-area"]')).not.toBeNull();
    expect(
      dialog.querySelector('.clip-form-dialog-scroll-content'),
    ).not.toBeNull();
    expect(
      (within(dialog).getByLabelText('Content') as HTMLTextAreaElement).value,
    ).toBe(clip.content);
  });

  test('keeps create validation and submission behavior intact', () => {
    const { onSubmit } = renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Create clip' });
    const form = dialog.querySelector('form')!;

    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText('Content'), {
      target: { value: 'New local clip' },
    });
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledWith({
      content: 'New local clip',
      contentType: 'text',
      title: null,
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
    });
  });

  test('moves overflow ownership from the dialog shell to a bounded ScrollArea', () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'src/styles.css'),
      'utf8',
    );
    const dialogRule = stylesheet.match(
      /\.clip-form-dialog\s*\{([^}]*)\}/,
    )?.[1];
    const scrollRule = stylesheet.match(
      /\.clip-form-dialog-scroll\s*\{([^}]*)\}/,
    )?.[1];

    expect(dialogRule).toContain('overflow: hidden;');
    expect(dialogRule).not.toContain('overflow-y: auto;');
    expect(scrollRule).toContain('max-height: calc(100dvh - 4rem);');
    expect(scrollRule).toContain('min-width: 0;');
  });
});
