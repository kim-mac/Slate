import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createRef } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { AppSidebar } from './AppSidebar';
import { SidebarProvider } from './ui/sidebar';
import { TooltipProvider } from './ui/tooltip';
import type { UpdateControls } from '../updaterClient';

const preference = 'ai-clip-memory-extension-suggestion-dismissed-v1';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});
function model(): UpdateControls {
  return {
    state: {
      revision: 1,
      phase: 'available',
      currentVersion: '0.3.0',
      availableVersion: '0.3.1',
      downloadedBytes: 0,
      totalBytes: null,
      dismissed: false,
      error: null,
      installationEnabled: true,
    },
    pending: false,
    connectionError: false,
    actionError: null,
    check: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    dismiss: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
  };
}
function setup(
  options: {
    collapsed?: boolean;
    updater?: UpdateControls;
    open?: () => Promise<void>;
  } = {},
) {
  const navigate = vi.fn();
  const open = options.open ?? vi.fn(async () => undefined);
  const view = render(
    <TooltipProvider>
      <SidebarProvider defaultOpen={!options.collapsed}>
        <AppSidebar
          activeView="all"
          allCount={0}
          clips={[]}
          clipListRef={createRef<HTMLDivElement>()}
          expandedSection="all"
          hasFilters={false}
          isLoading={false}
          onSelectClip={vi.fn()}
          onToggleSection={vi.fn()}
          pinnedCount={0}
          selectedId={null}
          onSelectView={navigate}
          {...(options.updater ? { updater: options.updater } : {})}
          onOpenExtension={open}
        />
      </SidebarProvider>
    </TooltipProvider>,
  );
  return { ...view, open, navigate };
}

test('preserves the exact Settings control source and existing dimension/style classes', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/AppSidebar.tsx'),
    'utf8',
  );
  const at = source.lastIndexOf('aria-label="Settings"');
  const start = source.lastIndexOf('<SidebarMenuButton', at);
  const end =
    source.indexOf('</SidebarMenuButton>', at) + '</SidebarMenuButton>'.length;
  expect(
    createHash('sha256')
      .update(source.slice(start, end).replace(/\r\n/g, '\n'))
      .digest('hex'),
  ).toBe('0dd33edeeeab5b3bff567e14df1700851ef7297875dc6ab7893c6d8378c21575');
  const { navigate } = setup();
  const settings = screen.getByRole('button', { name: 'Settings' });
  for (const token of ['w-full', 'h-8', 'p-2', 'rounded-md', 'text-sm'])
    expect(settings.classList.contains(token)).toBe(true);
  expect(settings.textContent).toBe('Settings');
  fireEvent.click(settings);
  expect(navigate).toHaveBeenCalledExactlyOnceWith('settings');
});

test('places a noninteractive Local only rectangle beside, not inside, Settings', () => {
  setup();
  const indicator = screen.getByText('Local only');
  const settings = screen.getByRole('button', { name: 'Settings' });
  expect(indicator.parentElement).toBe(settings.parentElement);
  expect(settings.contains(indicator)).toBe(false);
  expect(indicator.tagName).toBe('SPAN');
  expect(indicator.hasAttribute('tabindex')).toBe(false);
  expect(indicator.getAttribute('role')).not.toBe('button');
  const css = readFileSync(
    resolve(process.cwd(), 'src/components/sidebarDiscovery.css'),
    'utf8',
  );
  const rule = css.match(/\.sidebar-settings-status\s*\{([^}]*)\}/)?.[1];
  expect(rule).toContain('position: absolute');
  expect(rule).toContain('pointer-events: none');
  expect(rule).toContain('right: 0.5rem');
  expect(rule).toContain('border-radius: var(--radius-sm)');
  expect(rule).toContain('var(--muted-foreground)');
});

