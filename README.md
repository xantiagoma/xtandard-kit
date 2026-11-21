# @xtandard/kit

The shared building blocks of the xtandard products: one implementation of the infrastructure that
[`@xtandard/webhooks`](https://github.com/xantiagoma/xtandard-webhooks),
[`@xtandard/flags`](https://github.com/xantiagoma/xtandard-flags),
[`@xtandard/audit`](https://github.com/xantiagoma/xtandard-audit),
[`@xtandard/links`](https://github.com/xantiagoma/xtandard-links) and
[`@xtandard/entitlements`](https://github.com/xantiagoma/xtandard-entitlements) used to copy from each
other. Fix a bug here once, and every product gets it.

> **Status: in development (0.x).** The products depend on this package directly. You only need it
> yourself if you are building an xtandard-style product.

## Contents

- [What's inside](#whats-inside)
- [Documentation](#documentation)
- [The xtandard ecosystem](#the-xtandard-ecosystem)
- [License](#license)

## What's inside

Each building block has its own subpath, and every database client, framework and build tool is an
**optional peer**. Importing one subpath never loads another's dependencies.

| Subpath                                                                                                                                             | What it is                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `@xtandard/kit/storage` (+ `/memory`, `/file`, `/sqlite`, `/libsql`, `/postgres`, `/mongodb`, `/redis`, `/cloudflare-kv`, `/unstorage`, `/drizzle`) | The KV storage contract with watch and compare-and-swap capabilities, plus ten drivers |
| `@xtandard/kit/storage/testing`                                                                                                                     | The storage conformance suite, runnable under vitest or `bun test`                     |
| `@xtandard/kit/drizzle/{pg,mysql,sqlite}`                                                                                                           | Drizzle KV table factories                                                             |
| `@xtandard/kit/auth`, `/authorization` (+ `none`, `basic`, `roles`, `delegated`)                                                                    | Authentication and authorization providers                                             |
| `@xtandard/kit/hooks`, `/hooks/log`                                                                                                                 | The before/after hook runner and the log hook                                          |
| `@xtandard/kit/server`, `/server/router`                                                                                                            | Panel/SPA serving, CORS, base path, the router and the OpenAPI generator               |
| `@xtandard/kit/tokens`                                                                                                                              | Scoped HMAC tokens for portals and embeds                                              |
| `@xtandard/kit/adapters/{bun,node,express,hono,elysia,next}`                                                                                        | Framework adapters and the Fetch↔Node bridge                                           |
| `@xtandard/kit/cli`                                                                                                                                 | CLI plumbing: env parsing, driver selection from env, auth from env, `serve`           |
| `@xtandard/kit/util`, `/testing`                                                                                                                    | Durations, canonical JSON, ids, validation core, test clock                            |
| `@xtandard/kit/ui`, `/ui/embed`, `/ui/styles.css`                                                                                                   | The React admin shell, primitives, theme, and the embed factory                        |
| `@xtandard/kit/build`, `xtandard-kit` bin                                                                                                           | Build tooling: config factories, embed CSS scoping, the API-surface check              |
| `@xtandard/kit/site`                                                                                                                                | Docs-site tooling (Starlight + TypeDoc)                                                |

The products also call reusable GitHub workflows from this repo (`.github/workflows/{ci,pages,docker,release-prepare}.yml`).

## Documentation

- [`PLAN.md`](PLAN.md): what goes in the kit and how the products consume it
- [`docs/ADR/`](docs/ADR/): architecture decisions
- [`docs/research/inventory.md`](docs/research/inventory.md): the inventory of the five copies this
  kit replaces
- Docs site: https://me.xantiagoma.com/xtandard-kit/

## The xtandard ecosystem

`@xtandard/kit` is the shared building block behind the xtandard products. The products depend on it
directly, so you never install it yourself to use one of them. Every project below is open source and
MIT-licensed.

| Project                            | What it is                                                                                                                                                                                                      | Links                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@xtandard/kit`** (this package) | The shared building blocks of the xtandard products: storage drivers and conformance suite, auth, HTTP plumbing, adapters, admin shell and tooling                                                              | [Docs](https://me.xantiagoma.com/xtandard-kit/) · [GitHub](https://github.com/xantiagoma/xtandard-kit) · [npm](https://www.npmjs.com/package/@xtandard/kit)                            |
| **`@xtandard/lib`**                | Lightweight, type-safe TypeScript utilities with a zero-dependency core                                                                                                                                         | [Docs](https://me.xantiagoma.com/xtandard/) · [GitHub](https://github.com/xantiagoma/xtandard) · [npm](https://www.npmjs.com/package/@xtandard/lib)                                    |
| **`@xtandard/flags`**              | A self-hosted, embeddable, OpenFeature-compatible feature-flag control plane with pluggable storage                                                                                                             | [Docs](https://me.xantiagoma.com/xtandard-flags/) · [GitHub](https://github.com/xantiagoma/xtandard-flags) · [npm](https://www.npmjs.com/package/@xtandard/flags)                      |
| **`@xtandard/webhooks`**           | A self-hosted, embeddable, Standard Webhooks-compliant outbound-webhooks control plane: a Svix alternative as a library                                                                                         | [Docs](https://me.xantiagoma.com/xtandard-webhooks/) · [GitHub](https://github.com/xantiagoma/xtandard-webhooks) · [npm](https://www.npmjs.com/package/@xtandard/webhooks)             |
| **`@xtandard/audit`**              | A self-hosted, embeddable, tamper-evident audit-log control plane for B2B SaaS: a WorkOS Audit Logs alternative as a library                                                                                    | [Docs](https://me.xantiagoma.com/xtandard-audit/) · [GitHub](https://github.com/xantiagoma/xtandard-audit) · [npm](https://www.npmjs.com/package/@xtandard/audit)                      |
| **`@xtandard/links`**              | Self-hosted, embeddable branded short links with click analytics, conversion attribution and deep links: a Dub / Bitly alternative as a library                                                                 | [Docs](https://me.xantiagoma.com/xtandard-links/) · [GitHub](https://github.com/xantiagoma/xtandard-links) · [npm](https://www.npmjs.com/package/@xtandard/links)                      |
| **`@xtandard/xyte`**               | A Zyte API-compatible `/v1/extract` client and server that runs on any proxy provider, or none                                                                                                                  | [Docs](https://me.xantiagoma.com/xyte/) · [GitHub](https://github.com/xantiagoma/xyte) · [npm](https://www.npmjs.com/package/@xtandard/xyte)                                           |
| **xtandard-image**                 | A self-hosted image and video processing server in Go and libvips: imgproxy-compatible URLs plus the imgix, Cloudinary, ImageKit, Cloudflare and Thumbor dialects, with a TypeScript client (`@xtandard/image`) | [Docs](https://me.xantiagoma.com/xtandard-image/) · [GitHub](https://github.com/xantiagoma/xtandard-image) · [npm](https://www.npmjs.com/package/@xtandard/image)                      |
| **`@xtandard/entitlements`**       | An embeddable entitlements, plans and usage-metering engine: typed catalog, atomic metering, any billing provider, admin UI and customer portal                                                                 | [Docs](https://me.xantiagoma.com/xtandard-entitlements/) · [GitHub](https://github.com/xantiagoma/xtandard-entitlements) · [npm](https://www.npmjs.com/package/@xtandard/entitlements) |

## License

[MIT](LICENSE)
