import type { PreloadApi } from './index.js';

declare global {
  interface Window {
    api: PreloadApi;
  }
}

export {};
