/// <reference types="node" />

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { ScrollArea } from './scroll-area';

afterEach(cleanup);

test('uses one custom vertical scrollbar with a vertical-only viewport', () => {
  const { container } = render(
    <ScrollArea>
      <div>Scrollable content</div>
    </ScrollArea>,
  );

  const root = container.querySelector<HTMLElement>(
    '[data-slot="scroll-area"]',
  );
  const viewport = container.querySelector<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  expect(root?.classList.contains('overflow-hidden')).toBe(true);
  expect(viewport?.style.overflowX).toBe('hidden');
  expect(viewport?.style.overflowY).toBe('scroll');

  // Base UI omits the scrollbar in jsdom because no layout overflow can be
  // measured. Guard the component composition directly instead.
  const componentSource = readFileSync(
    resolve(process.cwd(), 'src/components/ui/scroll-area.tsx'),
    'utf8',
  );
  expect(componentSource.match(/<ScrollBar\s*\/>/g)).toHaveLength(1);
  expect(componentSource).not.toContain('orientation="horizontal"');
});

test('packages the Base UI native-scrollbar suppression in the app stylesheet', () => {
  const stylesheet = readFileSync(
    resolve(process.cwd(), 'src/styles.css'),
    'utf8',
  );

  expect(stylesheet).toContain('.base-ui-disable-scrollbar {');
  expect(stylesheet).toContain('scrollbar-width: none;');
  expect(stylesheet).toContain(
    '.base-ui-disable-scrollbar::-webkit-scrollbar {',
  );
});
