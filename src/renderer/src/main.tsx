import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import Bar from './Bar.js';
import RegionSelector from './RegionSelector.js';
import './index.css';
import './bar.css';
import './region.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

/*
 * One bundle, three windows.
 *
 * The control bar (#bar) is the app's primary surface; the region selector
 * (#region) is transient; the default view is the recordings window. All three
 * come from this build, selected by hash, because extra Vite entries would mean
 * touching the protected build config.
 */
const view = window.location.hash;
// Before the first paint: neither transparent window may flash the app's opaque
// background while React mounts.
if (view === '#bar') document.documentElement.classList.add('bar-mode');
if (view === '#region') document.documentElement.classList.add('region-mode');

createRoot(root).render(
  <StrictMode>
    {view === '#bar' ? <Bar /> : view === '#region' ? <RegionSelector /> : <App />}
  </StrictMode>,
);
