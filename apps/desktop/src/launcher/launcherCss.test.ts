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
  expect(stylesheet).toMatch(
    /\.launcher-preview-scroll\s*\{[^}]*max-height:\s*5\.25em/s,
  );
});
