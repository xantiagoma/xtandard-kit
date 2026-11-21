/**
 * The compare-and-swap algorithm shared by drivers whose stored form can predate canonical JSON
 * (ADR 0005): a canonical single-statement fast path, then a structural fallback that reads the
 * stored value, compares it with `deepEqual` and swaps conditionally on the **raw** stored form,
 * with bounded retries. Internal.
 *
 * @module
 */

import { deepEqual } from "../internal/json.ts";

/** How many read → compare → raw-swap rounds the fallback tries before giving up. */
export const CAS_RETRIES = 16;

/** The driver-specific steps of {@link swapWithFallback}. */
export interface FallbackSteps<Raw> {
  /** The fast path: swap when the stored form equals the canonical form of `expected`. */
  fast(): Promise<boolean>;
  /** Read the stored value as `{ raw, value }`, or `null` when the key is absent. */
  read(): Promise<{ raw: Raw; value: unknown } | null>;
  /** Swap when the stored form still equals `raw` exactly. */
  swapRaw(raw: Raw): Promise<boolean>;
}

/**
 * Swap a present value (`expected !== null`): the fast path first, then, on a miss, the structural
 * fallback. Resolves `false` as soon as the stored value is absent or structurally different.
 */
export async function swapWithFallback<Raw>(
  expected: unknown,
  steps: FallbackSteps<Raw>,
): Promise<boolean> {
  if (await steps.fast()) return true;
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const current = await steps.read();
    if (current === null || !deepEqual(current.value, expected)) return false;
    if (await steps.swapRaw(current.raw)) return true;
  }
  return false;
}
