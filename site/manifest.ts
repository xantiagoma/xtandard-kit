// The site's information architecture: which repository Markdown becomes which page, and the
// sidebar tree (see `defineSiteManifest` in @xtandard/kit/site). scripts/sync.ts and
// astro.config.ts both read it, so a page and its sidebar entry cannot drift.
import { fileURLToPath } from "node:url";
import { defineSiteManifest, type SitePage } from "@xtandard/kit/site";

/** The architecture decision records, docs/ADR/NNNN-*.md, in number order. */
const adrs: SitePage[] = [
  ["0001-single-package-subpath-exports", "0001 · Single package, subpath exports"],
  ["0002-kit-boundary-mechanism-vs-policy", "0002 · Mechanism vs policy"],
  ["0003-product-consumption-and-api-compatibility", "0003 · Consumption and API compatibility"],
  ["0004-neutral-contracts-capabilities-extension-points", "0004 · Contracts and extension points"],
  ["0005-stored-data-compatibility", "0005 · Stored-data compatibility"],
  ["0006-shared-conformance-suite", "0006 · Shared conformance suite"],
  ["0007-versioning-policy", "0007 · Versioning policy"],
  ["0008-ui-kit-delivery", "0008 · UI kit delivery"],
  ["0009-reusable-workflows", "0009 · Reusable workflows"],
  ["0010-behaviour-differences-are-parameters", "0010 · Behaviour differences are parameters"],
].map(([file, label]) => ({
  slug: `project/adr/${file!.slice(0, 4)}`,
  src: `docs/ADR/${file}.md`,
  label,
  description: `Architecture decision record ${label!.replace(" · ", ": ")}: its context, the decision and its consequences.`,
}));

export const manifest = defineSiteManifest({
  repoRoot: fileURLToPath(new URL("../", import.meta.url)),
  repoSlug: "xantiagoma/xtandard-kit",
  packageName: "@xtandard/kit",
  rootModule: "kit",
  base: "/xtandard-kit",
  publicAssets: ["favicon.svg"],
  // The phase-1 research (inventory and data) stays on GitHub.
  ignoreDocs: (f) => f.startsWith("docs/research/"),
  sidebar: [
    {
      label: "Start here",
      items: [
        {
          slug: "entry-points",
          src: "README.md",
          sections: ["What's inside"],
          title: "Entry points (subpath exports)",
          label: "Entry points",
          description:
            "Every @xtandard/kit subpath: storage contract and drivers, auth, hooks, server plumbing, adapters, CLI, utilities, the UI kit, build and site tooling.",
        },
        { slug: "plan", src: "PLAN.md", label: "Plan", title: "Plan" },
      ],
    },
    {
      label: "Runtime",
      items: [
        { slug: "storage", src: "docs/STORAGE.md", label: "Storage" },
        { slug: "auth", src: "docs/AUTH.md", label: "Authentication" },
        { slug: "authorization", src: "docs/AUTHORIZATION.md", label: "Authorization" },
        { slug: "hooks", src: "docs/HOOKS.md", label: "Hooks" },
        { slug: "server", src: "docs/SERVER.md", label: "Server" },
        { slug: "adapters", src: "docs/ADAPTERS.md", label: "Adapters", pending: true },
        { slug: "cli", src: "docs/CLI.md", label: "CLI", pending: true },
        { slug: "tokens", src: "docs/TOKENS.md", label: "Scoped tokens" },
        { slug: "util", src: "docs/UTIL.md", label: "Utilities" },
      ],
    },
    {
      label: "UI and tooling",
      items: [
        { slug: "ui", src: "docs/UI.md", label: "UI kit" },
        { slug: "build", src: "docs/BUILD.md", label: "Build tooling" },
        { slug: "site", src: "docs/SITE.md", label: "Docs site" },
        { slug: "workflows", src: "docs/WORKFLOWS.md", label: "Reusable workflows" },
      ],
    },
    {
      label: "Project",
      items: [
        {
          slug: "project/ecosystem",
          src: "README.md",
          sections: ["The xtandard ecosystem"],
          title: "The xtandard ecosystem",
          label: "xtandard ecosystem",
        },
        { slug: "project/changelog", src: "CHANGELOG.md", label: "Changelog" },
        { slug: "project/releases", src: "docs/RELEASES.md", label: "Releases", internal: true },
        {
          slug: "project/report",
          src: "docs/REPORT.md",
          label: "Migration report",
          internal: true,
        },
        { label: "Architecture decisions", collapsed: true, items: adrs },
        { label: "npm", link: "https://www.npmjs.com/package/@xtandard/kit" },
      ],
    },
  ],
});
