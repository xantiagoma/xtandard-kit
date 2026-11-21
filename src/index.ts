/**
 * `@xtandard/kit` — the shared building blocks of the xtandard products.
 *
 * The root entry only carries the package version; every building block lives on its own
 * subpath (`@xtandard/kit/storage/redis`, `@xtandard/kit/auth/basic`, …) so importing one
 * never loads another's optional peers.
 *
 * @module
 */

export { VERSION } from "./version.ts";
