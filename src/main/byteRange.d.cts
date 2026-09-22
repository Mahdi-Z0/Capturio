/** Types for byteRange.cjs — CommonJS so the verifier can require it unbuilt. */

export type RangeDecision =
  | { kind: 'whole' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

/** Decide what to serve for a `Range` header against a file of `size` bytes. */
export declare function parseRange(
  header: string | null | undefined,
  size: number,
): RangeDecision;

/** Build the response for a recording request, honouring `Range`. */
export declare function createRangeResponse(
  rangeHeader: string | null | undefined,
  filePath: string,
  size: number,
  contentType: string,
): Response;
