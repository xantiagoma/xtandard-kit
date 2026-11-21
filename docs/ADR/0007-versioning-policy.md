# ADR 0007 — Versioning between the kit and the products

**Status:** Accepted

---

## Context

The kit and the products are ZeroVer (`0.x`). The point of the kit is that a fix lands once. The kit's
types also appear in the products' published `.d.mts`.

## Decision

- **Kit:** a breaking change bumps MINOR (`0.MINOR.0`). Fixes and backwards-compatible additions bump
  PATCH. This applies to the semi-public driver internals (ADR 0004) and to the reusable workflow
  inputs as well.
- **Products** depend on `@xtandard/kit` with `^0.MINOR.0`, which in ZeroVer means the same minor and
  any patch. A kit patch therefore reaches every product's users on their next install, with no
  product release.
- **Moving a product to a new kit MINOR** is a product release:
  - a product MINOR if the product's own surface changes;
  - otherwise a product PATCH.
- **Reusable workflows** are referenced as `xantiagoma/xtandard-kit/.github/workflows/<wf>.yml@v0.MINOR`.
  The kit's release workflow moves the `v0.MINOR` tag on every patch.
- The kit's CHANGELOG states which products a change affects.

## Consequences

- "Add a fix once": fix it in the kit, add a test, release a kit patch, and you are done. Products only
  need a release when they want to ship a new kit MINOR, or when the fix touches product code.
- **Exception: Docker images.** The products' GHCR images (`apps/standalone`) bundle their
  dependencies when they are built, so a kit patch does **not** reach a running image on its own. For a
  security fix, re-run each affected product's `docker.yml` (it has `workflow_dispatch`) after the kit
  patch is on npm. The kit's CHANGELOG entry for such a fix says "rebuild images: wh, fl, au, li".
- The kit must not break a minor's surface in a patch. The api-surface check runs on the kit itself in
  CI, against the last release.
