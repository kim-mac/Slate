import type { Clip } from '@ai-clip-memory/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { ClipList } from './ClipList';
afterEach(cleanup);
const clips = ['a', 'b', 'c'].map(
  (id) =>
    ({
      id,
      title: null,
      content: id,
      contentType: 'text',
      sourceApp: 'ChatGPT',
      sourcePageTitle: `Page ${id}`,
      sourceUrl: null,
      isPinned: false,
      createdAt: '2026-09-03T12:00:00.000Z',
      updatedAt: '2026-09-03T12:00:00.000Z',
    }) satisfies Clip,
);
function Library() {
  const [selectedId, onSelect] = useState<string | null>('a');
  return <ClipList clips={clips} selectedId={selectedId} onSelect={onSelect} />;
}
test('uses fallback titles, source metadata, and non-truncated short previews', () => {
  render(<Library />);
  expect(screen.getByText('Page a')).toBeTruthy();
  expect(screen.getAllByText('ChatGPT')).toHaveLength(3);
  expect(screen.getByText('a')).toBeTruthy();
});
test('moves roving focus and selection with arrows and Home/End', () => {
  render(<Library />);
  const rows = screen.getAllByRole('button');
  expect(rows[0]!.tabIndex).toBe(0);
  expect(rows[1]!.tabIndex).toBe(-1);
  rows[0]!.focus();
  fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[1]!.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(rows[1]!, { key: 'End' });
  expect(document.activeElement).toBe(rows[2]);
  fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(rows[2]);
  fireEvent.keyDown(rows[2]!, { key: 'Home' });
  expect(document.activeElement).toBe(rows[0]);
  fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(rows[0]);
});
test('does not capture modified arrows or composition events', () => {
  const select = vi.fn();
  render(<ClipList clips={clips} selectedId="a" onSelect={select} />);
  const first = screen.getAllByRole('button')[0]!;
  fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true });
  fireEvent.keyDown(first, { key: 'ArrowDown', isComposing: true });
  expect(select).not.toHaveBeenCalled();
});
