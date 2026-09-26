import { contextBridge, ipcRenderer } from 'electron';
import type {
  AudioMode,
  CaptureTarget,
  RegionRect,
  HudCommand,
  HudState,
  CaptureSource,
  DisplayInfo,
  QualityPreset,
  Recording,
  RecordingListItem,
  FolderEntry,
  FolderListing,
  RevealRequest,
} from '../shared/types.js';

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
  setCaptureTarget: (target: CaptureTarget): Promise<void> =>
    ipcRenderer.invoke('capture:set-target', target),
  selectRegion: (): Promise<RegionRect | null> => ipcRenderer.invoke('region:select'),

  // Used only by the region selector window, to report its result.
  reportRegion: (rect: RegionRect | null): void => {
    ipcRenderer.send('region:result', rect);
  },
  getPrimaryDisplay: (): Promise<DisplayInfo> => ipcRenderer.invoke('display:primary'),

  getQuality: (): Promise<QualityPreset> => ipcRenderer.invoke('settings:get-quality'),
  setQuality: (preset: QualityPreset): Promise<void> =>
    ipcRenderer.invoke('settings:set-quality', preset),

  getAudioMode: (): Promise<AudioMode> => ipcRenderer.invoke('settings:get-audio'),
  setAudioMode: (mode: AudioMode): Promise<void> => ipcRenderer.invoke('settings:set-audio', mode),

  getMicDevice: (): Promise<string> => ipcRenderer.invoke('settings:get-mic'),
  setMicDevice: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke('settings:set-mic', deviceId),

  beginRecording: (ext: string): Promise<string> => ipcRenderer.invoke('recordings:begin', ext),
  appendChunk: (recordingId: string, chunk: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('recordings:append', recordingId, chunk),
  finishRecording: (recordingId: string): Promise<Recording> =>
    ipcRenderer.invoke('recordings:finish', recordingId),
  abortRecording: (recordingId: string): Promise<void> =>
    ipcRenderer.invoke('recordings:abort', recordingId),

  listRecordings: (): Promise<RecordingListItem[]> => ipcRenderer.invoke('recordings:list'),
  deleteRecording: (filePath: string, permanent: boolean): Promise<void> =>
    ipcRenderer.invoke('recordings:delete', filePath, permanent),
  openRecordingExternally: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('recordings:open-external', filePath),

  browseRecordings: (relativeDir: string): Promise<FolderListing> =>
    ipcRenderer.invoke('recordings:browse', relativeDir),
  listFolders: (): Promise<FolderEntry[]> => ipcRenderer.invoke('recordings:folders'),
  createFolder: (parent: string, name: string): Promise<string> =>
    ipcRenderer.invoke('recordings:create-folder', parent, name),
  moveRecording: (filePath: string, targetDir: string): Promise<string> =>
    ipcRenderer.invoke('recordings:move', filePath, targetDir),
  deleteFolder: (relativeDir: string): Promise<void> =>
    ipcRenderer.invoke('recordings:delete-folder', relativeDir),
  revealFolder: (relativeDir: string): Promise<void> =>
    ipcRenderer.invoke('recordings:reveal-folder', relativeDir),

  announceRecording: (filePath: string): void => {
    ipcRenderer.send('recordings:changed', filePath);
  },
  onRecordingsChanged: (handler: (filePath: string) => void): (() => void) => {
    const listener = (_e: unknown, filePath: string): void => handler(filePath);
    ipcRenderer.on('recordings:changed', listener);
    return () => ipcRenderer.removeListener('recordings:changed', listener);
  },
  onSuspendPlayback: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on('library:suspend', listener);
    return () => ipcRenderer.removeListener('library:suspend', listener);
  },

  resizeBar: (height: number): void => {
    ipcRenderer.send('bar:resize', height);
  },
  openLibrary: (): Promise<void> => ipcRenderer.invoke('library:open'),
  revealInLibrary: (filePath: string, play: boolean): Promise<void> =>
    ipcRenderer.invoke('library:reveal', filePath, play),
  takePendingReveal: (): Promise<RevealRequest | null> =>
    ipcRenderer.invoke('library:take-pending'),
  onShowRecording: (handler: (request: RevealRequest) => void): (() => void) => {
    const listener = (_e: unknown, request: RevealRequest): void => handler(request);
    ipcRenderer.on('library:show', listener);
    return () => ipcRenderer.removeListener('library:show', listener);
  },
  getThumbnail: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('thumbs:get', filePath),
  putThumbnail: (filePath: string, jpeg: ArrayBuffer): Promise<void> =>
    ipcRenderer.invoke('thumbs:put', filePath, jpeg),

  getFreeSpace: (): Promise<number | null> => ipcRenderer.invoke('recordings:free-space'),

  reportProblem: (level: 'error' | 'warn', message: string): void => {
    ipcRenderer.send('log:renderer', level, message);
  },
  openLog: (): Promise<void> => ipcRenderer.invoke('log:open'),

  showBar: (): Promise<void> => ipcRenderer.invoke('bar:show'),
  hideBar: (): Promise<void> => ipcRenderer.invoke('bar:hide'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),

  revealRecording: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('recordings:reveal', filePath),
  getRecordingsDir: (): Promise<string> => ipcRenderer.invoke('recordings:dir'),

  // The overlay and the recorder never speak directly -- main relays, so neither
  // window needs a handle on the other and the overlay can come and go freely.
  publishHudState: (state: HudState): void => {
    ipcRenderer.send('hud:state', state);
  },
  onHudCommand: (handler: (command: HudCommand) => void): (() => void) => {
    const listener = (_e: unknown, command: HudCommand): void => handler(command);
    ipcRenderer.on('hud:command', listener);
    return () => ipcRenderer.removeListener('hud:command', listener);
  },

  sendHudCommand: (command: HudCommand): void => {
    ipcRenderer.send('hud:command', command);
  },
  onHudState: (handler: (state: HudState) => void): (() => void) => {
    const listener = (_e: unknown, state: HudState): void => handler(state);
    ipcRenderer.on('hud:state', listener);
    return () => ipcRenderer.removeListener('hud:state', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
