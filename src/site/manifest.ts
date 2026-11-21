/**
 * A docs site's information architecture: which repository Markdown becomes which page, and the
 * sidebar tree. `syncSite` reads it to write `src/content/docs/`, and `defineXtandardSite` reads it
 * to build the sidebar, so a page and its sidebar entry cannot drift.
 *
 * The Markdown in the repository (README.md, docs/*.md) stays the single source of truth: it is what
 * GitHub and npm render. A page is one of:
 *
 * - a whole repository file (`src`);
 * - some H2 sections of one (`src` + `sections`, optionally `intro` for the text above the first H2).
 *   Every H2 of a split guide must land on exactly one page;
 * - a page written for the site only (`site`, relative to `site/content/`).
 *
 * A page marked `pending` is a guide that has not landed yet. While its `src` is missing it is left
 * out of the site, and links to it go to GitHub (with a warning) instead of failing the build.
 *
 * Plain Node APIs only: Astro loads this through Vite, and the sync step runs it directly.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One page of the site. */
export interface SitePage {
  /** Route without the base and without slashes; `""` is the home page. */
  slug: string;
  /** Sidebar label; the page title when absent. */
  label?: string;
  /** Repository file the page is built from. */
  src?: string;
  /** Only these H2 sections of `src` (by heading text, in file order). */
  sections?: string[];
  /** With `sections`: also the H1 and the text above the first H2. */
  intro?: boolean;
  /** Page title when it does not come from the source's H1. */
  title?: string;
  /** Meta description when the first paragraph of the source does not make a good one. */
  description?: string;
  /** Site-only page in `site/content/` (`.md` or `.mdx`). */
  site?: string;
  /** Contributor-only material: a banner says so and search skips it. */
  internal?: boolean;
  /** A guide that has not landed yet: left out (links go to GitHub) until `src` exists. */
  pending?: boolean;
}

/** An external sidebar link. */
export interface SiteLink {
  label: string;
  link: string;
}

/** A sidebar group. */
export interface SiteGroup {
  label: string;
  collapsed?: boolean;
  items: SiteItem[];
}

/** A sidebar item. */
export type SiteItem = SitePage | SiteLink | SiteGroup;

/** A public entry point: its API reference module, import specifier and source file. */
export interface ApiEntry {
  /** TypeDoc module name (its `@module` tag) and route under `/api/`: the subpath, or the root name. */
  name: string;
  /** `@xtandard/kit/storage`. */
  importPath: string;
  /** Repository-relative source file. */
  source: string;
}

/** Options for {@link defineSiteManifest}. */
export interface SiteManifestOptions {
  /** Absolute path of the repository root. */
  repoRoot: string;
  /** Absolute path of the site directory; `<repoRoot>/site` by default. */
  siteDir?: string;
  /** `owner/repo` on GitHub. */
  repoSlug: string;
  /** The npm package name (`@xtandard/flags`). */
  packageName: string;
  /** The API module name of the package root (its `@module` tag); the unscoped name by default. */
  rootModule?: string;
  /** Default branch; `"main"`. */
  branch?: string;
  /** Default site origin; overridden by `SITE_ORIGIN`. `https://me.xantiagoma.com` by default. */
  origin?: string;
  /** Default base path (`"/xtandard-flags"`); overridden by `SITE_BASE`. */
  base: string;
  /** The home page; `{ slug: "", site: "index.mdx" }` by default. */
  home?: SitePage;
  /** The sidebar tree, pending pages included. */
  sidebar: SiteItem[];
  /** `docs/` Markdown files that are not guides (skipped by the "every guide is a page" check). */
  ignoreDocs?: (path: string) => boolean;
  /** `docs/assets/` files served at the site root; favicons and the social card by default. */
  publicAssets?: string[];
  /** Environment to read `SITE_ORIGIN`/`SITE_BASE` from; `process.env` by default. */
  env?: Record<string, string | undefined>;
}