test('renders helpful copy without modal or installed-extension claims', () => {
  setup();
  const card = screen.getByRole('region', {
    name: 'Browser extension suggestion',
  });
  expect(within(card).getByText('Save from your browser')).toBeTruthy();
  expect(
    within(card).getByText(
      'Slate works with the browser extension. Save text from the web directly to your clips.',
    ),
  ).toBeTruthy();
  expect(
    within(card).getByRole('button', { name: 'Get the extension' }),
  ).toBeTruthy();
  expect(
    within(card).getByRole('button', { name: 'Dismiss extension suggestion' }),
  ).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('X dismisses immediately, preserves other preferences, and remains dismissed after remount', () => {
  window.localStorage.setItem('ai-clip-memory-theme', 'dark');
  const view = setup();
  const dismiss = screen.getByRole('button', {
    name: 'Dismiss extension suggestion',
  });
  dismiss.focus();
  fireEvent.click(dismiss);
  expect(
    screen.queryByRole('region', { name: 'Browser extension suggestion' }),
  ).toBeNull();
  expect(window.localStorage.getItem(preference)).toBe('true');
  expect(window.localStorage.getItem('ai-clip-memory-theme')).toBe('dark');
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Settings' }),
  );
  view.unmount();
  setup();
  expect(
    screen.queryByRole('button', { name: 'Get the extension' }),
  ).toBeNull();
});

test('successful external opening dismisses only after success and avoids duplicate opens', async () => {
  let complete!: () => void;
  const open = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  setup({ open });
  const action = screen.getByRole('button', { name: 'Get the extension' });
  fireEvent.click(action);
  fireEvent.click(action);
  expect(open).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(preference)).toBeNull();
  expect(
    screen.getByRole('region', { name: 'Browser extension suggestion' }),
  ).toBeTruthy();
  complete();
  await waitFor(() =>
    expect(window.localStorage.getItem(preference)).toBe('true'),
  );
  expect(
    screen.queryByRole('region', { name: 'Browser extension suggestion' }),
  ).toBeNull();
});

test('failed opening keeps the suggestion visible and permits a retry', async () => {
  const open = vi
    .fn()
    .mockRejectedValueOnce(new Error('synthetic'))
    .mockResolvedValue(undefined);
  setup({ open });
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await screen.findByText(/Could not open/);
  expect(window.localStorage.getItem(preference)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Get the extension' }));
  await waitFor(() =>
    expect(window.localStorage.getItem(preference)).toBe('true'),
  );
  expect(open).toHaveBeenCalledTimes(2);
});

test('failed preference writes hide immediately and disclose that remounts may show the card again', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('synthetic storage denial');
  });
  const view = setup();
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss extension suggestion' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Get the extension' }),
  ).toBeNull();
  expect(screen.getByRole('status').textContent).toMatch(
    /may return after reopening the sidebar or restarting Slate/i,
  );
  expect(window.localStorage.getItem(preference)).toBeNull();
  view.unmount();
  setup();
  expect(
    screen.getByRole('button', { name: 'Get the extension' }),
  ).toBeTruthy();
});

test('unreadable preferences do not falsely suppress the suggestion', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('synthetic storage denial');
  });
  setup();
  expect(
    screen.getByRole('button', { name: 'Get the extension' }),
  ).toBeTruthy();
  expect(screen.getByText(/Could not read/)).toBeTruthy();
});

test('preserves collapsed privacy and Settings while exposing compact notification details', () => {
  const updater = model();
  setup({ collapsed: true, updater });
  expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Local only' })).toBeTruthy();
  const update = screen.getByRole('button', { name: 'Show update details' });
  const extension = screen.getByRole('button', {
    name: 'Show browser extension suggestion',
  });
  expect(
    update.compareDocumentPosition(extension) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(extension);
  expect(
    screen.getByRole('button', { name: 'Get the extension' }),
  ).toBeTruthy();
});

test('update has priority and both notifications dismiss independently', () => {
  const updater = model();
  const view = setup({ updater });
  const update = screen.getByRole('region', { name: 'Slate update' });
  const extension = screen.getByRole('region', {
    name: 'Browser extension suggestion',
  });
  expect(
    update.compareDocumentPosition(extension) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss extension suggestion' }),
  );
  expect(screen.getByRole('region', { name: 'Slate update' })).toBeTruthy();
  expect(updater.dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(updater.dismiss).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(preference)).toBe('true');
  view.unmount();
  window.localStorage.clear();
  setup({
    updater: { ...model(), state: { ...model().state!, dismissed: true } },
  });
  expect(screen.queryByRole('region', { name: 'Slate update' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Get the extension' }),
  ).toBeTruthy();
});

test('notification scrolling is bounded and leaves the existing footer outside it', () => {
  setup({ updater: model() });
  const region = screen.getByRole('region', { name: 'Sidebar notifications' });
  expect(region.tabIndex).toBe(0);
  expect(
    region.contains(screen.getByRole('button', { name: 'Settings' })),
  ).toBe(false);
  const css = readFileSync(
    resolve(process.cwd(), 'src/components/sidebarDiscovery.css'),
    'utf8',
  );
  const rule = css.match(/\.sidebar-notifications\s*\{([^}]*)\}/)?.[1];
  expect(rule).toContain('overflow-y: auto');
  expect(rule).toContain('max-height:');
  expect(rule).toContain('min-height: 0');
  expect(css).toMatch(/\.sidebar-settings-footer\s*\{[^}]*flex-shrink: 0/);
});
