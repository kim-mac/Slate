import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const stylesheet = readFileSync(
  join(process.cwd(), 'src/launcher/launcher.css'),
  'utf8',
);

test('keeps clip content selectable outside the dedicated drag header', () => {
  expect(stylesheet).toMatch(/\.launcher-header\s*\{[^}]*user-select:\s*none/s);
  expect(stylesheet).toMatch(
    /\.launcher-preview\s*\{[^}]*user-select:\s*text/s,
  );
});

test('delegates launcher scrolling to the shared custom ScrollArea', () => {
  expect(stylesheet).not.toMatch(
    /\.launcher-results\s*\{[^}]*overflow:\s*auto/s,
  );
  expect(stylesheet).not.toMatch(
    /\.launcher-group-member\s+\.launcher-preview\s*\{[^}]*overflow:\s*auto/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-results-content\s*\{[^}]*padding-right:\s*12px/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-preview-scroll\s*\{[^}]*height:\s*5\.25em/s,
  );
});

test('lets the drag-region heading receive pointer events over the decorative grip', () => {
  expect(stylesheet).toMatch(
    /\.launcher-drag-handle\s*\{[^}]*pointer-events:\s*none/s,
  );
});

test('uses a background-only hover state for unselected pointer results', () => {
  expect(stylesheet).toMatch(
    /@media\s*\(hover:\s*hover\)[^{]*\{[\s\S]*\.launcher-result:not\(\[aria-selected='true'\]\):hover\s*\{[^}]*background:/,
  );
});

test('keeps long selected titles bounded beside a fixed launcher action cluster', () => {
  expect(stylesheet).toMatch(
    /\.launcher-title\s*\{[^}]*flex:\s*1[^}]*min-width:\s*0/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-title-actions\s*\{[^}]*display:\s*flex[^}]*flex-shrink:\s*0/s,
  );
});

test('keeps the compact clip editor bounded inside the fixed launcher', () => {
  expect(stylesheet).toMatch(
    /\.launcher-editor\s*\{[^}]*display:\s*flex[^}]*flex:\s*1[^}]*min-height:\s*0/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-editor-scroll\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-editor-scroll-content\s*\{[^}]*padding-right:\s*12px/s,
  );
  expect(stylesheet).toMatch(
    /\.launcher-editor-content\s*\{[^}]*overflow:\s*hidden[^}]*resize:\s*none/s,
  );
});
