import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import Overlay from './Overlay.js';
import './index.css';
import './overlay.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/*
 * One bundle, two windows.
 *
 * The overlay is a separate BrowserWindow but the same renderer build, selected
 * by hash. A second Vite entry would mean touching the build config, which is
 * protected, for a window that is a single small component.
 */
const isOverlay = window.location.hash === '#overlay';
// Before the first paint: the overlay window must never flash the app's
// opaque background while React mounts.
if (isOverlay) document.documentElement.classList.add('overlay-mode');

createRoot(root).render(<StrictMode>{isOverlay ? <Overlay /> : <App />}</StrictMode>);
