/**
 * `@xtandard/kit/adapters/express` — serve a panel from Express through the
 * shared Node bridge (no runtime `express` import).
 *
 * Optional peer: `express` (types only).
 *
 * @module
 */

export {
  toExpressMiddleware,
  type ExpressMiddleware,
  type ExpressMiddlewareOptions,
} from "./adapters/express.ts";
