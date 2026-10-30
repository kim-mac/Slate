import { isTauri } from '@tauri-apps/api/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('Root element not found');
}

async function start() {
  if (import.meta.env.DEV && isTauri()) {
    const { getName } = await import('@tauri-apps/api/app');
    // Only the isolated UX capability grants name access. Ordinary development
    // must still mount when this optional identity lookup is denied.
    const name = await getName().catch(() => null);
    if (name === 'Slate UX Development') {
      const { UxDevApp } = await import('./ux-dev/UxDevApp');
      createRoot(rootElement!).render(
        <StrictMode>
          <UxDevApp />
        </StrictMode>,
      );
      return;
    }
  }
  createRoot(rootElement!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