/** A resolved site manifest. */
export interface SiteManifest {
  repoRoot: string;
  siteDir: string;
  repoSlug: string;
  repoUrl: string;
  npmUrl: string;
  packageName: string;
  rootModule: string;
  branch: string;
  /** Always `https://` (configure-pages reports a custom domain as `http://`). */
  siteOrigin: string;
  /** No trailing slash. */
  siteBase: string;
  home: SitePage;
  /** The sidebar tree without the pending guides that have not landed yet. */
  sidebar: SiteItem[];
  publicAssets: string[];
  ignoreDocs: (path: string) => boolean;
  /** Every page, the home page first (pending guides only once they exist). */
  pages(): SitePage[];
  /** Pending guides whose source does not exist yet. */
  pendingPages(): SitePage[];
  /** Every public entry point, in `package.json` `exports` order. */
  apiEntries(): ApiEntry[];
}

/** Whether a sidebar item is a page. */
export const isPage = (i: SiteItem): i is SitePage => "slug" in i;
/** Whether a sidebar item is a group. */
export const isGroup = (i: SiteItem): i is SiteGroup => "items" in i;

function walk(items: SiteItem[], out: SitePage[] = []): SitePage[] {
  for (const i of items) {
    if (isPage(i)) out.push(i);
    else if (isGroup(i)) walk(i.items, out);
  }
  return out;
}

/**
 * Every public entry point of the package at `repoRoot`, in `exports` order. Skips stylesheets,
 * wildcards, JSON and `./package.json`. A subpath maps to `src/entry-<subpath with dashes>.ts` when
 * that file exists, otherwise to `src/<subpath>.ts(x)`; the root maps to `src/index.ts`.
 */
export function apiEntries(repoRoot: string, packageName: string, rootModule: string): ApiEntry[] {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>;
  };
  return Object.keys(pkg.exports ?? {})
    .filter(
      (key) =>
        key !== "./package.json" &&
        !key.includes("*") &&
        !key.endsWith(".css") &&
        !key.endsWith(".json"),
    )
    .map((key) => {
      const sub = key.replace(/^\.\/?/, "");
      const candidates =
        sub === ""
          ? ["src/index.ts"]
          : [`src/entry-${sub.replaceAll("/", "-")}.ts`, `src/${sub}.ts`, `src/${sub}.tsx`];
      const source = candidates.find((f) => existsSync(join(repoRoot, f)));
      if (!source) throw new Error(`site manifest: no source file for the "${key}" export`);
      return {
        name: sub === "" ? rootModule : sub,
        importPath: sub === "" ? packageName : `${packageName}/${sub}`,
        source,
      };
    });
}

const DEFAULT_ASSETS = ["favicon.svg", "favicon.ico", "apple-touch-icon.png", "social.png"];

/** Resolve a site manifest from the product's options. */
export function defineSiteManifest(options: SiteManifestOptions): SiteManifest {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot;
  const repoUrl = `https://github.com/${options.repoSlug}`;
  const rootModule = options.rootModule ?? options.packageName.replace(/^@[^/]+\//, "");
  const home = options.home ?? { slug: "", site: "index.mdx" };
  const present = (p: SitePage) => !p.pending || !p.src || existsSync(join(repoRoot, p.src));
  const prune = (items: SiteItem[]): SiteItem[] =>
    items.flatMap((i): SiteItem[] => {
      if (isPage(i)) return present(i) ? [i] : [];
      if (isGroup(i)) {
        const kept = prune(i.items);
        return kept.length ? [{ ...i, items: kept }] : [];
      }
      return [i];
    });
  const sidebar = prune(options.sidebar);
  return {
    repoRoot,
    siteDir: options.siteDir ?? join(repoRoot, "site"),
    repoSlug: options.repoSlug,
    repoUrl,
    npmUrl: `https://www.npmjs.com/package/${options.packageName}`,
    packageName: options.packageName,
    rootModule,
    branch: options.branch ?? "main",
    siteOrigin: (env.SITE_ORIGIN || options.origin || "https://me.xantiagoma.com")
      .replace(/^http:\/\//, "https://")
      .replace(/\/+$/, ""),
    siteBase: (env.SITE_BASE || options.base).replace(/\/+$/, ""),
    home,
    sidebar,
    publicAssets: options.publicAssets ?? DEFAULT_ASSETS,
    ignoreDocs: options.ignoreDocs ?? (() => false),
    pages: () => [home, ...walk(sidebar)],
    pendingPages: () => walk(options.sidebar).filter((p) => !present(p)),
    apiEntries: () => apiEntries(repoRoot, options.packageName, rootModule),
  };
}
