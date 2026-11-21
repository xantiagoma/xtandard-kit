# ADR 0008 — UI kit ships as compiled ESM with Tailwind source scanning

**Status:** Accepted

---

## Context

Each product bundles its admin SPA into `dist/ui` and its React embed into `dist/react.js` with Vite.
It uses Tailwind v4, and the embed CSS is scoped by `scope-embed-css`. The shared UI pieces must work
inside both bundles. They also carry product seams:
- the scope class `.xtandard-<p>`;
- the config global `__<P>_CONFIG__`;
- the theme storage key `xtandard-<p>:theme`;
- the brand tokens.

## Decision

- `@xtandard/kit/ui` and `@xtandard/kit/ui/embed` ship as **compiled ESM plus `.d.ts`**. `react`,
  `react-dom`, `@base-ui-components/react`, `lucide-react`, `wouter` and `@tanstack/react-query` are
  optional peers. The products already have them as devDependencies, because those are bundled into
  their UI.
- `@xtandard/kit/ui/styles.css` holds the base tokens and layers, plus an `@source` directive pointing
  at the kit's compiled UI. That way Tailwind in the product generates the kit's classes. Products
  import it, then override brand tokens in their own `:root` block.
- Every seam is an explicit parameter:
  - `createEmbed({ App, scopeClass, … })`;
  - `bootSpa({ configGlobal, themeKey, … })`;
  - `createApiClient({ errorClass })`.
- `scope-embed-css` is a `xtandard-kit` bin command that takes the scope.

## Consequences

- Views, tabs and scope switchers stay in the products. The shell, primitives, theme, API client and
  embed plumbing are shared.
- The `@source` approach is verified first in the webhooks migration. The fallback is for products to
  add `@source "../node_modules/@xtandard/kit/dist/ui"` themselves.
