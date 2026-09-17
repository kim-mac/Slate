/// <reference types="node" />

import type { Clip } from '@ai-clip-memory/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { ClipDetail } from '@/components/ClipDetail';
import { TooltipProvider } from '@/components/ui/tooltip';

const clip: Clip = {
  id: 'clip-1',
  content: 'Compact back control test content',
  contentType: 'text',
  title: 'Compact control test',
  sourceApp: 'Other Web',
  sourceUrl: 'https://example.com/source',
  sourcePageTitle: 'Example source',
  isPinned: false,
  createdAt: '2026-09-16T12:00:00.000Z',
  updatedAt: '2026-09-16T12:00:00.000Z',
};

describe('ClipDetail', () => {
  test('renders a compact arrow-only Back control with an accessible tooltip', async () => {
    const onBack = vi.fn();

    render(
      <TooltipProvider>
        <ClipDetail
          clip={clip}
          disabled={false}
          backButtonRef={createRef<HTMLButtonElement>()}
          onBack={onBack}
          onCopy={vi.fn()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onOpenSource={vi.fn()}
          onSetPinned={vi.fn()}
        />
      </TooltipProvider>,
    );

    const back = screen.getByRole('button', { name: 'Back to calendar' });
    expect(back.className).toContain('size-7');
    expect(screen.queryByText('Back', { exact: true })).toBeNull();

    fireEvent.focus(back);
    expect(await screen.findByText('Back to calendar')).toBeTruthy();

    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('omits the header divider while retaining the clip-content border', () => {
    const stylesheet = readFileSync(
      resolve(process.cwd(), 'src/styles.css'),
      'utf8',
    );
    const headerRule = stylesheet.match(
      /\.clip-detail-header\s*\{([^}]*)\}/,
    )?.[1];
    const contentRule = stylesheet.match(/\.clip-content\s*\{([^}]*)\}/)?.[1];

    expect(headerRule).toBeDefined();
    expect(headerRule).not.toContain('border-bottom:');
    expect(contentRule).toContain('border: 1px solid var(--border);');
  });
});
