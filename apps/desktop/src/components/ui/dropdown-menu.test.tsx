/// <reference types="node" />
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CalendarClipCard } from '@/components/calendar/CalendarClipCard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/styles.css'),
  'utf8',
);
const enabled =
  "[data-slot='dropdown-menu-item'][data-variant='destructive']:not([data-disabled])";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

test('improves enabled dark menu text/icon contrast in explicit and system dark mode', () => {
  const compact = stylesheet.replace(/\s/g, '');
  const rule = `${enabled}{color:var(--popover-foreground);}`;
  expect(compact.split(rule)).toHaveLength(3);
  expect(compact).toContain(`:root[data-theme='dark']${enabled}`);
  expect(compact).toContain(`:root:not([data-theme='light'])${enabled}`);
  // These Slate tokens are neutral OKLCH: relative luminance is L^3.
  for (const block of [
    stylesheet.match(/:root\[data-theme='dark'\] \{([^}]+)\}/)![1]!,
    stylesheet.match(/:root:not\(\[data-theme='light'\]\) \{([^}]+)\}/)![1]!,
  ]) {
    const lightness = (token: string) =>
      Number(
        block.match(new RegExp(`--${token}: oklch\\(([0-9.]+) 0 0\\)`))![1],
      );
    for (const background of ['popover', 'accent']) {
      const contrast =
        (lightness('popover-foreground') ** 3 + 0.05) /
        (lightness(background) ** 3 + 0.05);
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('changes no light-mode token or existing stylesheet rule', () => {
  const marker =
    '/* Rehearsal 0.2.3: enabled Delete must not resemble a disabled item. */';
  const prefix = stylesheet
    .slice(0, stylesheet.indexOf(marker))
    .replace(/\r\n/g, '\n')
    .trimEnd();
  expect(createHash('sha256').update(prefix).digest('hex').toUpperCase()).toBe(
    '959153CB7357F1A0005FDC70A99F7DED6F1D49E48D39590F338EA356679AD467',
  );
  expect(prefix).toContain('--destructive: oklch(0.3 0 0);');
  const override = stylesheet.slice(stylesheet.indexOf(marker));
  expect(override).not.toContain(":root[data-theme='light']");
  expect(override).not.toContain('opacity');
  expect(override).not.toContain('pointer-events');
});

test.each(['light', 'dark'])(
  'enabled Delete remains actionable in %s mode',
  (theme) => {
    document.documentElement.dataset.theme = theme;
    const onDeleteItem = vi.fn();
    const clip = {
      id: 'synthetic',
      title: 'Synthetic clip',
      content: 'Synthetic content',
      contentType: 'text' as const,
      sourceApp: null,
      sourceUrl: null,
      sourcePageTitle: null,
      isPinned: false,
      createdAt: '2026-09-01T12:00:00Z',
      updatedAt: '2026-09-01T12:00:00Z',
    };
    render(
      <CalendarClipCard
        clip={{ kind: 'clip', clip }}
        primaryId="synthetic"
        onActivateClip={vi.fn()}
        onCopyClip={vi.fn()}
        onEditClip={vi.fn()}
        onDeleteItem={onDeleteItem}
        onSetItemPinned={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Actions for Synthetic clip' }),
    );
    const action = screen.getByRole('menuitem', { name: 'Delete' });
    expect(action.hasAttribute('data-disabled')).toBe(false);
    expect(action.getAttribute('aria-disabled')).not.toBe('true');
    expect(action.querySelector('svg')?.getAttribute('stroke')).toBe(
      'currentColor',
    );
    fireEvent.click(action);
    expect(onDeleteItem).toHaveBeenCalledExactlyOnceWith({
      kind: 'clip',
      clip,
    });
  },
);

test.each(['light', 'dark'])(
  'genuinely disabled destructive actions stay disabled in %s mode',
  (theme) => {
    document.documentElement.dataset.theme = theme;
    const onClick = vi.fn();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem variant="destructive" disabled onClick={onClick}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const action = screen.getByRole('menuitem', { name: 'Delete' });
    expect(action.getAttribute('aria-disabled')).toBe('true');
    expect(action.hasAttribute('data-disabled')).toBe(true);
    expect(action.classList.contains('data-disabled:opacity-50')).toBe(true);
    expect(action.classList.contains('data-disabled:pointer-events-none')).toBe(
      true,
    );
    expect(action.matches(enabled)).toBe(false);
    fireEvent.click(action);
    expect(onClick).not.toHaveBeenCalled();
  },
);
