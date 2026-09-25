/** Types for log.cjs — CommonJS so it loads before app-ready with no build step. */

/** Begin logging to `dir`, mirroring console output. Returns the log file path. */
export declare function start(dir: string): string;

/** Record something a renderer window reported. */
export declare function fromRenderer(level: 'error' | 'warn', message: string): void;

/** Path of the current log file, or null before `start`. */
export declare function currentPath(): string | null;

export declare const MAX_BYTES: number;
