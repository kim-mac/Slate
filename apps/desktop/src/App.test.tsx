import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  test('shows the searchable empty clip library by default', () => {
    render(<App />);

    expect(
      screen.getByRole('searchbox', { name: 'Search clips' }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'All Clips' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No clips yet' })).toBeTruthy();
    expect(
      screen.getByText('Save something from your browser to see it here.'),
    ).toBeTruthy();
  });

  test('keeps search text in local UI state', () => {
    render(<App />);
    const searchInput = screen.getByRole('searchbox', { name: 'Search clips' });

    fireEvent.change(searchInput, { target: { value: 'design patterns' } });

    expect((searchInput as HTMLInputElement).value).toBe('design patterns');
  });

  test('shows the pinned empty state from navigation', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /Pinned/ }));

    expect(screen.getByRole('heading', { name: 'Pinned' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'No pinned clips' }),
    ).toBeTruthy();
  });

  test('shows local-first privacy information in settings', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings & About' }));

    expect(
      screen.getByRole('heading', { name: 'Settings & About' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your clips are stored locally on this computer. No account or cloud connection is required.',
      ),
    ).toBeTruthy();
  });
});
