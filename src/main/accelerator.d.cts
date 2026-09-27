/** Types for accelerator.cjs — CommonJS so the verifier can require it unbuilt. */

export type AcceleratorCheck = { ok: true; value: string } | { ok: false; reason: string };

/** Validate an accelerator and return its one canonical spelling. */
export declare function normalizeAccelerator(input: unknown): AcceleratorCheck;

export declare const KEYS: readonly string[];
export declare const MODIFIERS: readonly string[];
export declare const MAX_MODIFIERS: number;
export declare const STANDALONE_KEYS: readonly string[];
