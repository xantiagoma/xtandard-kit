/**
 * `@xtandard/kit/site` — the docs-site tooling shared by the xtandard products (Astro Starlight
 * over the repository's Markdown, plus a TypeDoc API reference):
 *
 * - `defineSiteManifest`: the information architecture (pages, sidebar, pending guides) and
 *   `apiEntries()` (one module per `exports` entry);
 * - `syncSite` / `runSync`: the pre-build step that writes `site/src/content/docs/`;
 * - `defineXtandardSite`: the Astro config (Starlight, starlight-typedoc, Mermaid, links validator,
 *   head tags);
 * - `createTypedocPlugin` and `apiOverviews`: the API reference's named return types, re-export
 *   lists and overview pages.
 *
 * Optional peers, loaded from the site's own install: `astro`, `@astrojs/starlight`,
 * `starlight-typedoc`, `typedoc`, `typescript`, `astro-mermaid`, `starlight-links-validator`.
 *
 * @module site
 */

export {
  apiEntries,
  defineSiteManifest,
  isGroup,
  isPage,
  type ApiEntry,
  type SiteGroup,
  type SiteItem,
  type SiteLink,
  type SiteManifest,
  type SiteManifestOptions,
  type SitePage,
} from "./site/manifest.ts";
export {
  alerts,
  describeMarkdown,
  mapProse,
  plain,
  runSync,
  Slugger,
  syncSite,
  type SyncResult,
} from "./site/sync.ts";
export {
  createTypedocPlugin,
  loadSiteModules,
  readReexports,
  reexportsFile,
  type Reexport,
  type TypedocPluginOptions,
} from "./site/typedoc-plugin.ts";
export { importFromSite, resolvePackageEntry } from "./site/resolve.ts";
export {
  apiOverviews,
  moduleDescription,
  writeApiOverviews,
  type ApiOverviewsOptions,
} from "./site/api-overviews.ts";
export {
  defineXtandardSite,
  orderedEntryPoints,
  toStarlightSidebar,
  type SitePeers,
  type StarlightSidebarItem,
  type XtandardSiteOptions,
} from "./site/define-site.ts";
