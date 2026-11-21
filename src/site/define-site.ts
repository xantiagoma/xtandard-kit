/**
 * `defineXtandardSite` builds a product docs site's Astro config: Starlight over the synced
 * Markdown, the TypeDoc API reference (starlight-typedoc, with the kit's plugin and overview
 * pages), Mermaid diagrams, the links validator, and the family's head tags (favicons, social
 * card, theme colour). Products pass their copy, palette, API owners and dev port.
 *
 * The integrations are optional peers, loaded from the site's own install, so the function is
 * async: `export default await defineXtandardSite({ … })`.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AstroUserConfig } from "astro";
import { apiOverviews } from "./api-overviews.ts";
import { isGroup, isPage, type SiteItem, type SiteManifest } from "./manifest.ts";
import { importFromSite } from "./resolve.ts";
import { createTypedocPlugin, loadSiteModules } from "./typedoc-plugin.ts";

type IntegrationFactory = (options: Record<string, unknown>) => unknown;

/** A Starlight sidebar entry. */
export type StarlightSidebarItem =
  | { slug: string; label?: string }
  | { label: string; link: string }
  | { label: string; collapsed?: boolean; items: StarlightSidebarItem[] };

/** The manifest's sidebar as Starlight sidebar entries. */
export function toStarlightSidebar(items: SiteItem[]): StarlightSidebarItem[] {
  return items.map((i) => {
    if (isPage(i)) return i.label ? { slug: i.slug, label: i.label } : { slug: i.slug };
    if (isGroup(i))
      return { label: i.label, collapsed: i.collapsed, items: toStarlightSidebar(i.items) };
    return { label: i.label, link: i.link };
  });
}

/**
 * The API entry files in documentation order: `apiOwners` first (a symbol exported by several
 * entry points is documented under the first one TypeDoc meets), then the rest alphabetically — a
 * fixed order, since a glob's order differs between file systems. Throws when an owner is not an
 * entry point.
 */
export function orderedEntryPoints(manifest: SiteManifest, apiOwners: string[] = []): string[] {
  const sources = manifest.apiEntries().map((e) => e.source);
  for (const o of apiOwners)
    if (!sources.includes(o)) throw new Error(`defineXtandardSite: ${o} is not an entry point`);
  return [...apiOwners, ...sources.filter((f) => !apiOwners.includes(f)).sort()];
}

/** Options for {@link defineXtandardSite}. */
export interface XtandardSiteOptions {
  /** The site manifest (`defineSiteManifest`), shared with the sync script. */
  manifest: SiteManifest;
  /** Meta description of the site. */
  description: string;
  /** The social card's tagline, for its alt text. */
  tagline: string;
  /** Entry files other entry points re-export from, in ownership order (`src/core.ts`…). */
  apiOwners?: string[];
  /** `astro dev` / `preview` port (wh 4323, fl 4322, au 4326, li 4331, en 4324). */
  devPort?: number;
  /** Palette stylesheet(s), relative to the site; `./src/styles/brand.css` by default. */
  brandCss?: string | string[];
  /** Site title; the package name by default. */
  title?: string;
  /**
   * The header lockups (relative to the site), or `false` for the text title. Defaults to
   * `../docs/assets/lockup-horizontal-{dark,light}.svg` when they exist.
   */
  logo?: { dark: string; light: string } | false;
  /** The TypeDoc tsconfig, relative to the site; `./typedoc.tsconfig.json` by default. */
  typedocTsconfig?: string;
  /** Extra TypeDoc options (merged over the defaults). */
  typeDoc?: Record<string, unknown>;
  /** Mermaid diagrams (`astro-mermaid`); default `true`. */
  mermaid?: boolean;
  /** `theme-color` meta; `#0f1215` by default. */
  themeColor?: string;
  /** Slug of the "Entry points" page linked from `/api/`; see `apiOverviews`. */
  entryPointsSlug?: string | false;
  /** Extra Starlight options, merged last. */
  starlight?: Record<string, unknown>;
  /**
   * Already-imported integrations, used instead of importing them (an unusual install layout,
   * tests). Each one left out is imported from the site's install.
   */
  peers?: Partial<SitePeers>;
}

/** The integrations {@link defineXtandardSite} uses. */
export interface SitePeers {
  starlight: (typeof import("@astrojs/starlight"))["default"];
  createStarlightTypeDocPlugin: (typeof import("starlight-typedoc"))["createStarlightTypeDocPlugin"];
  linksValidator: IntegrationFactory;
  mermaid: IntegrationFactory;
  /** The site's `typedoc` and `typescript`, for the TypeDoc plugin. */
  typedoc: { typedoc: typeof import("typedoc"); typescript: typeof import("typescript") };
}

type Integration = NonNullable<AstroUserConfig["integrations"]>[number];

