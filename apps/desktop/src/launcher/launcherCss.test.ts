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
