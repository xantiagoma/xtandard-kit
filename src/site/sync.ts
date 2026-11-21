/**
 * The docs site's pre-build step (`site/scripts/sync.ts` in every product): writes
 * `site/src/content/docs/` (generated, gitignored) from the repository's Markdown and the site-only
 * pages in `site/content/`. The repository files stay the single source of truth and keep rendering
 * on GitHub and npm; this step only adapts copies:
 *
 * - the title and description come from the source: the H1 (or the manifest's `title`) becomes
 *   `title`, the first paragraph becomes `description`, and "Edit page" opens the source file;
 * - a long guide is split by its H2 sections into several pages (manifest `sections`); every H2
 *   must land on exactly one page;
 * - relative links to files that are pages here (`./STORAGE.md#x`, `#anchor` in a split guide)
 *   become site routes, pointing at whichever page holds the anchor;
 * - relative links to other repository files (`../src/x.ts`) become GitHub URLs;
 * - a link to a **pending** guide (one that has not landed yet) goes to GitHub, with a warning;
 * - a relative link to any other missing file fails the build;
 * - GitHub alerts (`> [!WARNING]`) become Starlight asides.
 *
 * It also copies the brand files the site serves as-is (favicons, the social card) from
 * `docs/assets/` into `site/public/` (generated, gitignored), so `docs/assets/` stays their only
 * copy. Fenced code blocks and inline code spans are never rewritten.
 *
 * @module
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import type { SiteManifest, SitePage } from "./manifest.ts";

/**
 * GitHub's heading anchors (github-slugger): lowercase, punctuation and symbols removed, spaces to
 * `-`, repeats suffixed `-1`, `-2`…
 */
export class Slugger {
  private seen = new Map<string, number>();

  /** The anchor for `text`, unique within this slugger. */
  slug(text: string): string {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    let slug = base;
    let n = this.seen.get(base) ?? 0;
    while (this.seen.has(slug)) slug = `${base}-${++n}`;
    this.seen.set(base, n);
    this.seen.set(slug, this.seen.get(slug) ?? 0);
    return slug;
  }
}

// ---- Markdown helpers -----------------------------------------------------------------------

const fence = /^ {0,3}(`{3,}|~{3,})/;

/** Calls `fn` on each line outside fenced code blocks; code lines are kept as they are. */
export function mapProse(lines: string[], fn: (line: string) => string): string[] {
  let open: string | null = null;
  return lines.map((line) => {
    const f = fence.exec(line);
    if (open) {
      if (f && f[1]![0] === open[0] && f[1]!.length >= open.length && line.trim() === f[1])
        open = null;
      return line;
    }
    if (f) {
      open = f[1]!;
      return line;
    }
    return fn(line);
  });
}

/** Indexes of the lines outside fenced code blocks. */
function proseLines(lines: string[]): boolean[] {
  const prose: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const f = fence.exec(line);
    if (open) {
      prose.push(false);
      if (f && f[1]![0] === open[0] && f[1]!.length >= open.length && line.trim() === f[1])
        open = null;
      continue;
    }
    if (f) {
      open = f[1]!;
      prose.push(false);
      continue;
    }
    prose.push(true);
  }
  return prose;
}

/** Plain text of a Markdown inline string (titles, descriptions, heading slugs). */
export const plain = (s: string): string =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Replaces the inline code spans of a line with placeholders (CommonMark: a run of n backticks
 * opens a span that the next run of exactly n backticks closes; an unmatched run is literal).
 */
function maskCode(line: string, spans: string[]): string {
  const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index, len: m[0].length }));
  let out = "";
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const open = runs[i]!;
    if (open.at < pos) continue;
    const close = runs.findIndex((r, j) => j > i && r.len === open.len);
    if (close < 0) continue;
    const end = runs[close]!.at + open.len;
    out += `${line.slice(pos, open.at)}\uE000${spans.push(line.slice(open.at, end)) - 1}\uE000`;
    pos = end;
    i = close;
  }
  return out + line.slice(pos);
}

const alertKinds: Record<string, string> = {
  NOTE: "note",
  TIP: "tip",
  IMPORTANT: "note",
  WARNING: "caution",
  CAUTION: "danger",
};

/** GitHub alerts (`> [!WARNING]` + quoted lines) → Starlight asides (`:::caution`). */
export function alerts(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/.exec(lines[i]!);
    if (!m) {
      out.push(lines[i]!);
      continue;
    }
    out.push(`:::${alertKinds[m[1]!]}`);
    while (i + 1 < lines.length && lines[i + 1]!.startsWith(">"))
      out.push(lines[++i]!.replace(/^> ?/, ""));
    out.push(":::");
  }
  return out;
}

/** The first paragraph of prose, as a meta description of at most ~200 characters. */
export function describeMarkdown(lines: string[]): string | undefined {
  const para: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (fence.test(line)) {
      inFence = !inFence;
      if (para.length) break;
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") {
      if (para.length) break;
      continue;
    }
    if (para.length === 0 && /^\s*([#>|<:]|[-*+] |\d+\. |!\[)/.test(line)) continue;
    // A thematic break (`---`) is not prose.
    if (para.length === 0 && /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    para.push(line);
  }
  let d = plain(para.join(" "));
  if (!d) return undefined;
  if (d.length > 200) d = `${d.slice(0, 200).replace(/\s+\S*$/, "")}…`;
  return d;
}

const yaml = (v: string) => JSON.stringify(v);

function frontmatter(fields: Record<string, string | boolean | undefined>, extra = ""): string {
  const body = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? yaml(v) : v}`)
    .join("\n");
  return `---\n${body}${extra}\n---\n`;
}

