// Installs the locally built kit into site/node_modules/@xtandard/kit as plain files — what
// `bun add @xtandard/kit` gives a product's site — so the site dogfoods the published build.
// (A `file:..` dependency would copy the repo, this site included, as symlinks into the repo,
// and Node and Vite would then resolve the kit's peers from the repo root instead of the site.)
// Run `bun run build` at the repo root first.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const target = fileURLToPath(new URL("../node_modules/@xtandard/kit/", import.meta.url));

if (!existsSync(join(repo, "dist/entry-site.mjs"))) {
  console.error("link-kit: dist/ is missing; run `bun run build` at the repo root first");
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of ["package.json", "dist", "bin", "tsconfig", "LICENSE", "README.md"]) {
  cpSync(join(repo, entry), join(target, entry), { recursive: true, dereference: true });
}
console.log("link-kit: @xtandard/kit installed from the local build");
