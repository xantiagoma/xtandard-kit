/**
 * `@xtandard/kit/authorization` — the authorization contract, generic over a
 * product's action and resource unions, and `defineActions` to build a
 * product's action constants. Implementations live on `authorization/none`,
 * `authorization/roles` and `authorization/delegated`.
 *
 * @module
 */

export {
  defineActions,
  type ActionsDefinition,
  type ActionsDefinitionResult,
  type AuthorizationProvider,
  type AuthorizeInput,
} from "./authorization/contract.ts";
