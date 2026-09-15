import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Launcher } from './Launcher';
import { applyThemeMode, readThemeMode } from '../themePreference';
import '../styles.css';
import './launcher.css';

applyThemeMode(readThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Launcher />
  </StrictMode>,
);
