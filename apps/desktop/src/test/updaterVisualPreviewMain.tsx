import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import {
  createPreviewUpdater,
  UpdaterVisualPreview,
} from './updaterVisualPreview';

if (!import.meta.env.DEV || window.location.pathname !== '/visual-preview/') {
  throw new Error('Visual preview is available only on its development route.');
}
const fixture = createPreviewUpdater();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UpdaterVisualPreview fixture={fixture} />
  </StrictMode>,
);
