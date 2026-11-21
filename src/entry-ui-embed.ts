/**
 * `@xtandard/kit/ui/embed` — `createEmbed({ App, scopeClass, api, themeKey })` builds a product's
 * React embed (`Dashboard` + the token-scoped `TokenEmbed`) on the shared plumbing: synchronous
 * API base, one theme per embed on the scoped wrapper, portals inside the wrapper, hash / browser
 * / memory routing (the memory router keeps its query string), and query invalidation when the
 * token changes.
 *
 * Optional peers: `react`, `react-dom`, `wouter`, `@tanstack/react-query`.
 *
 * @module ui/embed
 */

export {
  createEmbed,
  useEmbedRouting,
  type CreateEmbedOptions,
  type Embed,
  type EmbedBaseProps,
  type EmbedRouting,
  type EmbedTheme,
  type TokenEmbedBaseProps,
} from "./ui/embed.tsx";
