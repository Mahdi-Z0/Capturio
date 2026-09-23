import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import Overlay from './Overlay.js';
import RegionSelector from './RegionSelector.js';
import './index.css';
import './overlay.css';
import './region.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/*
 * One bundle, three windows.
 *
 * The overlay and the region selector are separate BrowserWindows on the same
 * renderer build, selected by hash. Extra Vite entries would mean touching the
 * build config, which is protected, for two small components.
 */
const view = window.location.hash;
// Before the first paint: neither transparent window may flash the app's opaque
// background while React mounts.
if (view === '#overlay') document.documentElement.classList.add('overlay-mode');
if (view === '#region') document.documentElement.classList.add('region-mode');

createRoot(root).render(
  <StrictMode>
    {view === '#overlay' ? <Overlay /> : view === '#region' ? <RegionSelector /> : <App />}
  </StrictMode>,
);
