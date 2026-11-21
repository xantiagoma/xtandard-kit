# Docs site

`@xtandard/kit/site` is the tooling behind every product's documentation site: an Astro Starlight
site over the repository's Markdown, plus a TypeDoc API reference with one module per `exports`
entry. It replaces each product's `site/scripts/{sync,typedoc-plugin,api-overviews}.ts` and most of
`site/astro.config.ts` and `site/manifest.ts`. The kit's own site (`site/` in this repo) is built
with it.

`README.md` and `docs/*.md` stay the source of truth: they are what GitHub and npm render. The site
only adapts copies of them.

## Layout of a product site

```
site/
  package.json        # its own deps and lockfile, not published
  manifest.ts         # defineSiteManifest(…): pages and sidebar
  astro.config.ts     # export default await defineXtandardSite({ manifest, … })
  scripts/sync.ts     # process.exit(runSync(manifest))
  typedoc.tsconfig.json
  src/content.config.ts
  src/styles/brand.css
  content/index.mdx   # site-only pages
```

`site/package.json` lists `@xtandard/kit` next to the site's own dependencies: `astro`,
`@astrojs/starlight`, `starlight-typedoc`, `typedoc`, `typedoc-plugin-markdown`,
`typedoc-plugin-missing-exports`, `typescript`, `astro-mermaid`, `mermaid` and
`starlight-links-validator`. The kit loads those integrations when the config runs, resolving them
from the site's own install. That is why the kit must be installed in `site/node_modules`, not only
at the repo root. In the kit repo itself the site uses `"@xtandard/kit": "file:.."`, which Bun
copies, so `bun run build` must run at the root first.

## The manifest

```ts
// site/manifest.ts
import { fileURLToPath } from "node:url";
import { defineSiteManifest } from "@xtandard/kit/site";

export const manifest = defineSiteManifest({
  repoRoot: fileURLToPath(new URL("../", import.meta.url)),
  repoSlug: "xantiagoma/xtandard-flags",
  packageName: "@xtandard/flags",
  rootModule: "flags", // the root entry's @module name
  base: "/xtandard-flags",
  sidebar: [
    {
      label: "Start here",
      items: [
        { slug: "why", src: "README.md", sections: ["Why another flag tool?"], title: "Why" },
        { slug: "getting-started", src: "docs/GETTING_STARTED.md" },
      ],
    },
    // …
    { slug: "openfeature", src: "docs/OPENFEATURE.md", pending: true },
  ],
});
```

A page is one of:

- a whole file (`src`);
- some H2 sections of one (`src` + `sections`, plus `intro` for the text above the first H2). Every
  H2 of a split guide must land on exactly one page, so a new section can't silently disappear;
- a site-only page (`site`, relative to `site/content/`). `@BASE@`, `@REPO@` and `@NPM@` are
  replaced in it.

`internal: true` adds a "contributor documentation" banner and hides the page from search.

`SITE_ORIGIN` and `SITE_BASE` override the origin and base; `pages.yml` passes what
`actions/configure-pages` reports. The origin is always upgraded to `https://`, because
configure-pages reports a custom domain as `http://`, which would leak into `og:url`, `og:image` and
the sitemap.

`manifest.apiEntries()` lists every public entry point in `package.json` `exports` order: the root
is `src/index.ts`, and a subpath is `src/entry-<subpath with dashes>.ts`, else `src/<subpath>.ts(x)`.
Each entry file starts with a `@module` doc comment that names and describes its API page.

### Pending guides

A guide that hasn't landed yet (another branch is writing it, or changelogen writes `CHANGELOG.md`
on the first release) is a page with `pending: true`. This is the one pending design; it replaces
au's `pendingPages()` and en's `pending` map:

- while its `src` is missing, the page and its sidebar entry are left out (an emptied group too);
- links to it go to the file on GitHub, and the sync prints a warning instead of failing;
- once the file exists, it is a normal page, and links to it become site routes.

## The sync step

`bun scripts/sync.ts` (`runSync(manifest)`) writes `site/src/content/docs/` before every
`dev`/`build`:

- The title comes from the H1 (or the page's `title`), the description from the first prose
  paragraph (or `description`), and "Edit page" opens the source file.
- Relative links to files that are pages become site routes, pointing at whichever page holds the
  anchor. In a split guide, a `#anchor` may now live on a sibling page.
- Links to other repository files become GitHub URLs (`blob`, or `tree` for directories); images
  become `raw.githubusercontent.com` URLs.
- A link to a missing file, outside the repository, or malformed fails the build. A link to a
  pending guide is a warning.
- GitHub alerts (`> [!WARNING]`) become Starlight asides.
- Code blocks and inline code are never rewritten.
- Every `docs/**/*.md` must be a page (or pending, or excluded with `ignoreDocs`), so a new guide
  can't be forgotten.
- The brand files in `publicAssets` (by default `favicon.svg`, `favicon.ico`,
  `apple-touch-icon.png` and `social.png`) are copied from `docs/assets/` into `site/public/`
  (gitignored), so `docs/assets/` stays their only copy.

## The Astro config

```ts
// site/astro.config.ts
import { defineXtandardSite } from "@xtandard/kit/site";
import { manifest } from "./manifest.ts";

export default await defineXtandardSite({
  manifest,
  description: "A self-hosted, embeddable, OpenFeature-compatible feature-flag control plane…",
  tagline: "Feature flags you own",
  apiOwners: ["src/core.ts", "src/index.ts"],
  devPort: 4322,
});
```

- **Starlight**: the header lockups from `docs/assets/lockup-horizontal-{dark,light}.svg` when they
  exist, `brandCss` (default `./src/styles/brand.css`), and the edit link.
- **Head tags**: favicon, `favicon.ico` (`16x16 32x32 48x48`), apple-touch icon, `theme-color`,
  and the social card (`og:image` with its size and `og:image:alt` from the tagline, plus the
  Twitter card). A tag is emitted only for an asset the site serves (`publicAssets`).
- **API reference**: starlight-typedoc over `manifest.apiEntries()`, with `apiOwners` first.
  A symbol several entry points export is documented under the first owner TypeDoc meets. An owner
  that isn't an entry point throws. The reference goes in the sidebar before the last group.
- **The TypeDoc plugin** (`createTypedocPlugin`) documents a function whose return type is one of
  the package's own type aliases with that alias, as written, instead of the resolved type. It also
  records which entry points re-export which symbols in `site/.astro/api-reexports.json`.
- **Overview pages** (`apiOverviews`): `/api/` lists every entry point in `exports` order, and
  `/api/<module>/` lists its members by kind, with the `@module` description. It says which other
  entry points the module re-exports from (only `export … from` counts) and links re-exported
  symbols to the page that documents them.
- **Mermaid** (`astro-mermaid`; `mermaid: false` to drop it) and the **links validator**, which
  fails the build on a broken internal link or anchor (local `http://localhost` links are allowed).
- `devPort` sets `server.port`, so the scripts don't repeat it.

`typeDoc` and `starlight` merge extra options over the defaults. `peers` passes already-imported
integrations, for an unusual install layout.
