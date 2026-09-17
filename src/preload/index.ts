import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureSource, DisplayInfo, QualityPreset, Recording } from '../shared/types.js';

/**
 * Only this explicit surface crosses the context bridge.
 * Never expose ipcRenderer itself -- that hands the renderer the whole main process.
 *
 * Recording is streamed: begin -> append* -> finish, with abort as the failure
 * path. ArrayBuffer crosses the bridge by structured clone, so chunks need no
 * serialisation shim.
 */
const api = {
  listSources: (): Promise<CaptureSource[]> => ipcRenderer.invoke('sources:list'),
  getPrimaryDisplay: (): Promise<DisplayInfo> => ipcRenderer.invoke('display:primary'),

  getQuality: (): Promise<QualityPreset> => ipcRenderer.invoke('settings:get-quality'),
  setQuality: (preset: QualityPreset): Promise<void> =>
    ipcRenderer.invoke('settings:set-quality', preset),

  beginRecording: (ext: string): Promise<string> => ipcRenderer.invoke('recordings:begin', ext),
  appendChunk: (recordingId: string, chunk: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('recordings:append', recordingId, chunk),
  finishRecording: (recordingId: string): Promise<Recording> =>
    ipcRenderer.invoke('recordings:finish', recordingId),
  abortRecording: (recordingId: string): Promise<void> =>
    ipcRenderer.invoke('recordings:abort', recordingId),

  revealRecording: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('recordings:reveal', filePath),
  getRecordingsDir: (): Promise<string> => ipcRenderer.invoke('recordings:dir'),
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
