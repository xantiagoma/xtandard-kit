/** The conformance suite with `bun:test` injected (ADR 0006: the runner is a parameter). */
import { describe, expect, test } from "bun:test";
import { createMemoryStorage } from "../src/storage/memory.ts";
import { runStorageConformance } from "../src/storage/testing/conformance.ts";

runStorageConformance("memory (bun:test)", () => createMemoryStorage(), {
  t: { describe, test, expect },
  capabilities: { compareAndSwap: true, watch: { settleMs: 5 } },
});
