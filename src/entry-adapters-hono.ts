/**
 * `@xtandard/kit/adapters/hono` — mount a panel on a Hono app, and read
 * `waitUntil` safely on every runtime (no runtime `hono` import).
 *
 * Optional peer: `hono` (the app is passed in).
 *
 * @module
 */

export {
  mountPanel,
  toHonoHandler,
  waitUntilOf,
  type HonoAppLike,
  type HonoContextLike,
  type WaitUntil,
} from "./adapters/hono.ts";