/** Build the site's Astro config. */
export async function defineXtandardSite(options: XtandardSiteOptions): Promise<AstroUserConfig> {
  const m = options.manifest;
  const peers = options.peers ?? {};
  // Resolved from the site's own install, so Astro, Starlight and TypeDoc are the site's instances.
  const fromSite = <T>(name: string) => importFromSite<T>(name, m.siteDir);
  const [starlight, createStarlightTypeDocPlugin, linksValidator] = await Promise.all([
    peers.starlight ??
      fromSite<typeof import("@astrojs/starlight")>("@astrojs/starlight").then(
        (mod) => mod.default,
      ),
    peers.createStarlightTypeDocPlugin ??
      fromSite<typeof import("starlight-typedoc")>("starlight-typedoc").then(
        (mod) => mod.createStarlightTypeDocPlugin,
      ),
    peers.linksValidator ??
      fromSite<{ default: IntegrationFactory }>("starlight-links-validator").then(
        (mod) => mod.default,
      ),
  ]);
  // Loaded now, while the config is being evaluated (see TypedocPluginOptions.modules).
  const typedocModules = peers.typedoc ?? (await loadSiteModules(m.siteDir));
  const entryPoints = orderedEntryPoints(m, options.apiOwners);
  const title = options.title ?? m.packageName;
  const socialImage = `${m.siteOrigin}${m.siteBase}/social.png`;
  const serves = (asset: string) => m.publicAssets.includes(asset);
  const logo =
    options.logo === false
      ? undefined
      : (options.logo ??
        (existsSync(join(m.repoRoot, "docs/assets/lockup-horizontal-dark.svg")) &&
        existsSync(join(m.repoRoot, "docs/assets/lockup-horizontal-light.svg"))
          ? {
              dark: "../docs/assets/lockup-horizontal-dark.svg",
              light: "../docs/assets/lockup-horizontal-light.svg",
            }
          : undefined));
  const brandCss = options.brandCss ?? "./src/styles/brand.css";

  const [apiReference, apiSidebarGroup] = createStarlightTypeDocPlugin();
  const sidebar = toStarlightSidebar(m.sidebar);

  const integrations: Integration[] = [];
  if (options.mermaid !== false) {
    // Must come before Starlight.
    const mermaid =
      peers.mermaid ?? (await fromSite<{ default: IntegrationFactory }>("astro-mermaid")).default;
    integrations.push(
      mermaid({ theme: "neutral", autoTheme: true, enableLog: false }) as Integration,
    );
  }
  integrations.push(
    starlight({
      title,
      description: options.description,
      ...(logo ? { logo: { ...logo, alt: title, replacesTitle: true } } : {}),
      // Only the brand files the site serves (manifest `publicAssets`, copied by the sync step).
      ...(serves("favicon.svg") ? { favicon: "/favicon.svg" } : {}),
      head: [
        ...(serves("favicon.ico")
          ? [
              {
                tag: "link" as const,
                attrs: {
                  rel: "icon",
                  href: `${m.siteBase}/favicon.ico`,
                  sizes: "16x16 32x32 48x48",
                },
              },
            ]
          : []),
        ...(serves("apple-touch-icon.png")
          ? [
              {
                tag: "link" as const,
                attrs: { rel: "apple-touch-icon", href: `${m.siteBase}/apple-touch-icon.png` },
              },
            ]
          : []),
        {
          tag: "meta" as const,
          attrs: { name: "theme-color", content: options.themeColor ?? "#0f1215" },
        },
        ...(serves("social.png")
          ? (
              [
                { property: "og:image", content: socialImage },
                { property: "og:image:width", content: "1280" },
                { property: "og:image:height", content: "640" },
                { property: "og:image:alt", content: `${m.packageName} — ${options.tagline}` },
                { name: "twitter:card", content: "summary_large_image" },
                { name: "twitter:image", content: socialImage },
              ] as Record<string, string>[]
            ).map((attrs) => ({ tag: "meta" as const, attrs }))
          : []),
      ],
      social: [
        { icon: "github", label: "GitHub", href: m.repoUrl },
        { icon: "npm", label: "npm", href: m.npmUrl },
      ],
      editLink: { baseUrl: `${m.repoUrl}/edit/${m.branch}/` },
      lastUpdated: false,
      customCss: Array.isArray(brandCss) ? brandCss : [brandCss],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      // The API reference goes before the last group (the project group).
      sidebar: [...sidebar.slice(0, -1), apiSidebarGroup, ...sidebar.slice(-1)],
      plugins: [
        apiReference({
          entryPoints: entryPoints.map((f) => join(m.repoRoot, f)),
          tsconfig: options.typedocTsconfig ?? "./typedoc.tsconfig.json",
          output: "api",
          sidebar: { label: "API reference", collapsed: true },
          typeDoc: {
            // Named return types as written, and the re-export list on each module page.
            plugin: [
              "typedoc-plugin-missing-exports",
              createTypedocPlugin(m.siteDir, {
                modules: typedocModules,
                moduleNames: Object.fromEntries(
                  m.apiEntries().map((e) => [join(m.repoRoot, e.source), e.name]),
                ),
              }),
            ],
            placeInternalsInOwningModule: true,
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
            disableGit: true,
            // The project's own typecheck covers the program; TypeDoc only reads src/.
            skipErrorChecking: true,
            // {path} is relative to src/ (the entry points' common directory).
            sourceLinkTemplate: `${m.repoUrl}/blob/${m.branch}/src/{path}#L{line}`,
            useCodeBlocks: true,
            parametersFormat: "table",
            interfacePropertiesFormat: "table",
            classPropertiesFormat: "table",
            typeDeclarationFormat: "table",
            enumMembersFormat: "table",
            ...options.typeDoc,
          } as never,
        }),
        // After starlight-typedoc (plugins run in order): the /api/ and /api/<module>/ pages.
        apiOverviews(m, { entryPointsSlug: options.entryPointsSlug }),
        linksValidator({
          errorOnRelativeLinks: false,
          errorOnInvalidHashes: true,
          // The guides point at the local servers they start (http://localhost:3000).
          errorOnLocalLinks: false,
        }) as ReturnType<typeof apiOverviews>,
      ],
      ...options.starlight,
    }),
  );

  return {
    site: m.siteOrigin,
    base: m.siteBase,
    trailingSlash: "ignore",
    telemetry: false,
    ...(options.devPort ? { server: { port: options.devPort } } : {}),
    integrations,
  } as AstroUserConfig;
}
