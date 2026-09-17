import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MAX_CLIP_CONTENT_BYTES } from '../lib/clipInputLimits';
import { LauncherClipEditor } from './LauncherClipEditor';

afterEach(cleanup);

function renderEditor(
  props: Partial<React.ComponentProps<typeof LauncherClipEditor>> = {},
) {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(
    <LauncherClipEditor
      mode="create"
      isSaving={false}
      error={null}
      onCancel={onCancel}
      onSave={onSave}
      {...props}
    />,
  );
  return { onCancel, onSave };
}

describe('LauncherClipEditor', () => {
  test('exposes only compact Content Type and multiline Content fields', () => {
    renderEditor();

    expect(screen.getByRole('combobox', { name: 'Content type' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Content' })).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(screen.queryByLabelText('Source URL')).toBeNull();
    expect(document.querySelector('[data-slot="scroll-area"]')).not.toBeNull();
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    expect(viewport?.style.overflowX).toBe('hidden');
    expect(viewport?.style.overflowY).toBe('scroll');
  });

  test('classifies create content automatically without mutating it', () => {
    renderEditor();
    const content = screen.getByRole('textbox', { name: 'Content' });

    fireEvent.change(content, {
      target: { value: '  https://example.com/path  ' },
    });
    expect(
      screen.getByRole('combobox', { name: 'Content type' }).textContent,
    ).toContain('Link');
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveProperty(
      'value',
      '  https://example.com/path  ',
    );
  });

  test('keeps a manual content type when content changes again', () => {
    const { onSave } = renderEditor();
    const content = screen.getByRole('textbox', { name: 'Content' });
    fireEvent.change(content, { target: { value: 'https://example.com' } });

    fireEvent.click(screen.getByRole('combobox', { name: 'Content type' }));
    fireEvent.click(screen.getByRole('option', { name: 'Text' }));
    fireEvent.change(content, {
      target: { value: 'https://openai.com/changed' },
    });
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });

    expect(onSave).toHaveBeenCalledWith({
      content: 'https://openai.com/changed',
      contentType: 'text',
    });
  });

  test('starts Edit in manual mode with the existing content and type', () => {
    const { onSave } = renderEditor({
      mode: 'edit',
      initialContent: 'https://example.com',
      initialContentType: 'prompt',
    });
    const content = screen.getByRole('textbox', { name: 'Content' });
    fireEvent.change(content, { target: { value: 'https://openai.com' } });
    fireEvent.keyDown(content, { key: 'Enter', metaKey: true });

    expect(onSave).toHaveBeenCalledWith({
      content: 'https://openai.com',
      contentType: 'prompt',
    });
  });

  test('rejects blank and oversized content while preserving the draft', () => {
    const { onSave } = renderEditor();
    const content = screen.getByRole('textbox', { name: 'Content' });

    fireEvent.change(content, { target: { value: '  ' } });
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toContain('required');
    expect(onSave).not.toHaveBeenCalled();

    const oversized = 'x'.repeat(MAX_CLIP_CONTENT_BYTES + 1);
    fireEvent.change(content, { target: { value: oversized } });
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
    expect(screen.getByRole('alert').textContent).toContain('1 MiB');
    expect(content).toHaveProperty('value', oversized);
    expect(onSave).not.toHaveBeenCalled();
  });

  test('plain Enter remains native, composition blocks save, and Ctrl+Enter saves', () => {
    const { onSave } = renderEditor();
    const content = screen.getByRole('textbox', { name: 'Content' });
    fireEvent.change(content, { target: { value: 'line one\nline two' } });

    fireEvent.keyDown(content, { key: 'Enter' });
    fireEvent.keyDown(content, {
      key: 'Enter',
      ctrlKey: true,
      isComposing: true,
    });
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith({
      content: 'line one\nline two',
      contentType: 'text',
    });
  });

  test('Cancel is explicit and a safe save error does not clear the draft', () => {
    const { onCancel } = renderEditor({ error: 'Clip could not be saved.' });
    const content = screen.getByRole('textbox', { name: 'Content' });
    fireEvent.change(content, { target: { value: 'keep this draft' } });

    expect(screen.getByRole('alert').textContent).toBe(
      'Clip could not be saved.',
    );
    expect(content).toHaveProperty('value', 'keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
