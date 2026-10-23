export const EXTENSION_DISMISSAL_KEY =
  'ai-clip-memory-extension-suggestion-dismissed-v1';

export function readExtensionDismissal(): {
  dismissed: boolean;
  warning: string | null;
} {
  try {
    return {
      dismissed:
        window.localStorage.getItem(EXTENSION_DISMISSAL_KEY) === 'true',
      warning: null,
    };
  } catch {
    return {
      dismissed: false,
      warning: 'Could not read the extension suggestion preference.',
    };
  }
}

export function persistExtensionDismissal(): string | null {
  try {
    window.localStorage.setItem(EXTENSION_DISMISSAL_KEY, 'true');
    return null;
  } catch {
    return 'Suggestion hidden for now. Could not remember your choice; it may return after reopening the sidebar or restarting Slate.';
  }
}
