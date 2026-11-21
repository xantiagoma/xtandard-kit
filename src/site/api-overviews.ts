/**
 * A Starlight plugin that runs after starlight-typedoc and writes the API reference's overview
 * pages, which the generator does not emit: `/api/` (every entry point, with its import path and
 * description) and `/api/<module>/` (that entry point's members, grouped by kind, with summaries).
 * The description is the `@module` doc comment at the top of each entry file, so it is written once,
 * next to the code. Modules are listed in `package.json` `exports` order (fl's version).
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StarlightPlugin } from "@astrojs/starlight/types";
import type { ApiEntry, SiteManifest } from "./manifest.ts";
import { readReexports, type Reexport } from "./typedoc-plugin.ts";

const kinds = [
  ["functions", "Functions"],
  ["classes", "Classes"],
  ["interfaces", "Interfaces"],
  ["type-aliases", "Type aliases"],
  ["variables", "Variables"],
  ["enumerations", "Enumerations"],
  ["namespaces", "Namespaces"],
] as const;

type Member = { name: string; route: string; summary: string };
type Module = {
  name: string;
  importPath: string;
  source: string;
  description: string;
  members: Map<string, Member[]>;
};

const yaml = (v: string) => JSON.stringify(v);

/** A module's leading doc comment, without the `Import from` line and the tags; `{@link}`s become code spans. */
export function moduleDescription(text: string): string {
  const m = /^\/\*\*([\s\S]*?)\*\//.exec(text);
  if (!m) return "";
  return (
    m[1]!
      .split("\n")
      .map((l) => l.replace(/^\s*\* ?/, ""))
      .filter((l) => !l.startsWith("Import from ") && !l.startsWith("@"))
      .join("\n")
      // `{@link ./validation}`, `{@link Foo | the foo}` → code spans: these pages are plain Markdown.
      .replace(
        /\{@link(?:code|plain)?\s+([^}|\s]+)\s*(?:\|\s*([^}]*))?\}/g,
        (_s, target: string, label?: string) =>
          `\`${label?.trim() || target.replace(/^.*[./]/, "")}\``,
      )
      .trim()
      .replace(/\n{3,}/g, "\n\n")
  );
}

/** A generated member page's title and the first prose paragraph after its "Defined in" line. */
function member(file: string, route: string, fallbackName = ""): Member {
  const text = readFileSync(file, "utf8");
  const title = /^title: (.+)$/m.exec(text)?.[1];
  const name = title ? (JSON.parse(title) as string) : fallbackName;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("Defined in:"));
  let summary = "";
  if (at >= 0) {
    const para: string[] = [];
    for (const l of lines.slice(at + 1)) {
      if (l.trim() === "") {
        if (para.length) break;
        continue;
      }
      if (/^(#|```|\||:::|>)/.test(l)) break;
      para.push(l.trim());
    }
    summary = para.join(" ");
  }
  return { name, route, summary };
}

function collect(ctx: Ctx, apiDir: string): Module[] {
  const { siteBase, packageName } = ctx;
  const modules: Module[] = [];
  const walk = (dir: string, name: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
    const kindDirs = new Set<string>(kinds.map(([k]) => k));
    if (name && entries.some((e) => kindDirs.has(e.name))) {
      const entry = ctx.entries.find((e) => e.name === name);
      const source = entry?.source ?? "";
      const members = new Map<string, Member[]>();
      for (const [kind] of kinds) {
        const kdir = join(dir, kind);
        if (!existsSync(kdir)) continue;
        // A namespace is a folder with its own generated index.md; other members are files.
        const list = readdirSync(kdir, { withFileTypes: true })
          .map((e) =>
            e.isDirectory()
              ? existsSync(join(kdir, e.name, "index.md"))
                ? member(
                    join(kdir, e.name, "index.md"),
                    `${siteBase}/api/${name}/${kind}/${e.name}/`.toLowerCase(),
                    e.name,
                  )
                : undefined
              : e.name.endsWith(".md")
                ? member(
                    join(kdir, e.name),
                    `${siteBase}/api/${name}/${kind}/${e.name.slice(0, -3)}/`.toLowerCase(),
                  )
                : undefined,
          )
          .filter((x): x is Member => x !== undefined)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (list.length) members.set(kind, list);
      }
      modules.push({
        name,
        importPath: entry?.importPath ?? `${packageName}/${name}`,
        source,
        description: source
          ? moduleDescription(readFileSync(join(ctx.repoRoot, source), "utf8"))
          : "",
        members,
      });
    }
    for (const e of entries)
      if (!kindDirs.has(e.name)) walk(join(dir, e.name), name ? `${name}/${e.name}` : e.name);
  };
  walk(apiDir, "");
  // package.json `exports` order: the root first, then the subpaths as the package lists them.
  const order = ctx.entries.map((e) => e.name);
  const rank = (m: Module) => (order.includes(m.name) ? order.indexOf(m.name) : order.length);
  return modules.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const firstSentence = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  const m = /^(.+?\.)(\s|$)/.exec(flat);
  return m ? m[1]! : flat;
};

function modulePage(ctx: Ctx, m: Module, reexports: Reexport[]): string {
  const { siteBase, repoUrl, branch } = ctx;
  const out = [
    "---",
    `title: ${yaml(m.importPath)}`,
    `description: ${yaml(firstSentence(m.description) || `API reference for ${m.importPath}.`)}`,
    m.source ? `editUrl: ${yaml(`${repoUrl}/edit/${branch}/${m.source}`)}` : "editUrl: false",
    "next: false",
    "prev: false",
    "---",
    "",
    m.description,
    "",
    "```ts",
    `import { … } from "${m.importPath}";`,
    "```",
    "",
  ];
  // A symbol several entry points export is documented once, under the first (astro.config.ts
  // apiOwners); say which other entry points this one also re-exports from. Only `export … from`
  // statements count: an entry point that merely imports another one doesn't re-export it.
  // A generated module no entry point matches (no `source`) has nothing to scan.
  const from = new Set(
    m.source
      ? [
          ...readFileSync(join(ctx.repoRoot, m.source), "utf8").matchAll(
            /^export\s[^;]*?\bfrom\s+"\.\/([^"]+)"/gm,
          ),
        ].map((x) => `src/${x[1]}`)
      : [],
  );
  const others = ctx.entries.filter((e) => e.source !== m.source && from.has(e.source));
  if (others.length)
    out.push(
      `Also re-exports symbols of ${others
        .map((e) => `[\`${e.importPath}\`](${siteBase}/api/${e.name}/)`)
        .join(", ")}, documented on those pages.`,
      "",
    );
  for (const [kind, label] of kinds) {
    const list = m.members.get(kind);
    if (!list) continue;
    out.push(`## ${label}`, "", "| Name | Summary |", "| --- | --- |");
    for (const x of list)
      out.push(`| [\`${x.name}\`](${x.route}) | ${x.summary.replaceAll("|", "\\|")} |`);
    out.push("");
  }
  // Re-exports of symbols documented on another module page the sentence above doesn't name
  // (e.g. the Elysia 2 adapter's `flagsPanel`, shared with and documented under the Elysia 1 one).
  const covered = new Set(others.map((e) => e.name));
  const listed = reexports
    .filter((r) => r.module === m.name && !covered.has(r.owner))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (listed.length) {
    out.push("## Re-exports", "", "| Name | Documented on |", "| --- | --- |");
    for (const r of listed) {
      const owner = ctx.entries.find((e) => e.name === r.owner)?.importPath ?? r.owner;
      const route = `${siteBase}/api/${r.owner}/${r.kind}/${r.target}/`.toLowerCase();
      const label = r.name === r.target ? `\`${r.name}\`` : `\`${r.name}\` (\`${r.target}\`)`;
      out.push(`| [${label}](${route}) | [\`${owner}\`](${siteBase}/api/${r.owner}/) |`);
    }
    out.push("");
  }
  return out.join("\n");
}

