// The documentation site, dogfooding @xtandard/kit/site (the local build, installed by
// scripts/link-kit.ts): Starlight over the repository's Markdown (scripts/sync.ts copies it into
// src/content/docs/ first), a TypeDoc API reference with one module per `exports` entry, and
// Mermaid diagrams. manifest.ts holds the information architecture.
// `bun run build` writes dist/ here; .github/workflows/kit-pages.yml publishes it.
import { defineXtandardSite } from "@xtandard/kit/site";
import { manifest } from "./manifest.ts";

export default await defineXtandardSite({
  manifest,
  description:
    "The shared building blocks of the xtandard products: KV storage contract, drivers and conformance suite, auth and authorization, HTTP panel plumbing, framework adapters, scoped tokens, CLI plumbing, the React admin shell, build and docs-site tooling.",
  tagline: "The shared building blocks of the xtandard products",
  // Symbols several entry points export are documented under the first owner TypeDoc meets.
  apiOwners: ["src/entry-storage.ts", "src/entry-auth.ts", "src/entry-authorization.ts"],
  devPort: 4340,
});
