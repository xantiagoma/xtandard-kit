/**
 * Helpers shared by the storage drivers: identifier validation and literal-prefix escaping for SQL
 * `LIKE … ESCAPE '!'`, SQLite `GLOB`, Redis `MATCH`/`PSUBSCRIBE` globs and regular expressions.
 * The canonical-JSON and equality helpers live in `src/internal/json.ts` and are re-exported from
 * `@xtandard/kit/storage`.
 *
 * @module
 */

/** Identifiers the drivers are willing to interpolate into DDL and queries unquoted. */
export const SAFE_IDENTIFIER: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Throw unless `name` is a safe SQL identifier (`[a-zA-Z_][a-zA-Z0-9_]*`). Returns `name` so it can
 * be used inline. `what` names the identifier in the error (`"table"`, `"column"`, …).
 */
export function assertIdentifier(name: string, what = "table"): string {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(
      `Invalid ${what} name ${JSON.stringify(name)}: must match ${SAFE_IDENTIFIER.source}`,
    );
  }
  return name;
}

/**
 * Escape a literal prefix for `LIKE … ESCAPE '!'`. `!` (not `\`) because a backslash inside a string
 * literal is itself an escape on MySQL, which makes `ESCAPE '\'` a syntax error there; `!` means
 * the same on every dialect.
 */
export const escapeLike = (literal: string): string => literal.replace(/[!%_]/g, (c) => `!${c}`);

/**
 * Escape a literal prefix for SQLite `GLOB` (case-sensitive and index-usable, unlike SQLite's
 * `LIKE`, which folds ASCII case). `*`, `?` and `[` are wrapped in a one-character class; `]`
 * outside a class is already literal.
 */
export const escapeGlob = (literal: string): string => literal.replace(/[*?[]/g, (c) => `[${c}]`);

/** Escape a literal prefix for a Redis glob (`SCAN … MATCH`, `PSUBSCRIBE`). */
export const escapeRedisGlob = (literal: string): string =>
  literal.replace(/[*?[\]\\]/g, (c) => `\\${c}`);

/** Escape a literal string for embedding in a regular expression. */
export const escapeRegex = (literal: string): string =>
  literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