function indexPage(ctx: Ctx, modules: Module[]): string {
  const { siteBase, packageName } = ctx;
  const out = [
    "---",
    'title: "API reference"',
    `description: ${yaml(`Every entry point of ${packageName} and its exports, generated from the TypeScript source and its doc comments.`)}`,
    "editUrl: false",
    "next: false",
    "prev: false",
    "---",
    "",
    "Generated from the source by [TypeDoc](https://typedoc.org/), so it always matches the published",
    "types. Each entry point is a separate import; its optional peer dependencies are listed in its",
    ctx.entryPointsSlug
      ? `description and on [Entry points](${siteBase}/${ctx.entryPointsSlug}/).`
      : "description.",
    "",
    "| Import | Exports | Description |",
    "| --- | --- | --- |",
  ];
  for (const m of modules) {
    const count = [...m.members.values()].reduce((n, l) => n + l.length, 0);
    out.push(
      `| [\`${m.importPath}\`](${siteBase}/api/${m.name}/) | ${count} | ${firstSentence(m.description).replaceAll("|", "\\|")} |`,
    );
  }
  out.push("");
  return out.join("\n");
}

/** Options for {@link apiOverviews}. */
export interface ApiOverviewsOptions {
  /**
   * Slug of the site's "Entry points" page, linked from `/api/` (`"entry-points"`), or `false`
   * when the site has none. Default: `"entry-points"` when the manifest has that page.
   */
  entryPointsSlug?: string | false;
}

interface Ctx {
  repoRoot: string;
  siteBase: string;
  repoUrl: string;
  branch: string;
  packageName: string;
  entries: ApiEntry[];
  entryPointsSlug: string | false;
}

/** The overview-pages plugin; add it after starlight-typedoc (plugins run in order). */
export function apiOverviews(
  manifest: SiteManifest,
  options: ApiOverviewsOptions = {},
): StarlightPlugin {
  return {
    name: "xtandard-api-overviews",
    hooks: {
      "config:setup"({ astroConfig, command, logger }) {
        if (command === "preview") return;
        const apiDir = join(new URL(astroConfig.srcDir).pathname, "content/docs/api");
        if (!existsSync(apiDir)) {
          logger.warn("no generated API reference to index");
          return;
        }
        logger.info(`API overviews: ${writeApiOverviews(manifest, apiDir, options)} modules`);
      },
    },
  };
}

/**
 * Write `index.md` for `/api/` and each `/api/<module>/` under `apiDir` (starlight-typedoc's
 * output). Resolves to the number of modules.
 */
export function writeApiOverviews(
  manifest: SiteManifest,
  apiDir: string,
  options: ApiOverviewsOptions = {},
): number {
  const ctx: Ctx = {
    repoRoot: manifest.repoRoot,
    siteBase: manifest.siteBase,
    repoUrl: manifest.repoUrl,
    branch: manifest.branch,
    packageName: manifest.packageName,
    entries: manifest.apiEntries(),
    entryPointsSlug:
      options.entryPointsSlug ??
      (manifest.pages().some((p) => p.slug === "entry-points") ? "entry-points" : false),
  };
  const modules = collect(ctx, apiDir);
  const reexports = readReexports(manifest.siteDir);
  for (const m of modules)
    writeFileSync(join(apiDir, m.name, "index.md"), modulePage(ctx, m, reexports));
  writeFileSync(join(apiDir, "index.md"), indexPage(ctx, modules));
  // The generator's own root listing links to module pages it never emits; index.md replaces it.
  rmSync(join(apiDir, "README.md"), { force: true });
  return modules.length;
}
