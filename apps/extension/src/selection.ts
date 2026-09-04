const EDITABLE =
  'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

export interface SelectionSnapshot {
  text: string;
  rect: Pick<DOMRect, 'left' | 'top' | 'bottom'>;
}

function elementFor(node: Node | null): Element | null {
  return node?.nodeType === 1
    ? (node as Element)
    : (node?.parentElement ?? null);
}

export function readSelection(doc: Document): SelectionSnapshot | null {
  if (
    doc.designMode?.toLowerCase() === 'on' ||
    doc.activeElement?.closest(EDITABLE)
  )
    return null;
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1)
    return null;
  const range = selection.getRangeAt(0);
  if (!range.startContainer.isConnected || !range.endContainer.isConnected)
    return null;
  const start = elementFor(range.startContainer);
  const end = elementFor(range.endContainer);
  if (start?.closest(EDITABLE) || end?.closest(EDITABLE)) return null;
  // Inspect only editable nodes intersecting the user's selected range, not page text.
  const ancestor = elementFor(range.commonAncestorContainer);
  if (
    ancestor &&
    [...ancestor.querySelectorAll(EDITABLE)].some((el) =>
      range.intersectsNode(el),
    )
  )
    return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const rect = range.getBoundingClientRect();
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.bottom) ||
    (rect.width === 0 && rect.height === 0)
  )
    return null;
  return {
    text,
    rect: { left: rect.left, top: rect.top, bottom: rect.bottom },
  };
}

export function placeSaveControl(
  rect: SelectionSnapshot['rect'],
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): { left: number; top: number } {
  const gap = 8;
  const top =
    rect.bottom + gap + size.height <= viewport.height - gap
      ? rect.bottom + gap
      : rect.top - size.height - gap;
  return {
    left: Math.max(gap, Math.min(rect.left, viewport.width - size.width - gap)),
    top: Math.max(gap, Math.min(top, viewport.height - size.height - gap)),
  };
}
