import { definePlaywrightConfig } from "./src/build/config.ts";

/**
 * Browser e2e for the UI kit: builds a test host (e2e/host) from the kit sources — the shell via
 * `bootSpa` and the embed via `createEmbed`, its stylesheet scoped like a product's — and checks
 * theme switching, CSS scoping and the memory router's query string.
 *
 *   bun run test:e2e
 */
export default definePlaywrightConfig({
  port: 3511,
  serverCmd: "bun e2e/build-host.ts && bun e2e/server.ts",
});
