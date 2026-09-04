// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { readSelection, placeSaveControl } from './selection';

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});
function select(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.getBoundingClientRect = () => ({
    left: 20,
    right: 100,
    top: 30,
    bottom: 50,
    width: 80,
    height: 20,
    x: 20,
    y: 30,
    toJSON: () => ({}),
  });
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}
describe('selection snapshot', () => {
  test('preserves exact multiline text and geometry', () => {
    const p = document.createElement('p');
    p.textContent = '  hello\n  world\t';
    document.body.append(p);
    select(p);
    expect(readSelection(document)).toMatchObject({
      text: '  hello\n  world\t',
      rect: { left: 20, bottom: 50 },
    });
  });
  test.each([
    'input',
    'textarea',
    'div[contenteditable]',
    'div[contenteditable="plaintext-only"]',
    'div[role="textbox"]',
  ])('excludes %s', (kind) => {
    const tag = kind.split('[')[0]!;
    const el = document.createElement(tag);
    if (kind.includes('contenteditable'))
      el.setAttribute(
        'contenteditable',
        kind.includes('plaintext') ? 'plaintext-only' : 'true',
      );
    if (kind.includes('role')) el.setAttribute('role', 'textbox');
    el.textContent = 'do not save';
    document.body.append(el);
    select(el);
    expect(readSelection(document)).toBeNull();
  });
  test('excludes selections crossing editable descendants', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<p>readable</p><div contenteditable>private draft</div>';
    document.body.append(wrapper);
    select(wrapper);
    expect(readSelection(document)).toBeNull();
  });
  test('excludes designMode and blank or collapsed selections', () => {
    const p = document.createElement('p');
    p.textContent = '  \n';
    document.body.append(p);
    select(p);
    expect(readSelection(document)).toBeNull();
    p.textContent = 'text';
    select(p);
    document.designMode = 'on';
    expect(readSelection(document)).toBeNull();
    document.designMode = 'off';
    document.getSelection()?.collapseToStart();
    expect(readSelection(document)).toBeNull();
  });
  test('excludes nested text inside editable parents', () => {
    const parent = document.createElement('div');
    parent.setAttribute('contenteditable', 'true');
    const p = document.createElement('p');
    p.textContent = 'draft';
    parent.append(p);
    document.body.append(parent);
    select(p);
    expect(readSelection(document)).toBeNull();
  });
});
describe('control position', () => {
  test('prefers below the selection with a gap', () => {
    expect(
      placeSaveControl(
        { left: 20, top: 30, bottom: 50 },
        { width: 800, height: 500 },
        { width: 80, height: 32 },
      ),
    ).toEqual({ left: 20, top: 58 });
  });
  test('flips above and clamps horizontal edges', () => {
    expect(
      placeSaveControl(
        { left: 790, top: 450, bottom: 490 },
        { width: 800, height: 500 },
        { width: 80, height: 32 },
      ),
    ).toEqual({ left: 712, top: 410 });
  });
  test('clamps negative and oversized selection rectangles', () => {
    expect(
      placeSaveControl(
        { left: -10, top: -100, bottom: 600 },
        { width: 800, height: 500 },
        { width: 80, height: 32 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});