type Block = { heading: string | null; start: number; end: number; anchors: Set<string> };
type Doc = { lines: string[]; h1: number; title: string; blocks: Block[] };

/** What {@link syncSite} did. */
export interface SyncResult {
  /** Pages written. */
  written: number;
  /** Problems that fail the build. */
  errors: string[];
  /** Links to pending guides, sent to GitHub for now. */
  warnings: string[];
}

const isExternal = (t: string) => /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//");

function listMarkdown(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${prefix}/${f.split("\\").join("/")}`)
    .sort();
}

/** Write `site/src/content/docs/` and `site/public/` from the manifest. */
export function syncSite(m: SiteManifest): SyncResult {
  const { repoRoot, siteDir, siteBase, repoUrl, repoSlug, branch } = m;
  const outDir = join(siteDir, "src/content/docs");
  const publicDir = join(siteDir, "public");
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (msg: string) => errors.push(msg);
  const all = m.pages();
  const pending = new Set(m.pendingPages().flatMap((p) => (p.src ? [p.src] : [])));
  const route = (slug: string) => (slug === "" ? `${siteBase}/` : `${siteBase}/${slug}/`);

  const docs = new Map<string, Doc>();

  /** Reads a repository Markdown file into its intro block (null heading) and H2 blocks. */
  function loadDoc(src: string): Doc | undefined {
    const cached = docs.get(src);
    if (cached) return cached;
    const path = join(repoRoot, src);
    if (!existsSync(path)) {
      fail(`manifest: ${src} does not exist`);
      return undefined;
    }
    const lines = readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n");
    const prose = proseLines(lines);
    const slugger = new Slugger();
    let h1 = -1;
    const blocks: Block[] = [{ heading: null, start: 0, end: lines.length, anchors: new Set() }];
    lines.forEach((line, i) => {
      if (!prose[i]) return;
      const h = /^(#{1,6}) (.+?)\s*#*\s*$/.exec(line);
      if (!h) return;
      if (h[1] === "#" && h1 < 0) h1 = i;
      if (h[1] === "##") {
        blocks.at(-1)!.end = i;
        blocks.push({ heading: h[2]!, start: i, end: lines.length, anchors: new Set() });
      }
      blocks.at(-1)!.anchors.add(slugger.slug(plain(h[2]!)));
    });
    const doc: Doc = { lines, h1, title: h1 >= 0 ? plain(lines[h1]!.slice(2)) : "", blocks };
    docs.set(src, doc);
    return doc;
  }

  /** Which page (slug) holds each H2 block of each source file. */
  const blockPage = new Map<string, Map<Block, string>>();
  /** Whole-file pages: source → slug. */
  const filePage = new Map<string, string>();

  for (const p of all) {
    if (!p.src) continue;
    const doc = loadDoc(p.src);
    if (!doc) continue;
    if (!p.sections) {
      filePage.set(p.src, p.slug);
      continue;
    }
    const owners = blockPage.get(p.src) ?? new Map<Block, string>();
    blockPage.set(p.src, owners);
    if (p.intro) owners.set(doc.blocks[0]!, p.slug);
    for (const name of p.sections) {
      const block = doc.blocks.find((b) => b.heading === name);
      if (!block) fail(`${p.src}: no "## ${name}" section for /${p.slug}/`);
      else if (owners.has(block)) fail(`${p.src}: "## ${name}" is on two pages`);
      else owners.set(block, p.slug);
    }
  }

  // A split guide (one that is not README.md, whose other sections stay on GitHub) must place
  // every H2 on a page.
  for (const [src, owners] of blockPage) {
    if (src === "README.md" || filePage.has(src)) continue;
    const doc = loadDoc(src)!;
    for (const b of doc.blocks) {
      if (b.heading === null && !owners.has(b) && b.end - b.start > 0) {
        const text = doc.lines
          .slice(b.start, b.end)
          .filter((l, i) => b.start + i !== doc.h1 && l.trim());
        if (text.length)
          fail(`${src}: the text above the first H2 is on no page (set intro on one)`);
      } else if (b.heading !== null && !owners.has(b)) {
        fail(
          `${src}: "## ${b.heading}" is on no page (add it to a page's sections in the manifest)`,
        );
      }
    }
  }

  /** Pages made of one H2 section: their own H2 is dropped, since the title already says it. */
  const dropsH2 = new Set(
    all.filter((p) => p.sections && !p.intro && p.sections.length === 1).map((p) => p.slug),
  );

  /** The route of `anchor` (without #) in source `src`, or undefined when no page shows it. */
  function anchorRoute(src: string, anchor: string): string | undefined {
    const whole = filePage.get(src);
    if (whole !== undefined) return `${route(whole)}${anchor ? `#${anchor}` : ""}`;
    const owners = blockPage.get(src);
    const doc = docs.get(src);
    if (!owners || !doc) return undefined;
    if (!anchor) {
      const first = doc.blocks.find((b) => owners.has(b));
      return first ? route(owners.get(first)!) : undefined;
    }
    for (const [b, slug] of owners) {
      if (!b.anchors.has(anchor)) continue;
      // The section's own heading is the page title on a single-section page: link the page.
      const own = b.heading !== null && b.anchors.values().next().value === anchor;
      return own && dropsH2.has(slug) ? route(slug) : `${route(slug)}#${anchor}`;
    }
    return undefined;
  }

  /** Rewrites one link target found in `src`. `image` targets get a URL that serves the bytes. */
  function rewrite(target: string, src: string, image: boolean): string {
    if (target === "" || isExternal(target)) return target;
    if (target.startsWith("#")) {
      // In a split guide the anchor may now live on a sibling page.
      if (!blockPage.has(src)) return target;
      return anchorRoute(src, target.slice(1)) ?? `${repoUrl}/blob/${branch}/${src}${target}`;
    }
    const parts = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(target)!;
    let path: string;
    try {
      path = decodeURIComponent(parts[1]!);
    } catch {
      fail(`${src}: malformed link ${target}`);
      return target;
    }
    const hash = parts[3] ?? "";
    const resolved = posix
      .normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(src), path))
      .replace(/\/$/, "");
    if (resolved.startsWith("..")) {
      fail(`${src}: link ${target} leaves the repository`);
      return target;
    }
    const abs = join(repoRoot, resolved === "." ? "" : resolved);
    if (!existsSync(abs)) {
      if (pending.has(resolved)) {
        warnings.push(`${src}: ${target} is a pending guide; linking to GitHub until it lands`);
        return `${repoUrl}/blob/${branch}/${resolved}${parts[2] ?? ""}${hash}`;
      }
      fail(`${src}: broken link ${target} (${resolved} does not exist)`);
      return target;
    }
    if (image) return `https://raw.githubusercontent.com/${repoSlug}/${branch}/${resolved}`;
    const to = anchorRoute(resolved, hash.slice(1));
    if (to) return to;
    const kind = statSync(abs).isDirectory() ? "tree" : "blob";
    return `${repoUrl}/${kind}/${branch}/${resolved}${parts[2] ?? ""}${hash}`;
  }

  /** Rewrites the link targets on one prose line, leaving inline code spans alone. */
  function rewriteLine(line: string, src: string): string {
    const spans: string[] = [];
    let text = maskCode(line, spans);
    text = text.replace(
      /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\s*)\)/g,
      (_s, bang: string, label: string, t: string, title: string) => {
        const bare = t.startsWith("<") ? t.slice(1, -1) : t;
        const out = rewrite(bare, src, bang === "!");
        return `${bang}[${label}](${t.startsWith("<") ? `<${out}>` : out}${title})`;
      },
    );
    text = text.replace(
      /^( {0,3}\[[^\]]+\]:\s*)(\S+)/,
      (_s, head: string, t: string) => head + rewrite(t, src, false),
    );
    text = text.replace(
      /\b(href|src)="([^"]*)"/g,
      (_s, attr: string, t: string) => `${attr}="${rewrite(t, src, attr === "src")}"`,
    );
    return text.replace(/\uE000(\d+)\uE000/g, (_s, i: string) => spans[Number(i)]!);
  }

  const internalBanner = `\nbanner:\n  content: ${yaml("Contributor documentation: how the project is built and released. Not needed to use the library.")}`;

  function fromRepo(p: SitePage): string {
    const src = p.src!;
    const doc = loadDoc(src);
    if (!doc) return "";
    let body: string[];
    let title: string;
    if (p.sections) {
      const owners = blockPage.get(src)!;
      const mine = doc.blocks.filter((b) => owners.get(b) === p.slug);
      body = mine.flatMap((b) => {
        const lines = doc.lines.slice(b.start, b.end);
        // Drop the H1 (it becomes the title) and anything above it (a logo).
        return b.heading === null && doc.h1 >= 0 ? lines.slice(doc.h1 - b.start + 1) : lines;
      });
      title = p.title ?? (p.intro ? doc.title : (p.sections[0] ?? ""));
      // A single-section page drops its own H2: the title already says it.
      if (!p.intro && p.sections.length === 1) body = body.slice(1);
    } else {
      if (doc.h1 < 0) {
        fail(`${src}: no H1 to take the title from`);
        return "";
      }
      const pre = doc.lines.slice(0, doc.h1).filter((l) => l.trim() !== "");
      if (pre.some((l) => !/^\s*(<|!\[)/.test(l))) fail(`${src}: unexpected text before the H1`);
      title = p.title ?? doc.title;
      body = doc.lines.slice(doc.h1 + 1);
    }
    const description = p.description ?? describeMarkdown(body);
    const text = mapProse(alerts(body), (l) => rewriteLine(l, src)).join("\n");
    return (
      frontmatter(
        {
          title,
          description,
          editUrl: `${repoUrl}/edit/${branch}/${src}`,
          pagefind: p.internal ? false : undefined,
        },
        p.internal ? internalBanner : "",
      ) + text.replace(/^\n+/, "\n")
    );
  }

  function fromSite(p: SitePage): string {
    const path = join(siteDir, "content", p.site!);
    if (!existsSync(path)) {
      fail(`manifest: site/content/${p.site} does not exist`);
      return "";
    }
    let text = readFileSync(path, "utf8")
      .replaceAll("@BASE@", siteBase)
      .replaceAll("@REPO@", repoUrl)
      .replaceAll("@NPM@", m.npmUrl);
    if (!/^---\n[\s\S]*?\neditUrl:/.test(text)) {
      text = text.replace(
        /^---\n/,
        `---\neditUrl: ${yaml(`${repoUrl}/edit/${branch}/site/content/${p.site}`)}\n`,
      );
    }
    const left = /@[A-Z_]+@/.exec(text.replace(/```[\s\S]*?```/g, ""));
    if (left) fail(`site/content/${p.site}: unreplaced ${left[0]}`);
    return text;
  }

  // Overwrite only the listed assets: a product may commit other files under site/public/.
  mkdirSync(publicDir, { recursive: true });
  for (const f of m.publicAssets) {
    const from = join(repoRoot, "docs/assets", f);
    if (existsSync(from)) copyFileSync(from, join(publicDir, f));
    else fail(`docs/assets/${f} does not exist (the site serves it)`);
  }

  rmSync(outDir, { recursive: true, force: true });
  let written = 0;
  for (const p of all) {
    const text = p.site ? fromSite(p) : fromRepo(p);
    if (!text) continue;
    const ext = p.site?.endsWith(".mdx") ? "mdx" : "md";
    const file = join(outDir, p.slug === "" ? `index.${ext}` : `${p.slug}.${ext}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    written++;
  }

  // Every Markdown file under docs/ must be in the manifest, so a new guide is not forgotten.
  const covered = new Set(all.flatMap((p) => (p.src ? [p.src] : [])));
  for (const f of listMarkdown(join(repoRoot, "docs"), "docs")) {
    if (!covered.has(f) && !pending.has(f) && !m.ignoreDocs(f))
      fail(`${f} is not in the site manifest (add it to the sidebar)`);
  }

  return { written, errors, warnings };
}

/** Run {@link syncSite} and print the outcome; resolves to the exit code (the sync script's). */
export function runSync(
  m: SiteManifest,
  io: { log: (l: string) => void; error: (l: string) => void } = console,
): number {
  const { written, errors, warnings } = syncSite(m);
  for (const w of warnings) io.log(`sync: warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) io.error(`sync: ${e}`);
    io.error(`sync: ${errors.length} error(s)`);
    return 1;
  }
  io.log(`sync: ${written} pages in site/src/content/docs (base ${m.siteBase})`);
  return 0;
}
