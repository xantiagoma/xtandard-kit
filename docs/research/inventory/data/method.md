# Inventory brief (for workers)

Goal: we are extracting the infrastructure that five products copied from each other into one shared
package `@xtandard/kit`. Phase 1 is an INVENTORY: for each area, diff the five copies and say what we
must build once.

Repos (all read-only for you — DO NOT edit, commit, checkout or run installs/tests in them):
/Users/santi/Projects/xtandard-{webhooks,flags,audit,links,entitlements}
webhooks is the origin; flags was copied from it, then audit, links, entitlements (newest).

Inputs already prepared in this folder:
- matrix.tsv — per shared file: LOC per repo (columns loc:webhooks, loc:flags, loc:audit, loc:links,
  loc:entitlements) and the number of differing lines vs webhooks AFTER replacing the product name
  (webhook(s)/flag(s)/audit(s)/link(s)/entitlement(s), all casings) with "xprod" (columns d:wh-*).
  "Y" in the last column = byte-identical in all repos that have it. Regenerate with `bun docs/research/inventory/data/matrix.ts out.tsv`.
- fixes.txt — every `fix…` commit in each repo (inspect with `git -C <repo> show <sha>`).

For EACH area/file group in your scope, write:
1. Status: identical / identical modulo names / diverged. If diverged: HOW (feature additions,
   product-specific extensions vs. genuine drift, bug fixes) — be concrete (function names, behaviours).
2. Which copy is best (or which pieces from which copies to combine) and why.
3. LOC per copy (from matrix.tsv / wc -l).
4. Bug-fix matrix: each known fix (commit sha + one line) × each repo: has it / lacks it / n/a.
   Verify by reading code, not just commit messages (a fix may have been ported without a `fix`
   commit, or partly). Known storage bugs to check everywhere: MySQL collation (case-insensitive
   keys) + `LIKE … ESCAPE`; file-driver case collisions on case-insensitive FS; unstorage key
   normalisation (`:`/`?`/`\`/`%` escaping, getKeys prefix); Redis SCAN MATCH escaping
   (glob chars in prefixes) + exact startsWith post-filter; SQL getKeys prefix filtering (literal
   `%`/`_`). Also look for any OTHER fix present in one copy but missing in others.
5. What is product-specific (must stay in the product) vs generic (goes to the kit), and what
   seam/parameter the kit would need (e.g. product name, key prefix, resource/action enums, env
   var prefix, brand assets).
6. Public API surface each product exposes from this area (subpath exports in package.json
   "exports", exported names) — the migration must keep these working.

Style: terse, tables welcome, cite paths as `repo:path:line`. Facts only — verify by reading.
Write your section to /Users/santi/Projects/xtandard-kit/docs/research/inventory-parts/<your-area>.md
(only that file). No subagents, no other agents. Keep machine load low: no test suites, builds,
docker or whole-disk scans; reading files, git log/show/diff and small `diff` invocations are fine.
