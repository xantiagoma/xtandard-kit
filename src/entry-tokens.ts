/**
 * `@xtandard/kit/tokens` — scoped HMAC tokens (the products' portal and viewer
 * tokens): `<prefix><payload>.<signature>`, WebCrypto only, with secret
 * rotation.
 *
 * @module
 */

export {
  createScopedTokens,
  TokenError,
  type CreateTokenOptions,
  type ScopedTokens,
  type ScopedTokensOptions,
  type TokenSecret,
  type VerifiedToken,
} from "./tokens/scoped.ts";
